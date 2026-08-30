// Bot de Telegram para generar presupuestos de Powerlit por chat, sin abrir la app.
// Reusa el mismo parser de pedidos, catálogo de precios y plantilla de PDF que usa la
// app de escritorio (src/orderParser.js, src/catalog.json, src/ticketTemplate.js,
// src/pricing.js) para que el resultado sea siempre idéntico al de la app.
//
// Formato del mensaje: primera línea el nombre del cliente (tiene que estar guardado
// en la lista de clientes de la app), el resto el pedido, uno por renglón:
//
//   Fenix
//   10 1000T
//   6 750B
//
// El bot busca a "Fenix" en la lista de clientes (misma búsqueda por palabras sueltas
// que usa la app), le aplica sus descuentos guardados, arma el PDF y lo manda por
// Telegram. También deja una copia en la carpeta de Drive de Presupuestos, organizada
// por año/mes igual que la app (si se configuró DRIVE_PRESUPUESTOS_FOLDER_ID).

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const stream = require('stream');
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const { google } = require('googleapis');

const { interpretarPedido, normalizar } = require('../src/orderParser.js');
const { construirTicketHTML } = require('../src/ticketTemplate.js');
const { aplicarDescuentos } = require('../src/pricing.js');
const CATALOG = require('../src/catalog.json');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const CLIENTES_FILE_ID = process.env.DRIVE_CLIENTES_FILE_ID;
const PRESUPUESTOS_FOLDER_ID = process.env.DRIVE_PRESUPUESTOS_FOLDER_ID;
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  || path.join(__dirname, 'service-account.json');

if (!TOKEN) {
  console.error('Falta TELEGRAM_BOT_TOKEN en bot/.env — ver bot/.env.example');
  process.exit(1);
}
if (ALLOWED_CHAT_IDS.length === 0) {
  console.warn('ADVERTENCIA: TELEGRAM_ALLOWED_CHAT_IDS está vacío — el bot no le va a responder a nadie hasta que se configure.');
}

const LOGO_DATA_URL = 'data:image/png;base64,'
  + fs.readFileSync(path.join(__dirname, '..', 'src', 'logo.png')).toString('base64');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('Bot de Powerlit escuchando...');

// --- Google Drive (cuenta de servicio) ---
function driveClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  return google.drive({ version: 'v3', auth });
}

async function listarClientes(drive) {
  if (!CLIENTES_FILE_ID) return [];
  const res = await drive.files.get(
    { fileId: CLIENTES_FILE_ID, alt: 'media' },
    { responseType: 'json' }
  );
  return Array.isArray(res.data) ? res.data : [];
}

async function obtenerOCrearCarpeta(drive, nombre, parentId) {
  const nombreEscapado = nombre.replace(/'/g, "\\'");
  const q = `name='${nombreEscapado}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id,name)' });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;
  const creada = await drive.files.create({
    requestBody: { name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id'
  });
  return creada.data.id;
}

async function guardarPdfEnDrive(drive, filename, pdfBuffer) {
  if (!PRESUPUESTOS_FOLDER_ID) return null;
  const ahora = new Date();
  const anio = String(ahora.getFullYear());
  const mes = MESES[ahora.getMonth()];
  const carpetaAnio = await obtenerOCrearCarpeta(drive, anio, PRESUPUESTOS_FOLDER_ID);
  const carpetaMes = await obtenerOCrearCarpeta(drive, mes, carpetaAnio);
  const archivo = await drive.files.create({
    requestBody: { name: filename, parents: [carpetaMes] },
    media: { mimeType: 'application/pdf', body: stream.Readable.from(pdfBuffer) },
    fields: 'id, webViewLink'
  });
  return archivo.data.webViewLink;
}

// --- Buscar cliente por nombre (misma lógica de búsqueda por palabras que la app) ---
function buscarCliente(nombreBuscado, clientes) {
  const tokens = normalizar(nombreBuscado).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { tipo: 'vacio' };

  const coincidencias = clientes.filter(c => {
    const nombreNorm = normalizar(c.nombre);
    return tokens.every(t => nombreNorm.includes(t));
  });

  if (coincidencias.length === 0) return { tipo: 'no-encontrado' };
  if (coincidencias.length === 1) return { tipo: 'ok', cliente: coincidencias[0] };

  const exacto = coincidencias.find(c => normalizar(c.nombre) === normalizar(nombreBuscado));
  if (exacto) return { tipo: 'ok', cliente: exacto };
  return { tipo: 'ambiguo', candidatos: coincidencias };
}

// Resuelve la primera línea del mensaje contra la lista de clientes guardados. Si no
// coincide con ninguno, lo trata como un cliente ocasional: sin descuento, salvo que se
// haya escrito pegado al nombre (ej. "GlobalMat 10+5" = cliente "GlobalMat" con 10%+5%
// encadenado). Devuelve { tipo: 'guardado'|'ocasional'|'ambiguo', ... }.
function resolverCliente(primeraLinea, clientes) {
  const porNombreCompleto = buscarCliente(primeraLinea, clientes);
  if (porNombreCompleto.tipo === 'ok') return { tipo: 'guardado', cliente: porNombreCompleto.cliente };
  if (porNombreCompleto.tipo === 'ambiguo') return porNombreCompleto;

  const conDescuento = primeraLinea.match(/^(.+?)\s+((?:\d{1,2}\s*\+\s*)*\d{1,2})\s*%?$/);
  if (conDescuento) {
    const nombre = conDescuento[1].trim();
    const descuentos = conDescuento[2].split('+').map(s => parseFloat(s.trim())).filter(d => d > 0);
    return { tipo: 'ocasional', nombre, descuentos };
  }

  return { tipo: 'ocasional', nombre: primeraLinea.trim(), descuentos: [] };
}

function etiquetaDescuentos(descuentos) {
  return descuentos.length ? descuentos.map(d => d + '%').join(' + ') : '0%';
}

function nombreArchivo(cliente, fecha) {
  const dia = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const anioCorto = String(fecha.getFullYear()).slice(2);
  const clienteLimpio = cliente.replace(/[\\/:*?"<>|]/g, '').trim() || 'Cliente';
  return `${dia}-${mes}-${anioCorto} - ${clienteLimpio}.pdf`;
}

async function generarPdfBuffer(html) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBytes = await page.pdf({ format: 'A4', printBackground: true });
    // Puppeteer 22+ devuelve Uint8Array, no un Buffer de Node — node-telegram-bot-api
    // solo reconoce Buffer.isBuffer() para adjuntar el archivo correctamente; sin esta
    // conversión, mete el PDF entero como si fuera un parámetro de texto y explota
    // ("Maximum call stack size exceeded" al armar la query string).
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

// --- Manejo de mensajes ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const texto = (msg.text || '').trim();
  if (!texto) return;

  if (texto === '/start' || texto === '/ayuda' || texto === '/help') {
    bot.sendMessage(chatId,
      'Mandame el nombre del cliente en el primer renglón y el pedido abajo, uno por línea. Ejemplo:\n\nFenix\n10 1000T\n6 750B\n\nSi "Fenix" está guardado en la lista, uso sus descuentos. Si no, cotizo sin descuento — salvo que lo pongas pegado al nombre, ej.:\n\nGlobalMat 10+5\n5 750T\n\n(cliente ocasional "GlobalMat", descuento 10%+5% encadenado)'
      + (ALLOWED_CHAT_IDS.length === 0 ? '\n\n(Este chat todavía no está autorizado — avisale al administrador.)' : '')
    );
    return;
  }

  if (!ALLOWED_CHAT_IDS.includes(String(chatId))) {
    console.log(`Mensaje ignorado de chat no autorizado: ${chatId}`);
    return;
  }

  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lineas.length < 2) {
    bot.sendMessage(chatId, 'Mandame el nombre del cliente en el primer renglón y el pedido debajo. Mandá /ayuda para ver un ejemplo.');
    return;
  }

  const nombreCliente = lineas[0];
  const textoPedido = lineas.slice(1).join('\n');

  try {
    const drive = driveClient();
    const clientes = await listarClientes(drive);
    const resultadoCliente = resolverCliente(nombreCliente, clientes);

    if (resultadoCliente.tipo === 'ambiguo') {
      const nombres = resultadoCliente.candidatos.map(c => c.nombre).join(', ');
      bot.sendMessage(chatId, `Hay más de un cliente que coincide con "${nombreCliente}": ${nombres}. Escribí el nombre más completo.`);
      return;
    }

    const esGuardado = resultadoCliente.tipo === 'guardado';
    const nombreFinal = esGuardado ? resultadoCliente.cliente.nombre : resultadoCliente.nombre;
    const direccionFinal = esGuardado ? (resultadoCliente.cliente.direccion || '—') : '—';
    const descuentos = esGuardado
      ? [resultadoCliente.cliente.descuento1, resultadoCliente.cliente.descuento2, resultadoCliente.cliente.descuento3]
          .map(d => parseFloat(d) || 0).filter(d => d > 0)
      : resultadoCliente.descuentos;

    const { resueltas, noResueltas } = interpretarPedido(textoPedido, CATALOG);

    if (resueltas.length === 0) {
      bot.sendMessage(chatId, 'No pude interpretar ningún producto del pedido. Revisá el formato (ej. "10 1000T", "6 750B").');
      return;
    }

    const filas = resueltas.map(r => {
      const producto = CATALOG[r.idx];
      return {
        cant: r.cantidad,
        etiqueta: [producto.categoria, producto.subcategoria, producto.capacidad].filter(Boolean).join(' - '),
        precioUnitario: producto.precio,
        importe: r.cantidad * producto.precio
      };
    });
    const subtotal = filas.reduce((acc, f) => acc + f.importe, 0);
    const { total, descMonto } = aplicarDescuentos(subtotal, descuentos);

    const ahora = new Date();
    const html = construirTicketHTML({
      cliente: nombreFinal,
      direccion: direccionFinal,
      telefono: '',
      fecha: ahora.toLocaleDateString('es-AR'),
      filas, subtotal, descMonto, total,
      etiquetaDescuento: etiquetaDescuentos(descuentos),
      mostrarDescuento: true,
      logoDataUrl: LOGO_DATA_URL,
      textoMarcaAgua: null
    });

    bot.sendMessage(chatId, 'Generando el PDF...');
    const pdfBuffer = await generarPdfBuffer(html);
    const filename = nombreArchivo(nombreFinal, ahora);

    await bot.sendDocument(chatId, pdfBuffer, {}, { filename, contentType: 'application/pdf' });

    let copiaEnDrive = null;
    try {
      copiaEnDrive = await guardarPdfEnDrive(drive, filename, pdfBuffer);
    } catch (err) {
      console.error('No se pudo guardar copia en Drive:', err.message);
    }

    const avisos = [];
    if (!esGuardado) avisos.push(`ℹ Cliente ocasional (no está en la lista guardada): "${nombreFinal}" — descuento aplicado: ${etiquetaDescuentos(descuentos)}.`);
    const asumidos = resueltas.filter(r => r.materialAsumido);
    if (asumidos.length) avisos.push(`⚠ Asumí tricapa en ${asumidos.length} línea(s) porque no se especificó el material.`);
    if (noResueltas.length) avisos.push(`⚠ No pude interpretar: ${noResueltas.map(l => `"${l}"`).join(', ')}.`);
    if (copiaEnDrive) avisos.push(`Copia guardada en Drive: ${copiaEnDrive}`);
    if (avisos.length) bot.sendMessage(chatId, avisos.join('\n'));
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Ocurrió un error generando el presupuesto: ' + err.message);
  }
});

bot.on('polling_error', (err) => console.error('Error de polling de Telegram:', err.message));

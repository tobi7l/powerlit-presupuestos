// Bot de Telegram para generar presupuestos de Powerlit por chat, sin abrir la app.
// Reusa el mismo parser de pedidos, catálogo de precios y plantilla de PDF que usa la
// app de escritorio (src/orderParser.js, src/catalog.json, src/ticketTemplate.js,
// src/pricing.js) para que el resultado sea siempre idéntico al de la app.
//
// Flujo guiado a botones: el bot pregunta con botones el modo (mayorista/minorista),
// el cliente (de una lista paginada, o "cliente ocasional"), y en minorista además
// teléfono/descuento/sello — todo tocando, sin escribir nada raro. Lo único que se
// escribe es el nombre del cliente (si no está guardado) y el pedido en sí (productos
// y cantidades, uno por línea), porque para eso escribir sigue siendo más rápido que
// tocar botones:
//
//   10 1000T
//   6 750B
//
// El bot arma el PDF y lo manda por Telegram. También deja una copia en la carpeta de
// Drive de Presupuestos, organizada por año/mes igual que la app (si se configuró
// DRIVE_PRESUPUESTOS_FOLDER_ID).

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const stream = require('stream');
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const { google } = require('googleapis');

const { interpretarPedido, normalizar } = require('../src/orderParser.js');
const { construirTicketHTML, fmtMoney } = require('../src/ticketTemplate.js');
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

// Estado del flujo guiado en curso por chat — se pisa/limpia al terminar un presupuesto
// o con /nuevo. `esperando` dice qué tipo de mensaje de TEXTO se espera a continuación
// (si es null, lo que falta es tocar un botón, no escribir).
const sesiones = new Map();

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

function etiquetaDescuentos(descuentos) {
  return descuentos.length ? descuentos.map(d => d + '%').join(' + ') : '0%';
}

// En minorista el descuento es o un % o un monto fijo en $ (nunca los dos juntos) —
// misma regla y misma prioridad (el monto gana si hay los dos) que en la app de
// escritorio, ver calcularDescuento() en src/renderer.js.
function calcularDescuentoMinorista(subtotal, { pct, monto }) {
  if (monto > 0) {
    const total = Math.max(0, subtotal - monto);
    return { total, descMonto: subtotal - total, etiqueta: fmtMoney(monto) };
  }
  const { total, descMonto } = aplicarDescuentos(subtotal, pct > 0 ? [pct] : []);
  return { total, descMonto, etiqueta: pct + '%' };
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

function autorizado(chatId) {
  return ALLOWED_CHAT_IDS.includes(String(chatId));
}

// --- Pasos del flujo guiado ---

function pedirModo(chatId) {
  sesiones.set(chatId, {});
  bot.sendMessage(chatId, '¿Qué presupuesto armamos?', {
    reply_markup: { inline_keyboard: [[
      { text: '🏢 Mayorista', callback_data: 'modo:mayorista' },
      { text: '🛒 Minorista', callback_data: 'modo:minorista' }
    ]] }
  });
}

const CLIENTES_POR_PAGINA = 8;

// Paso por defecto al elegir Mayorista: no tira la lista completa (puede ser larga),
// pide escribir el nombre y deja la lista completa y "cliente ocasional" como opciones
// aparte para quien prefiera navegar en vez de escribir.
function pedirNombreClienteMayorista(chatId) {
  bot.sendMessage(chatId, 'Escribí el nombre del cliente (o parte) para buscarlo:', {
    reply_markup: { inline_keyboard: [
      [{ text: '📋 Ver lista completa', callback_data: 'verlista' }],
      [{ text: '👤 Cliente ocasional', callback_data: 'cliente:ocasional' }]
    ] }
  });
}

function enviarPaginaClientes(chatId, sesion) {
  const inicio = sesion.pagina * CLIENTES_POR_PAGINA;
  const pagina = sesion.clientes.slice(inicio, inicio + CLIENTES_POR_PAGINA);
  const botones = pagina.map((c, i) => [{ text: c.nombre, callback_data: `cliente:${inicio + i}` }]);

  const nav = [];
  if (sesion.pagina > 0) nav.push({ text: '⬅ Anterior', callback_data: `pag:${sesion.pagina - 1}` });
  if (inicio + CLIENTES_POR_PAGINA < sesion.clientes.length) nav.push({ text: 'Siguiente ➡', callback_data: `pag:${sesion.pagina + 1}` });
  if (nav.length) botones.push(nav);

  botones.push([{ text: '👤 Cliente ocasional', callback_data: 'cliente:ocasional' }]);
  bot.sendMessage(chatId, 'Elegí el cliente de la lista, o escribí parte del nombre para buscarlo:', { reply_markup: { inline_keyboard: botones } });
}

function mostrarResultadosBusqueda(chatId, sesion, texto, matches) {
  const limitados = matches.slice(0, CLIENTES_POR_PAGINA);
  const botones = limitados.map(c => [{ text: c.nombre, callback_data: `cliente:${sesion.clientes.indexOf(c)}` }]);
  const encabezado = matches.length > limitados.length
    ? `Encontré ${matches.length} clientes con "${texto}", te muestro los primeros ${limitados.length} — escribí algo más específico si no está el que buscás:`
    : `Encontré esto con "${texto}" — tocá para confirmar:`;
  bot.sendMessage(chatId, encabezado, { reply_markup: { inline_keyboard: botones } });
}

// Misma búsqueda por palabras sueltas que usa la app (src/renderer.js): cada palabra
// escrita tiene que aparecer en algún lado del nombre del cliente, sin importar mayúsculas/acentos.
function filtrarClientes(texto, clientes) {
  const tokens = normalizar(texto).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return clientes.filter(c => {
    const nombreNorm = normalizar(c.nombre);
    return tokens.every(t => nombreNorm.includes(t));
  });
}

function seleccionarClienteGuardado(sesion, cliente) {
  sesion.esGuardado = true;
  sesion.clienteFinal = {
    nombre: cliente.nombre,
    direccion: cliente.direccion || '—',
    descuentos: [cliente.descuento1, cliente.descuento2, cliente.descuento3]
      .map(d => parseFloat(d) || 0).filter(d => d > 0)
  };
}

function pedirPedido(chatId, sesion) {
  sesion.esperando = 'pedido';
  bot.sendMessage(chatId, 'Ahora mandame el pedido, un producto por línea. Ejemplo:\n\n10 1000T\n6 750B');
}

function preguntarDescuentoMinorista(chatId) {
  bot.sendMessage(chatId, '¿Descuento?', { reply_markup: { inline_keyboard: [
    [{ text: 'Sin descuento', callback_data: 'minodesc:ninguno' }],
    [{ text: '% descuento', callback_data: 'minodesc:pct' }],
    [{ text: '$ descuento fijo', callback_data: 'minodesc:monto' }]
  ] } });
}

function preguntarSello(chatId) {
  bot.sendMessage(chatId, '¿Sello en el PDF?', { reply_markup: { inline_keyboard: [
    [{ text: '✅ Pagado', callback_data: 'sello:pagado' }, { text: '🕒 A pagar', callback_data: 'sello:apagar' }],
    [{ text: 'Sin sello', callback_data: 'sello:ninguno' }]
  ] } });
}

// --- Generación final del presupuesto (mismo paso final para mayorista y minorista) ---

async function generarYEnviarPresupuesto(chatId, sesion, textoPedido) {
  const { resueltas, noResueltas } = interpretarPedido(textoPedido, CATALOG);

  if (resueltas.length === 0) {
    bot.sendMessage(chatId, 'No pude interpretar ningún producto del pedido. Revisá el formato (ej. "10 1000T", "6 750B") y volvé a mandarlo.');
    return; // sigue esperando "pedido" para que lo reintente sin perder todo lo demás
  }

  const modo = sesion.modo;
  const precioField = modo === 'minorista' ? 'precioMinorista' : 'precio';
  const filas = resueltas.map(r => {
    const producto = CATALOG[r.idx];
    const precioUnitario = producto[precioField];
    return {
      cant: r.cantidad,
      etiqueta: [producto.categoria, producto.subcategoria, producto.capacidad].filter(Boolean).join(' - '),
      precioUnitario,
      importe: r.cantidad * precioUnitario
    };
  });
  const subtotal = filas.reduce((acc, f) => acc + f.importe, 0);

  let nombreFinal, direccionFinal, telefonoFinal, total, descMonto, etiquetaDescuento, mostrarDescuento, textoMarcaAgua;

  if (modo === 'mayorista') {
    nombreFinal = sesion.clienteFinal.nombre;
    direccionFinal = sesion.clienteFinal.direccion;
    telefonoFinal = '';
    ({ total, descMonto } = aplicarDescuentos(subtotal, sesion.clienteFinal.descuentos));
    etiquetaDescuento = etiquetaDescuentos(sesion.clienteFinal.descuentos);
    mostrarDescuento = true;
    textoMarcaAgua = null;
  } else {
    nombreFinal = sesion.minNombre;
    direccionFinal = '—';
    telefonoFinal = sesion.minTelefono || '';
    const r = calcularDescuentoMinorista(subtotal, { pct: sesion.minDescPct || 0, monto: sesion.minDescMonto || 0 });
    total = r.total; descMonto = r.descMonto; etiquetaDescuento = r.etiqueta;
    mostrarDescuento = descMonto > 0;
    textoMarcaAgua = sesion.sello === 'pagado' ? 'PAGADO' : sesion.sello === 'apagar' ? 'A PAGAR' : null;
  }

  const ahora = new Date();
  const html = construirTicketHTML({
    cliente: nombreFinal,
    direccion: direccionFinal,
    telefono: telefonoFinal,
    fecha: ahora.toLocaleDateString('es-AR'),
    filas, subtotal, descMonto, total,
    etiquetaDescuento, mostrarDescuento,
    logoDataUrl: LOGO_DATA_URL,
    textoMarcaAgua
  });

  bot.sendMessage(chatId, 'Generando el PDF...');
  const pdfBuffer = await generarPdfBuffer(html);
  const filename = nombreArchivo(nombreFinal, ahora);

  await bot.sendDocument(chatId, pdfBuffer, {}, { filename, contentType: 'application/pdf' });

  let copiaEnDrive = null;
  try {
    const drive = driveClient();
    copiaEnDrive = await guardarPdfEnDrive(drive, filename, pdfBuffer);
  } catch (err) {
    console.error('No se pudo guardar copia en Drive:', err.message);
  }

  const avisos = [];
  if (modo === 'mayorista' && !sesion.esGuardado) avisos.push(`ℹ Cliente ocasional (no está en la lista guardada): "${nombreFinal}" — descuento aplicado: ${etiquetaDescuento}.`);
  const asumidos = resueltas.filter(r => r.materialAsumido);
  if (asumidos.length) avisos.push(`⚠ Asumí tricapa en ${asumidos.length} línea(s) porque no se especificó el material.`);
  if (noResueltas.length) avisos.push(`⚠ No pude interpretar: ${noResueltas.map(l => `"${l}"`).join(', ')}.`);
  if (copiaEnDrive) avisos.push(`Copia guardada en Drive: ${copiaEnDrive}`);
  if (avisos.length) bot.sendMessage(chatId, avisos.join('\n'));

  sesiones.delete(chatId);
  bot.sendMessage(chatId, '¿Otro presupuesto?', {
    reply_markup: { inline_keyboard: [[{ text: '🔁 Nuevo presupuesto', callback_data: 'nuevo' }]] }
  });
}

// --- Botones tocados ---

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data || '';

  if (!autorizado(chatId)) {
    try { await bot.answerCallbackQuery(query.id); } catch (e) {}
    return;
  }

  try {
    await bot.answerCallbackQuery(query.id);
    const sesion = sesiones.get(chatId) || {};
    sesiones.set(chatId, sesion);

    if (data === 'modo:mayorista') {
      sesion.modo = 'mayorista';
      sesion.pagina = 0;
      sesion.esperando = 'buscar-cliente';
      const drive = driveClient();
      sesion.clientes = await listarClientes(drive);
      if (sesion.clientes.length === 0) {
        bot.sendMessage(chatId, 'No pude leer la lista de clientes guardados ahora. Puede ser un cliente ocasional igual:');
      }
      pedirNombreClienteMayorista(chatId);
      return;
    }

    if (data === 'verlista') {
      enviarPaginaClientes(chatId, sesion);
      return;
    }

    if (data === 'modo:minorista') {
      sesion.modo = 'minorista';
      sesion.esperando = 'nombre-minorista';
      bot.sendMessage(chatId, 'Escribime el nombre del cliente:');
      return;
    }

    if (data.startsWith('pag:')) {
      sesion.pagina = parseInt(data.slice(4), 10) || 0;
      enviarPaginaClientes(chatId, sesion);
      return;
    }

    if (data === 'cliente:ocasional') {
      sesion.esperando = 'nombre-ocasional';
      bot.sendMessage(chatId, 'Escribime el nombre del cliente ocasional:');
      return;
    }

    if (data.startsWith('cliente:')) {
      const idx = parseInt(data.slice('cliente:'.length), 10);
      const cliente = (sesion.clientes || [])[idx];
      if (!cliente) {
        bot.sendMessage(chatId, 'Ese cliente ya no está disponible. Escribí /nuevo para empezar de nuevo.');
        return;
      }
      seleccionarClienteGuardado(sesion, cliente);
      pedirPedido(chatId, sesion);
      return;
    }

    if (data.startsWith('desc:')) {
      const key = data.slice('desc:'.length);
      if (key === 'otro') {
        sesion.esperando = 'descuento-ocasional-custom';
        bot.sendMessage(chatId, 'Escribí el descuento, por ejemplo 10 o 10+5 (encadenado):');
        return;
      }
      const descuentos = key === '0' ? [] : key.split('-').map(Number);
      sesion.esGuardado = false;
      sesion.clienteFinal = { nombre: sesion.clienteOcasionalNombre, direccion: '—', descuentos };
      pedirPedido(chatId, sesion);
      return;
    }

    if (data === 'tel:ninguno') {
      sesion.minTelefono = '';
      sesion.esperando = null;
      preguntarDescuentoMinorista(chatId);
      return;
    }

    if (data.startsWith('minodesc:')) {
      const tipo = data.slice('minodesc:'.length);
      if (tipo === 'ninguno') {
        sesion.minDescPct = 0;
        sesion.minDescMonto = 0;
        preguntarSello(chatId);
      } else if (tipo === 'pct') {
        sesion.esperando = 'descuento-minorista-pct';
        bot.sendMessage(chatId, 'Escribí el % de descuento (ej. 10):');
      } else if (tipo === 'monto') {
        sesion.esperando = 'descuento-minorista-monto';
        bot.sendMessage(chatId, 'Escribí el monto fijo de descuento en $ (ej. 5000):');
      }
      return;
    }

    if (data.startsWith('sello:')) {
      const tipo = data.slice('sello:'.length);
      sesion.sello = tipo === 'ninguno' ? null : tipo;
      pedirPedido(chatId, sesion);
      return;
    }

    if (data === 'nuevo') {
      pedirModo(chatId);
      return;
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Ocurrió un error: ' + err.message);
  }
});

// --- Mensajes de texto ---

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const texto = (msg.text || '').trim();
  if (!texto) return;

  if (texto === '/start' || texto === '/ayuda' || texto === '/help' || texto === '/nuevo') {
    if (!autorizado(chatId)) {
      bot.sendMessage(chatId, `Este chat todavía no está autorizado — avisale al administrador.\n(Tu chat id es ${chatId})`);
      return;
    }
    bot.sendMessage(chatId, 'Te voy guiando con botones para armar el presupuesto. Al final te pido el pedido escrito, un producto por línea (ej. "10 1000T"), porque eso es más rápido escribirlo que tocarlo.');
    pedirModo(chatId);
    return;
  }

  if (!autorizado(chatId)) {
    console.log(`Mensaje ignorado de chat no autorizado: ${chatId}`);
    return;
  }

  const sesion = sesiones.get(chatId);
  if (!sesion || !sesion.esperando) {
    if (sesion && sesion.modo) {
      bot.sendMessage(chatId, 'Usá los botones de arriba 👆 (o escribí /nuevo para empezar de cero).');
      return;
    }

    // Mensaje "en frío" (sin haber tocado ningún botón todavía): probamos si es una
    // búsqueda directa de cliente mayorista, para no obligar a tocar "Mayorista" antes
    // de poder escribir el nombre — así se sigue pudiendo arrancar escribiendo, como
    // antes de que existiera el flujo a botones.
    try {
      const drive = driveClient();
      const clientes = await listarClientes(drive);
      const matches = filtrarClientes(texto, clientes);
      if (matches.length > 0) {
        const nuevaSesion = { modo: 'mayorista', clientes, pagina: 0, esperando: 'buscar-cliente' };
        sesiones.set(chatId, nuevaSesion);
        mostrarResultadosBusqueda(chatId, nuevaSesion, texto, matches);
        return;
      }
    } catch (err) {
      console.error('Error buscando cliente en mensaje inicial:', err.message);
    }

    pedirModo(chatId);
    return;
  }

  try {
    switch (sesion.esperando) {
      case 'buscar-cliente': {
        const matches = filtrarClientes(texto, sesion.clientes || []);

        if (matches.length === 0) {
          bot.sendMessage(chatId, `No encontré ningún cliente con "${texto}". Probá con otra parte del nombre, o usá los botones de arriba.`);
          break;
        }

        mostrarResultadosBusqueda(chatId, sesion, texto, matches);
        break;
      }

      case 'nombre-minorista': {
        sesion.minNombre = texto;
        sesion.esperando = 'telefono-minorista';
        bot.sendMessage(chatId, 'Teléfono (opcional) — escribilo o tocá "Sin teléfono":', {
          reply_markup: { inline_keyboard: [[{ text: 'Sin teléfono', callback_data: 'tel:ninguno' }]] }
        });
        break;
      }

      case 'telefono-minorista': {
        sesion.minTelefono = texto;
        sesion.esperando = null;
        preguntarDescuentoMinorista(chatId);
        break;
      }

      case 'nombre-ocasional': {
        sesion.clienteOcasionalNombre = texto;
        sesion.esperando = null;
        bot.sendMessage(chatId, `¿Descuento para "${texto}"?`, { reply_markup: { inline_keyboard: [
          [{ text: 'Sin descuento', callback_data: 'desc:0' }],
          [{ text: '5%', callback_data: 'desc:5' }, { text: '10%', callback_data: 'desc:10' }],
          [{ text: '10%+5%', callback_data: 'desc:10-5' }, { text: '10%+5%+5%', callback_data: 'desc:10-5-5' }],
          [{ text: 'Otro...', callback_data: 'desc:otro' }]
        ] } });
        break;
      }

      case 'descuento-ocasional-custom': {
        const valido = texto.match(/^\d{1,2}(\s*\+\s*\d{1,2})*\s*%?$/);
        if (!valido) {
          bot.sendMessage(chatId, 'No entendí ese descuento. Escribilo como 10 o 10+5 (encadenado):');
          break;
        }
        const descuentos = texto.replace('%', '').split('+').map(s => parseFloat(s.trim())).filter(d => d > 0);
        sesion.esGuardado = false;
        sesion.clienteFinal = { nombre: sesion.clienteOcasionalNombre, direccion: '—', descuentos };
        sesion.esperando = null;
        pedirPedido(chatId, sesion);
        break;
      }

      case 'descuento-minorista-pct': {
        const pct = parseFloat(texto.replace(',', '.').replace('%', ''));
        if (isNaN(pct) || pct < 0) {
          bot.sendMessage(chatId, 'Escribí solo el número, ej. 10:');
          break;
        }
        sesion.minDescPct = pct;
        sesion.minDescMonto = 0;
        sesion.esperando = null;
        preguntarSello(chatId);
        break;
      }

      case 'descuento-minorista-monto': {
        const monto = parseFloat(texto.replace(/[^\d.,-]/g, '').replace(',', '.'));
        if (isNaN(monto) || monto < 0) {
          bot.sendMessage(chatId, 'Escribí solo el número, ej. 5000:');
          break;
        }
        sesion.minDescMonto = monto;
        sesion.minDescPct = 0;
        sesion.esperando = null;
        preguntarSello(chatId);
        break;
      }

      case 'pedido': {
        await generarYEnviarPresupuesto(chatId, sesion, texto);
        break;
      }

      default:
        bot.sendMessage(chatId, 'Usá los botones de arriba 👆 (o escribí /nuevo para empezar de cero).');
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, 'Ocurrió un error generando el presupuesto: ' + err.message);
  }
});

bot.on('polling_error', (err) => console.error('Error de polling de Telegram:', err.message));

// Prueba local de la lógica central del bot, sin Telegram ni Drive reales: simula un
// cliente guardado y un mensaje tipo "Fenix / 10 1000T / 6 750B", y genera el PDF real.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const { interpretarPedido, normalizar } = require('../src/orderParser.js');
const { construirTicketHTML } = require('../src/ticketTemplate.js');
const { aplicarDescuentos } = require('../src/pricing.js');
const CATALOG = require('../src/catalog.json');

const CLIENTES_SIMULADOS = [
  { nombre: 'Fenix', direccion: 'Av. San Martín 2435', descuento1: '10', descuento2: '5', descuento3: '0' }
];

function buscarCliente(nombreBuscado, clientes) {
  const tokens = normalizar(nombreBuscado).trim().split(/\s+/).filter(Boolean);
  const coincidencias = clientes.filter(c => {
    const nombreNorm = normalizar(c.nombre);
    return tokens.every(t => nombreNorm.includes(t));
  });
  if (coincidencias.length === 1) return { tipo: 'ok', cliente: coincidencias[0] };
  return { tipo: 'no-encontrado' };
}

function etiquetaDescuentos(descuentos) {
  return descuentos.length ? descuentos.map(d => d + '%').join(' + ') : '0%';
}

async function main() {
  const mensaje = 'Fenix\n10 1000T\n6 750B';
  const [nombreCliente, ...resto] = mensaje.split('\n');
  const textoPedido = resto.join('\n');

  const { cliente } = buscarCliente(nombreCliente, CLIENTES_SIMULADOS);
  const { resueltas, noResueltas } = interpretarPedido(textoPedido, CATALOG);

  console.log('Cliente encontrado:', cliente.nombre, '- descuentos:', cliente.descuento1, cliente.descuento2, cliente.descuento3);
  console.log('Líneas resueltas:', resueltas.length, '- no resueltas:', noResueltas);

  const filas = resueltas.map(r => {
    const producto = CATALOG[r.idx];
    return {
      cant: r.cantidad,
      etiqueta: [producto.categoria, producto.subcategoria, producto.capacidad].filter(Boolean).join(' - '),
      precioUnitario: producto.precio,
      importe: r.cantidad * producto.precio
    };
  });
  filas.forEach(f => console.log(`  x${f.cant}  ${f.etiqueta}  $${f.precioUnitario}  = $${f.importe}`));

  const subtotal = filas.reduce((acc, f) => acc + f.importe, 0);
  const descuentos = [cliente.descuento1, cliente.descuento2, cliente.descuento3].map(d => parseFloat(d) || 0).filter(d => d > 0);
  const { total, descMonto } = aplicarDescuentos(subtotal, descuentos);
  console.log('Subtotal:', subtotal, '- Descuento:', descMonto, '- Total:', total);

  const logoDataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'src', 'logo.png')).toString('base64');
  const html = construirTicketHTML({
    cliente: cliente.nombre, direccion: cliente.direccion, telefono: '',
    fecha: new Date().toLocaleDateString('es-AR'),
    filas, subtotal, descMonto, total,
    etiquetaDescuento: etiquetaDescuentos(descuentos),
    mostrarDescuento: true, logoDataUrl, textoMarcaAgua: null
  });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const pdfBuffer = Buffer.from(await page.pdf({ format: 'A4', printBackground: true }));
  await browser.close();

  // node-telegram-bot-api solo adjunta el archivo bien si es un Buffer de Node de
  // verdad (Buffer.isBuffer) — Puppeteer 22+ devuelve Uint8Array, hay que convertirlo
  // (ver el mismo Buffer.from() en generarPdfBuffer() de index.js). Si esto da false,
  // enviar el PDF por Telegram rompe con "Maximum call stack size exceeded".
  console.log('¿Es un Buffer de Node? (tiene que decir true):', Buffer.isBuffer(pdfBuffer));

  const outPath = path.join(__dirname, 'test-output.pdf');
  fs.writeFileSync(outPath, pdfBuffer);
  console.log('PDF de prueba escrito en', outPath, `(${pdfBuffer.length} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });

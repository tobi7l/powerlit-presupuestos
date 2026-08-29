let CATALOG = [];
let CLIENTES = [];
let LOGO_DATA_URL = '';
let rowCounter = 0;
let dropdownAbierto = null; // referencia al <div class="detalle-dropdown"> abierto actualmente
let ultimoPdfGenerado = null; // ruta del último PDF generado, para el botón "Mostrar PDF"
let modoMinorista = false; // false = precios mayoristas (por defecto al abrir la app)
let estadoPago = null; // null | 'pagado' | 'a-pagar' — leyenda del PDF, solo en minorista

function precioDe(producto) {
  return modoMinorista ? producto.precioMinorista : producto.precio;
}

function fmtMoney(n) {
  return '$ ' + (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function etiquetaProducto(p) {
  return [p.categoria, p.subcategoria, p.capacidad].filter(Boolean).join(' - ');
}

function cerrarDropdown() {
  if (dropdownAbierto) {
    dropdownAbierto.style.display = 'none';
    dropdownAbierto = null;
  }
}

function abrirDropdown(dropdownEl) {
  cerrarDropdown();
  dropdownEl.style.display = 'block';
  dropdownAbierto = dropdownEl;
}

// normalizar() (sin acentos ni mayúsculas) viene de orderParser.js, cargado antes que este script.

function renderSugerencias(tr, query) {
  const dropdown = tr.querySelector('.detalle-dropdown');
  const tokens = normalizar(query).trim().split(/\s+/).filter(Boolean);

  const coincidencias = tokens.length === 0
    ? CATALOG.map((p, idx) => ({ idx, label: etiquetaProducto(p) }))
    : CATALOG
        .map((p, idx) => ({ idx, label: etiquetaProducto(p) }))
        .filter(item => {
          const labelNorm = normalizar(item.label);
          return tokens.every(t => labelNorm.includes(t));
        });

  if (coincidencias.length === 0) {
    dropdown.innerHTML = '<div class="detalle-vacio">Sin resultados</div>';
  } else {
    dropdown.innerHTML = coincidencias
      .map(item => `<div class="detalle-opcion" data-idx="${item.idx}">${item.label}</div>`)
      .join('');
  }
  abrirDropdown(dropdown);
}

function seleccionarProducto(tr, idx) {
  const input = tr.querySelector('.in-detalle');
  const producto = CATALOG[idx];
  input.value = etiquetaProducto(producto);
  input.dataset.idx = String(idx);
  cerrarDropdown();
  updateRow(tr);
}

function addRow() {
  rowCounter++;
  const id = 'row-' + rowCounter;
  const tbody = document.getElementById('items-body');
  const tr = document.createElement('tr');
  tr.id = id;

  tr.innerHTML = `
    <td><input type="number" min="1" value="1" class="in-cant" /></td>
    <td class="detalle-cell">
      <input type="text" class="in-detalle" placeholder="Escribir para buscar…" autocomplete="off" />
      <div class="detalle-dropdown"></div>
    </td>
    <td class="money-val out-unitario">$ 0,00</td>
    <td class="money-val out-importe">$ 0,00</td>
    <td><button class="row-del-btn" title="Quitar">✕</button></td>
  `;
  tbody.appendChild(tr);

  const detInput = tr.querySelector('.in-detalle');
  const cantInp = tr.querySelector('.in-cant');
  const delBtn = tr.querySelector('.row-del-btn');
  const dropdown = tr.querySelector('.detalle-dropdown');

  detInput.addEventListener('input', () => {
    delete detInput.dataset.idx; // escribir invalida la selección anterior
    updateRow(tr);
    renderSugerencias(tr, detInput.value);
  });
  detInput.addEventListener('focus', () => renderSugerencias(tr, detInput.value));
  detInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cerrarDropdown(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const primera = dropdown.querySelector('.detalle-opcion');
      if (primera) seleccionarProducto(tr, parseInt(primera.dataset.idx, 10));
    }
  });
  dropdown.addEventListener('mousedown', (e) => {
    const opcion = e.target.closest('.detalle-opcion');
    if (!opcion) return;
    e.preventDefault();
    seleccionarProducto(tr, parseInt(opcion.dataset.idx, 10));
  });

  cantInp.addEventListener('input', () => updateRow(tr));
  delBtn.addEventListener('click', () => { tr.remove(); recalcTotals(); });

  updateRow(tr);
}

document.addEventListener('mousedown', (e) => {
  if (dropdownAbierto && !e.target.closest('.detalle-cell') && !e.target.closest('.cliente-cell')) cerrarDropdown();
});

// --- Buscador de cliente (autocompleta dirección y descuentos habituales) ---

function renderSugerenciasClientes(query) {
  const dropdown = document.getElementById('cliente-dropdown');
  const tokens = normalizar(query).trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0 || CLIENTES.length === 0) {
    cerrarDropdown();
    return;
  }

  const coincidencias = CLIENTES.filter(c => {
    const nombreNorm = normalizar(c.nombre);
    return tokens.every(t => nombreNorm.includes(t));
  });

  if (coincidencias.length === 0) {
    cerrarDropdown();
    return;
  }

  dropdown.innerHTML = coincidencias
    .map(c => `<div class="detalle-opcion" data-id="${c.id}">${c.nombre}</div>`)
    .join('');
  abrirDropdown(dropdown);
}

function seleccionarCliente(id) {
  const c = CLIENTES.find(x => x.id === id);
  if (!c) return;
  const clienteInput = document.getElementById('cliente');
  clienteInput.value = c.nombre;
  clienteInput.dataset.clienteId = c.id;
  document.getElementById('direccion').value = c.direccion || '';
  document.getElementById('descuento1').value = c.descuento1 || '0';
  document.getElementById('descuento2').value = c.descuento2 || '0';
  document.getElementById('descuento3').value = c.descuento3 || '0';
  recalcTotals();
  cerrarDropdown();
}

function initBuscadorClientes() {
  const clienteInput = document.getElementById('cliente');
  const dropdown = document.getElementById('cliente-dropdown');

  clienteInput.addEventListener('input', () => {
    delete clienteInput.dataset.clienteId; // escribir invalida la selección anterior
    renderSugerenciasClientes(clienteInput.value);
  });
  clienteInput.addEventListener('focus', () => renderSugerenciasClientes(clienteInput.value));
  clienteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cerrarDropdown(); return; }
    if (e.key === 'Enter') {
      const primera = dropdown.querySelector('.detalle-opcion');
      if (primera) { e.preventDefault(); seleccionarCliente(primera.dataset.id); }
    }
  });
  dropdown.addEventListener('mousedown', (e) => {
    const opcion = e.target.closest('.detalle-opcion');
    if (!opcion) return;
    e.preventDefault();
    seleccionarCliente(opcion.dataset.id);
  });
}

// Guarda el cliente que está cargado ahora mismo en el formulario (nombre, dirección y
// los 3 descuentos), para poder reusarlo la próxima vez sin tipear todo de nuevo.
async function guardarClienteActual() {
  const clienteInput = document.getElementById('cliente');
  const nombre = clienteInput.value.trim();
  if (!nombre) { clienteInput.focus(); return; }

  CLIENTES = await window.powerlit.guardarCliente({
    id: clienteInput.dataset.clienteId,
    nombre,
    direccion: document.getElementById('direccion').value.trim(),
    descuento1: document.getElementById('descuento1').value,
    descuento2: document.getElementById('descuento2').value,
    descuento3: document.getElementById('descuento3').value
  });

  const guardado = CLIENTES.find(c => normalizar(c.nombre) === normalizar(nombre));
  if (guardado) clienteInput.dataset.clienteId = guardado.id;

  const btn = document.getElementById('btn-guardar-cliente');
  const textoOriginal = btn.textContent;
  btn.textContent = '✔ Guardado';
  setTimeout(() => { btn.textContent = textoOriginal; }, 1500);
}

// --- Modal "Clientes guardados" ---

function etiquetaDescuentosCliente(c) {
  const descs = [c.descuento1, c.descuento2, c.descuento3].map(d => parseInt(d, 10) || 0).filter(d => d > 0);
  return descs.length ? descs.map(d => d + '%').join(' + ') : 'sin descuento';
}

function renderListaClientes() {
  const cont = document.getElementById('clientes-lista');
  if (CLIENTES.length === 0) {
    cont.innerHTML = '<div class="clientes-vacio">Todavía no guardaste ningún cliente. Cargá uno en el formulario y tocá "💾 Guardar cliente".</div>';
    return;
  }
  const ordenados = [...CLIENTES].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  cont.innerHTML = ordenados.map(c => `
    <div class="cliente-fila" data-id="${c.id}">
      <div class="cliente-fila-datos">
        <div class="cliente-fila-nombre">${c.nombre}</div>
        <div class="cliente-fila-detalle">${c.direccion || 'sin dirección'} · ${etiquetaDescuentosCliente(c)}</div>
      </div>
      <div class="cliente-fila-botones">
        <button class="btn-cliente-usar" type="button">Usar</button>
        <button class="btn-cliente-borrar" type="button" title="Eliminar">🗑</button>
      </div>
    </div>`).join('');
}

async function abrirModalClientes() {
  CLIENTES = await window.powerlit.listarClientes();
  renderListaClientes();
  document.getElementById('modal-clientes').hidden = false;
}

function cerrarModalClientes() {
  document.getElementById('modal-clientes').hidden = true;
}

// Busca una fila ya existente que esté vacía (sin producto elegido) para reutilizarla
// antes de crear una fila nueva — si no, el importador dejaba la primera fila (la que
// ya estaba en blanco al abrir la app) sin completar y arrancaba desde la segunda.
function filaVaciaExistente() {
  for (const tr of document.querySelectorAll('#items-body tr')) {
    if (!tr.querySelector('.in-detalle').dataset.idx) return tr;
  }
  return null;
}

// Agrega una fila ya resuelta por el importador de pedidos. Si el material se asumió
// (el mensaje no decía tricapa/bicapa/cuatricapa), la fila queda resaltada para revisar.
function agregarFilaImportada(idx, cantidad, materialAsumido) {
  let tr = filaVaciaExistente();
  if (!tr) {
    addRow();
    tr = document.querySelector('#items-body tr:last-child');
  }
  seleccionarProducto(tr, idx);
  tr.querySelector('.in-cant').value = cantidad;
  updateRow(tr);
  if (materialAsumido) tr.classList.add('fila-asumida');
}

function productoDeFila(tr) {
  const input = tr.querySelector('.in-detalle');
  if (input.dataset.idx === undefined || input.dataset.idx === '') return null;
  return CATALOG[parseInt(input.dataset.idx, 10)] || null;
}

function updateRow(tr) {
  const cant = parseFloat(tr.querySelector('.in-cant').value) || 0;
  const producto = productoDeFila(tr);
  const precio = producto ? precioDe(producto) : 0;
  const importe = cant * precio;
  tr.querySelector('.out-unitario').textContent = fmtMoney(precio);
  tr.querySelector('.out-importe').textContent = fmtMoney(importe);
  recalcTotals();
}

function filasValidas() {
  const filas = [];
  document.querySelectorAll('#items-body tr').forEach(tr => {
    const cant = parseFloat(tr.querySelector('.in-cant').value) || 0;
    const producto = productoDeFila(tr);
    if (!producto || cant <= 0) return;
    filas.push({ cant, producto });
  });
  return filas;
}

// En modo mayorista los 3 descuentos se aplican en cadena, cada uno sobre el saldo
// que deja el anterior (10% + 5% + 5% da un descuento total un poco menor al 20%,
// no exactamente 20%).
function descuentosSeleccionados() {
  return ['descuento1', 'descuento2', 'descuento3']
    .map(id => parseFloat(document.getElementById(id).value) || 0)
    .filter(d => d > 0);
}

function aplicarDescuentos(subtotal, descuentos) {
  let total = subtotal;
  descuentos.forEach(d => { total *= (1 - d / 100); });
  return { total, descMonto: subtotal - total };
}

function etiquetaDescuentos(descuentos) {
  return descuentos.length ? descuentos.map(d => d + '%').join(' + ') : '0%';
}

// En minorista hay dos formas de descuento excluyentes entre sí (o un % o un monto
// fijo en $, nunca los dos juntos — para eso están deshabilitados uno al otro, ver
// sincronizarDescuentosMinorista). Si hay un monto en $ cargado, tiene prioridad.
function calcularDescuento(subtotal) {
  if (modoMinorista) {
    const monto = parseFloat(document.getElementById('descuento-minorista-monto').value) || 0;
    if (monto > 0) {
      const total = Math.max(0, subtotal - monto);
      return { total, descMonto: subtotal - total, etiqueta: fmtMoney(monto) };
    }
    const pct = parseFloat(document.getElementById('descuento-minorista').value) || 0;
    const { total, descMonto } = aplicarDescuentos(subtotal, pct > 0 ? [pct] : []);
    return { total, descMonto, etiqueta: pct + '%' };
  }
  const descuentos = descuentosSeleccionados();
  const { total, descMonto } = aplicarDescuentos(subtotal, descuentos);
  return { total, descMonto, etiqueta: etiquetaDescuentos(descuentos) };
}

// Los dos descuentos de minorista son excluyentes: cargar uno apaga (y vacía) el
// otro. Cada campo tiene su propio manejador — así el que se acaba de tocar manda
// siempre, sin ambigüedad sobre "cuál gana" si por un instante los dos tienen valor.
function alCambiarDescuentoPorcentaje() {
  const pct = parseFloat(document.getElementById('descuento-minorista').value) || 0;
  const inpMonto = document.getElementById('descuento-minorista-monto');
  if (pct > 0) {
    inpMonto.value = '';
    inpMonto.disabled = true;
  } else {
    inpMonto.disabled = false;
  }
}

function alCambiarDescuentoMonto() {
  const monto = parseFloat(document.getElementById('descuento-minorista-monto').value) || 0;
  const selPct = document.getElementById('descuento-minorista');
  if (monto > 0) {
    selPct.value = '0';
    selPct.disabled = true;
  } else {
    selPct.disabled = false;
  }
}

function recalcTotals() {
  const filas = filasValidas();
  const subtotal = filas.reduce((acc, f) => acc + f.cant * precioDe(f.producto), 0);
  const { total, descMonto, etiqueta } = calcularDescuento(subtotal);

  document.getElementById('out-subtotal').textContent = fmtMoney(subtotal);
  document.getElementById('out-desc-pct').textContent = etiqueta;
  document.getElementById('out-desc-monto').textContent = '- ' + fmtMoney(descMonto);
  document.getElementById('out-total').textContent = fmtMoney(total);
}

function buildTicketHTML() {
  const cliente = document.getElementById('cliente').value.trim() || '—';
  const direccion = document.getElementById('direccion').value.trim() || '—';
  const telefono = document.getElementById('telefono').value.trim();
  const fechaVal = document.getElementById('fecha').value;
  const fecha = fechaVal ? new Date(fechaVal + 'T00:00:00').toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR');

  const filas = filasValidas();
  const subtotal = filas.reduce((acc, f) => acc + f.cant * precioDe(f.producto), 0);
  const { total, descMonto, etiqueta } = calcularDescuento(subtotal);

  const filasHTML = filas.map(f => `
    <tr>
      <td style="text-align:center">${f.cant}</td>
      <td>${etiquetaProducto(f.producto)}</td>
      <td style="text-align:right">${fmtMoney(precioDe(f.producto))}</td>
      <td style="text-align:right">${fmtMoney(f.cant * precioDe(f.producto))}</td>
    </tr>`).join('');

  // Leyenda tipo sello (solo minorista, y solo si se eligió una): negra, transparente,
  // en diagonal sobre el presupuesto — igual de estilo al watermark de las libretas
  // impresas de "MODELO EJEMPLO", pero para marcar si ya se cobró o no. Negra (no
  // naranja) para que se lea completa aunque cruce la franja naranja de la tabla.
  const textoMarcaAgua = modoMinorista && estadoPago
    ? (estadoPago === 'pagado' ? 'PAGADO' : 'A PAGAR')
    : null;

  return `
  <html><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; color: #24272A; padding: 36px 40px; position: relative; }
    .marca-agua {
      position: absolute;
      top: 26%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-25deg);
      font-size: 90px;
      font-weight: 900;
      letter-spacing: 4px;
      color: rgba(0, 0, 0, 0.2);
      white-space: nowrap;
      z-index: 1000;
    }
    .membrete { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1B1B1B; padding-bottom: 14px; }
    .membrete .logo { width: 190px; height: auto; display: block; }
    .membrete .datos { text-align: right; font-size: 11.5px; color: #444; line-height: 1.5; }
    .membrete .datos b { color: #1B1B1B; font-size: 13px; }
    .meta { margin: 20px 0 4px; font-size: 13px; display: flex; justify-content: space-between; }
    .meta div b { color: #1B1B1B; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th { text-align: left; background: #E1690E; color: #fff; padding: 8px; text-transform: uppercase; font-size: 11px; }
    td { padding: 7px 8px; border-bottom: 1px solid #E3E3E3; }
    tbody tr:nth-child(even) { background: #FAFAF8; }
    .totales { margin-top: 18px; width: 280px; margin-left: auto; font-size: 13px; }
    .totales div { display: flex; justify-content: space-between; padding: 4px 0; }
    .totales .total { font-weight: bold; font-size: 17px; border-top: 2px solid #1B1B1B; margin-top: 8px; padding-top: 8px; }
  </style></head>
  <body>
    ${textoMarcaAgua ? `<div class="marca-agua">${textoMarcaAgua}</div>` : ''}
    <div class="membrete">
      <img class="logo" src="${LOGO_DATA_URL}" alt="Powerlit" />
      <div class="datos">
        <b>PRESUPUESTO</b><br/>
        Remedios de Escalada 4747, San Justo<br/>
        Cel.: 11 3173-7227<br/>
        powerlit.tanques@hotmail.com
      </div>
    </div>
    <div class="meta">
      <div><b>Cliente:</b> ${cliente}<br/><b>Dirección:</b> ${direccion}${telefono ? `<br/><b>Teléfono:</b> ${telefono}` : ''}</div>
      <div><b>Fecha:</b> ${fecha}</div>
    </div>
    <table>
      <thead><tr><th style="text-align:center">Cant.</th><th>Detalle</th><th style="text-align:right">Unitario</th><th style="text-align:right">Importe</th></tr></thead>
      <tbody>${filasHTML}</tbody>
    </table>
    <div class="totales">
      <div><span>Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
      <div><span>Descuento (${etiqueta})</span><span>- ${fmtMoney(descMonto)}</span></div>
      <div class="total"><span>TOTAL</span><span>${fmtMoney(total)}</span></div>
    </div>
  </body></html>`;
}

function nombreArchivo(cliente, fechaVal) {
  const [anio, mes, dia] = fechaVal.split('-');
  const anioCorto = anio.slice(2);
  const clienteLimpio = cliente.replace(/[\\/:*?"<>|]/g, '').trim() || 'Cliente';
  return `${dia}-${mes}-${anioCorto} - ${clienteLimpio}.pdf`;
}

async function generarPDF() {
  const status = document.getElementById('save-status');
  const acciones = document.getElementById('post-generar-acciones');
  acciones.hidden = true;

  const filas = filasValidas();
  if (filas.length === 0) {
    status.textContent = 'Agregá al menos un producto antes de generar el PDF.';
    status.className = 'save-status error';
    return;
  }

  const cliente = document.getElementById('cliente').value.trim() || 'Cliente';
  const fechaVal = document.getElementById('fecha').value || new Date().toISOString().slice(0, 10);
  const filename = nombreArchivo(cliente, fechaVal);

  status.textContent = 'Generando PDF…';
  status.className = 'save-status';

  const html = buildTicketHTML();
  const res = await window.powerlit.generarPDF({ html, filename, fecha: fechaVal });

  if (res.ok) {
    status.textContent = `Guardado en: ${res.fullPath}`;
    status.className = 'save-status';
    ultimoPdfGenerado = res.fullPath;
    acciones.hidden = false;
  } else {
    status.textContent = 'Error al guardar: ' + res.error;
    status.className = 'save-status error';
  }
}

async function initSettings() {
  const folderLabel = document.getElementById('folder-path');
  const driveBadge = document.getElementById('drive-badge');
  const btn = document.getElementById('btn-settings');

  const settings = await window.powerlit.getSettings();
  if (settings.version) {
    document.getElementById('app-version').textContent = 'v' + settings.version;
  }
  if (settings.savePath) {
    folderLabel.textContent = settings.savePath;
    folderLabel.title = settings.savePath + '\n(dentro se organiza solo por año y mes)';
  }
  if (settings.driveDetectado) {
    driveBadge.textContent = '☁ Google Drive detectado';
    driveBadge.className = 'drive-badge si';
    driveBadge.title = 'Se encontró Google Drive en esta PC. Los PDF y la lista de clientes se guardan ahí, así se sincronizan solos en cualquier PC donde instales la app con esta misma cuenta de Google.';
  } else {
    driveBadge.textContent = '⚠ Google Drive no detectado';
    driveBadge.className = 'drive-badge no';
    driveBadge.title = 'No se encontró Google Drive en esta PC. Los PDF se guardan en Documentos, y la lista de clientes queda solo en esta PC (no se sincroniza) hasta que se detecte Drive.';
  }

  btn.addEventListener('click', async () => {
    const chosen = await window.powerlit.chooseFolder();
    if (chosen) {
      folderLabel.textContent = chosen;
      folderLabel.title = chosen + '\n(dentro se organiza solo por año y mes)';
    }
  });
}

function abrirModalImportar() {
  document.getElementById('importar-texto').value = '';
  document.getElementById('importar-archivo').textContent = '';
  document.getElementById('modal-importar').hidden = false;
  document.getElementById('importar-texto').focus();
}

function cerrarModalImportar() {
  document.getElementById('modal-importar').hidden = true;
}

async function pegarDelPortapapeles() {
  const texto = await window.powerlit.leerPortapapeles();
  const campo = document.getElementById('importar-texto');
  campo.value = texto || '';
  campo.focus();
}

async function adjuntarPdfPedido() {
  const res = await window.powerlit.elegirPdfPedido();
  if (!res) return;
  if (!res.ok) {
    document.getElementById('importar-archivo').textContent = res.error;
    return;
  }
  document.getElementById('importar-texto').value = res.texto;
  document.getElementById('importar-archivo').textContent = '📎 ' + res.nombreArchivo;
}

function interpretarPedidoDelModal() {
  const texto = document.getElementById('importar-texto').value;
  const { resueltas, noResueltas } = interpretarPedido(texto, CATALOG);

  resueltas.forEach(r => agregarFilaImportada(r.idx, r.cantidad, r.materialAsumido));

  const status = document.getElementById('save-status');
  const partes = [];
  if (resueltas.length) partes.push(`Se cargaron ${resueltas.length} producto(s) — revisá las filas resaltadas antes de generar.`);
  if (noResueltas.length) partes.push(`No se pudieron interpretar ${noResueltas.length} línea(s): ${noResueltas.map(l => `"${l}"`).join(', ')} — agregalas a mano con el buscador.`);
  if (!resueltas.length && !noResueltas.length) partes.push('No se encontró ningún producto en el texto pegado.');
  status.textContent = partes.join(' ');
  status.className = noResueltas.length ? 'save-status error' : 'save-status';

  cerrarModalImportar();
}

// Cambia entre precios mayoristas (por defecto) y minoristas. Recalcula todas las filas
// ya cargadas y cambia el color de toda la app (ver body.modo-minorista en styles.css)
// para que sea imposible no darse cuenta en qué modo se está.
function toggleModoMinorista() {
  modoMinorista = !modoMinorista;

  document.body.classList.toggle('modo-minorista', modoMinorista);
  document.getElementById('banner-minorista').hidden = !modoMinorista;
  const btn = document.getElementById('btn-modo-minorista');
  btn.classList.toggle('activo', modoMinorista);
  btn.textContent = modoMinorista ? '✓ Modo Minorista' : '🛒 Modo Minorista';

  // En minorista no aplica la lista de clientes mayoristas ni sus descuentos en cadena:
  // se esconden esos controles y aparecen el descuento único y el teléfono en su lugar.
  document.getElementById('btn-clientes').hidden = modoMinorista;
  document.getElementById('btn-guardar-cliente').hidden = modoMinorista;
  document.getElementById('fila-descuentos-mayorista').hidden = modoMinorista;
  document.getElementById('fila-descuentos-minorista').hidden = !modoMinorista;
  document.getElementById('fila-estado-minorista').hidden = !modoMinorista;
  document.getElementById('campo-telefono').hidden = !modoMinorista;

  // Al salir de minorista, la leyenda del PDF (Pagado / A pagar) no tiene sentido: se apaga.
  if (!modoMinorista) elegirEstadoPago(null);

  document.querySelectorAll('#items-body tr').forEach(updateRow);
  recalcTotals();
}

// Leyenda opcional que se estampa en el PDF (solo en minorista). Elegir la misma
// que ya está activa la apaga — por defecto no dice nada.
function elegirEstadoPago(valor) {
  estadoPago = (estadoPago === valor) ? null : valor;
  document.getElementById('btn-estado-pagado').classList.toggle('activo', estadoPago === 'pagado');
  document.getElementById('btn-estado-a-pagar').classList.toggle('activo', estadoPago === 'a-pagar');
}

// Vacía el formulario para empezar un presupuesto nuevo. La carpeta de guardado
// configurada NO se toca, es un ajuste de la app, no parte del presupuesto.
async function limpiarTodo() {
  const hayAlgoCargado = document.getElementById('cliente').value.trim()
    || document.getElementById('direccion').value.trim()
    || filasValidas().length > 0;

  if (hayAlgoCargado && !await window.powerlit.confirmar('¿Vaciar el presupuesto actual para empezar uno nuevo?')) return;

  document.getElementById('cliente').value = '';
  delete document.getElementById('cliente').dataset.clienteId;
  document.getElementById('direccion').value = '';
  document.getElementById('telefono').value = '';
  document.getElementById('fecha').value = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('.in-descuento').forEach(sel => { sel.value = '0'; sel.disabled = false; });
  document.getElementById('descuento-minorista-monto').value = '';
  document.getElementById('descuento-minorista-monto').disabled = false;
  elegirEstadoPago(null);

  document.getElementById('items-body').innerHTML = '';
  addRow();
  recalcTotals();

  const status = document.getElementById('save-status');
  status.textContent = '';
  status.className = 'save-status';
  document.getElementById('post-generar-acciones').hidden = true;
  ultimoPdfGenerado = null;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  const [catalogRes, logoRes, clientesIniciales] = await Promise.all([
    fetch('catalog.json'), fetch('logo.png'), window.powerlit.listarClientes()
  ]);
  CATALOG = await catalogRes.json();
  LOGO_DATA_URL = await blobToDataURL(await logoRes.blob());
  CLIENTES = clientesIniciales;

  document.getElementById('fecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('btn-add-row').addEventListener('click', addRow);
  document.querySelectorAll('.in-descuento').forEach(sel => {
    if (sel.id === 'descuento-minorista') return; // tiene su propio manejador combinado, abajo
    sel.addEventListener('change', recalcTotals);
  });
  document.getElementById('descuento-minorista').addEventListener('change', () => {
    alCambiarDescuentoPorcentaje();
    recalcTotals();
  });
  document.getElementById('descuento-minorista-monto').addEventListener('input', () => {
    alCambiarDescuentoMonto();
    recalcTotals();
  });
  document.getElementById('btn-generar').addEventListener('click', generarPDF);
  document.getElementById('btn-ver-pdf').addEventListener('click', () => {
    if (ultimoPdfGenerado) window.powerlit.abrirCarpeta(ultimoPdfGenerado);
  });
  document.getElementById('btn-limpiar-post').addEventListener('click', limpiarTodo);

  document.getElementById('btn-importar').addEventListener('click', abrirModalImportar);
  document.getElementById('btn-importar-cancelar').addEventListener('click', cerrarModalImportar);
  document.getElementById('btn-pegar').addEventListener('click', pegarDelPortapapeles);
  document.getElementById('btn-adjuntar-pdf').addEventListener('click', adjuntarPdfPedido);
  document.getElementById('btn-importar-interpretar').addEventListener('click', interpretarPedidoDelModal);
  document.getElementById('modal-importar').addEventListener('mousedown', (e) => {
    if (e.target.id === 'modal-importar') cerrarModalImportar();
  });
  document.getElementById('btn-limpiar').addEventListener('click', limpiarTodo);

  initBuscadorClientes();
  document.getElementById('btn-guardar-cliente').addEventListener('click', guardarClienteActual);
  document.getElementById('btn-clientes').addEventListener('click', abrirModalClientes);
  document.getElementById('btn-clientes-cerrar').addEventListener('click', cerrarModalClientes);
  document.getElementById('modal-clientes').addEventListener('mousedown', (e) => {
    if (e.target.id === 'modal-clientes') cerrarModalClientes();
  });
  document.getElementById('clientes-lista').addEventListener('click', async (e) => {
    const fila = e.target.closest('.cliente-fila');
    if (!fila) return;
    const id = fila.dataset.id;
    const c = CLIENTES.find(x => x.id === id);
    if (!c) return;

    if (e.target.classList.contains('btn-cliente-usar')) {
      seleccionarCliente(id);
      cerrarModalClientes();
    } else if (e.target.classList.contains('btn-cliente-borrar')) {
      if (!await window.powerlit.confirmar(`¿Eliminar a "${c.nombre}" de la lista de clientes?`)) return;
      CLIENTES = await window.powerlit.eliminarCliente(id);
      renderListaClientes();
    }
  });

  document.getElementById('btn-buscar-actualizaciones').addEventListener('click', () => {
    window.powerlit.buscarActualizaciones();
  });
  document.getElementById('btn-modo-minorista').addEventListener('click', toggleModoMinorista);
  document.getElementById('btn-estado-pagado').addEventListener('click', () => elegirEstadoPago('pagado'));
  document.getElementById('btn-estado-a-pagar').addEventListener('click', () => elegirEstadoPago('a-pagar'));

  addRow();
  initSettings();
});

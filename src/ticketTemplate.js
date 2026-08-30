// Arma el HTML del presupuesto (membrete, tabla, totales, sello opcional) a partir de
// datos ya calculados. Sin DOM, sin `window` — la usan tanto la app de escritorio
// (renderer.js junta los datos del formulario y llama a esto) como el bot de Telegram
// (junta los datos del pedido interpretado y llama a lo mismo), así el PDF que genera
// cada uno es siempre idéntico, sin mantener dos plantillas por separado.
function fmtMoney(n) {
  return '$ ' + (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function construirTicketHTML(datos) {
  const {
    cliente, direccion, telefono, fecha,
    filas, subtotal, descMonto, total, etiquetaDescuento,
    mostrarDescuento, logoDataUrl, textoMarcaAgua
  } = datos;

  const filasHTML = filas.map(f => `
    <tr>
      <td style="text-align:center">${f.cant}</td>
      <td>${f.etiqueta}</td>
      <td style="text-align:right">${fmtMoney(f.precioUnitario)}</td>
      <td style="text-align:right">${fmtMoney(f.importe)}</td>
    </tr>`).join('');

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
      <img class="logo" src="${logoDataUrl}" alt="Powerlit" />
      <div class="datos">
        <b>PRESUPUESTO</b><br/>
        Remedios de Escalada 4747, San Justo<br/>
        Cel.: 11 3173-7227<br/>
        contacto@powerlit.com.ar
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
      ${mostrarDescuento ? `<div><span>Descuento (${etiquetaDescuento})</span><span>- ${fmtMoney(descMonto)}</span></div>` : ''}
      <div class="total"><span>TOTAL</span><span>${fmtMoney(total)}</span></div>
    </div>
  </body></html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { construirTicketHTML, fmtMoney };
}

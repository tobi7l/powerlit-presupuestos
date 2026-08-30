// Cálculo de descuentos en cadena, compartido entre la app y el bot de Telegram —
// 10% + 5% + 5% se aplica cada uno sobre el saldo que deja el anterior, da un
// descuento total un poco menor al 20% (no exactamente 20%).
function aplicarDescuentos(subtotal, descuentos) {
  let total = subtotal;
  descuentos.forEach(d => { total *= (1 - d / 100); });
  return { total, descMonto: subtotal - total };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { aplicarDescuentos };
}

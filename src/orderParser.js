// Interpreta pedidos de clientes (texto de WhatsApp, o texto extraído de un PDF de orden
// de compra) contra el catálogo de Powerlit. Todo por reglas locales, sin IA ni internet.

function normalizar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const MATERIALES = [
  { subcategoria: 'tricapa', patrones: ['tricapa', 'tric', 't'] },
  { subcategoria: 'bicapa', patrones: ['bicapa', 'bic', 'b'] },
  { subcategoria: 'cuatricapa', patrones: ['cuatricapa', 'cuatri', 'cuad', 'c'] }
];

const SINONIMOS_CATEGORIA = [
  { categoria: 'Tanques', patrones: ['tanque', 'tanques'] },
  { categoria: 'Biodigestores', patrones: ['biodigestor', 'biodigestores'] },
  { categoria: 'Cámaras sépticas', patrones: ['camara septica', 'camaras septicas', 'camara septico'] },
  { categoria: 'Cisternas', patrones: ['cisterna', 'cisternas'] },
  { categoria: 'Cámaras desengrasantes', patrones: ['camara desengrasante', 'camaras desengrasantes', 'desengrasante', 'desengrasantes'] },
  { categoria: 'Cámara de inspección', patrones: ['camara de inspeccion', 'camara inspeccion'] },
  { categoria: 'Cámara registro de lodos', patrones: ['registro de lodos'] },
  { categoria: 'Tapas tanque fibrocemento', patrones: ['tapa fibrocemento', 'tapas fibrocemento'] },
  { categoria: 'Tapa con aro', patrones: ['tapa con aro', 'tapa aro'] },
  { categoria: 'Base de tanque', patrones: ['base de tanque', 'base tanque'] },
  { categoria: 'Conos', patrones: ['cono', 'conos'] }
];

function tieneToken(textoNorm, patron) {
  const escapado = patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^a-z0-9])' + escapado + '([^a-z0-9]|$)', 'i');
  return re.test(textoNorm);
}

function detectarCategoria(norm) {
  for (const { categoria, patrones } of SINONIMOS_CATEGORIA) {
    if (patrones.some(p => tieneToken(norm, p))) return categoria;
  }
  return null;
}

function detectarMaterial(norm) {
  for (const { subcategoria, patrones } of MATERIALES) {
    if (patrones.some(p => tieneToken(norm, p))) return subcategoria;
  }
  return null;
}

const ABREV_A_SUBCATEGORIA = {
  bicapa: 'bicapa', bic: 'bicapa', b: 'bicapa',
  tricapa: 'tricapa', tric: 'tricapa', t: 'tricapa',
  cuatricapa: 'cuatricapa', cuatri: 'cuatricapa', cuad: 'cuatricapa', c: 'cuatricapa'
};

function remapear500(valor, slim) {
  // "500" sin aclarar slim/xl/torre en la práctica significa el tanque de 470 lts,
  // no el de 500 lts slim (así piden los clientes, por costumbre del negocio).
  return (valor === 500 && !slim) ? 470 : valor;
}

// Devuelve { valor, slim, patagonico, materialDetectado? } o null. Solo cuenta como
// capacidad si el número viene acompañado de una pista clara (lts/litros, "de <numero>",
// pegado a una abreviatura de material como "470b", "750bic", "280 cuatri", o seguido de
// slim/xl/torre/patagónico/chato). slim y patagónico se buscan en toda la línea, sin
// importar si el material vino pegado al número o aparte (ej. "1000 t patagonico").
function detectarCapacidad(norm) {
  const t = norm.replace(/\bmil\b/g, '1000');
  const slim = /\bslim\b/.test(t) || /\bxl\b/.test(t) || /\btorre\b/.test(t);
  const patagonico = /patagonic/.test(t) || /\bchato\b/.test(t);

  // Número pegado (con o sin espacio) a la abreviatura de material: de acá sacamos
  // capacidad y material a la vez, por ejemplo "470b", "750BIC", "1000 cuatri".
  const pegado = t.match(/\b(\d{2,4})\s*(bicapa|cuatricapa|tricapa|cuatri|cuad|tric|bic|b|t|c)\b/);
  if (pegado) {
    return {
      valor: remapear500(parseInt(pegado[1], 10), slim),
      slim,
      patagonico,
      materialDetectado: ABREV_A_SUBCATEGORIA[pegado[2]]
    };
  }

  let m = t.match(/(\d{2,4})\s*(?:lts?|litros)\b/);
  if (!m) m = t.match(/\bde\s+(\d{2,4})\b/);
  if (!m) m = t.match(/\b(\d{2,4})\s*(?:slim|xl|torre|patagonic\w*|chato)\b/);
  if (!m) return null;

  return { valor: remapear500(parseInt(m[1], 10), slim), slim, patagonico };
}

// Busca en la línea (o línea de apoyo) un número entero razonable para cantidad,
// descartando el que ya identificamos como capacidad y los precios con decimales.
function detectarCantidad(norm, capInfo) {
  const t = norm.replace(/\bmil\b/g, '1000');
  const numeros = [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map(m => m[0]);
  for (const raw of numeros) {
    if (/[.,]/.test(raw)) continue; // precio con decimales, no es cantidad
    const val = parseInt(raw, 10);
    if (capInfo && val === capInfo.valor) continue;
    if (val <= 0 || val > 999) continue;
    return val;
  }
  return null;
}

function buscarEnCatalogo(CATALOG, categoria, material, capInfo) {
  const candidatos = CATALOG
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.categoria === categoria && (categoria !== 'Tanques' || p.subcategoria === material))
    .map(({ p, idx }) => {
      const capNorm = normalizar(p.capacidad);
      const numMatch = capNorm.match(/\d+/);
      return {
        idx,
        valor: numMatch ? parseInt(numMatch[0], 10) : null,
        slim: /slim/.test(capNorm),
        patagonico: /patagonic/.test(capNorm)
      };
    })
    .filter(c => c.valor === capInfo.valor);

  if (candidatos.length === 0) return null;

  // Coincidencia exacta respetando slim/patagónico si el mensaje los mencionó.
  const exacto = candidatos.find(c => c.slim === !!capInfo.slim && c.patagonico === !!capInfo.patagonico);
  if (exacto) return exacto.idx;

  // Si para ese número solo existe una variante en el catálogo (ej. 500 lts siempre
  // es "slim", no hay otra opción), la usamos aunque el mensaje no haya dicho "slim".
  if (candidatos.length === 1) return candidatos[0].idx;

  return null; // ambiguo: hay más de una variante posible y el mensaje no aclaró cuál
}

// Punto de entrada. Devuelve { resueltas: [{cantidad, idx, materialAsumido, original}], noResueltas: [textoOriginal] }
function interpretarPedido(textoCompleto, CATALOG) {
  const lineas = textoCompleto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const resueltas = [];
  const noResueltas = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i];
    const norm = normalizar(linea);
    const categoria = detectarCategoria(norm);
    let capInfo = detectarCapacidad(norm);

    if (!categoria && !capInfo) { i++; continue; } // ruido: "Por favor", nombre de marca, etc.

    let categoriaFinal = categoria || 'Tanques';
    if (categoriaFinal === 'Base de tanque') {
      if (/plastic/.test(norm)) categoriaFinal = 'Base de tanque plástica';
      else if (/metalic/.test(norm)) categoriaFinal = 'Base de tanque metálica';
    }

    let material = detectarMaterial(norm) || (capInfo && capInfo.materialDetectado);
    let cantidad = detectarCantidad(norm, capInfo);

    // Si falta la capacidad, la cantidad o el material, mirar hasta 3 líneas siguientes
    // (caso PDF: el detalle del producto y la cantidad vienen en renglones separados de
    // la tabla).
    let saltar = 1;
    let j = i + 1;
    while ((!capInfo || cantidad == null || !material) && j < lineas.length && j < i + 4) {
      const normJ = normalizar(lineas[j]);
      if (detectarCategoria(normJ) || detectarCapacidad(normJ)) break; // arrancó el próximo item
      if (!capInfo) capInfo = detectarCapacidad(normJ);
      if (!material) material = detectarMaterial(normJ) || (capInfo && capInfo.materialDetectado);
      if (cantidad == null) cantidad = detectarCantidad(normJ, capInfo);
      j++; saltar++;
    }

    if (!capInfo) { noResueltas.push(linea); i += saltar; continue; }
    if (cantidad == null) cantidad = 1;

    let materialAsumido = false;
    if (categoriaFinal === 'Tanques' && !material) { material = 'tricapa'; materialAsumido = true; }

    const idx = buscarEnCatalogo(CATALOG, categoriaFinal, material, capInfo);
    if (idx === null) { noResueltas.push(linea); i += saltar; continue; }

    resueltas.push({ cantidad, idx, materialAsumido, original: linea });
    i += saltar;
  }

  return { resueltas, noResueltas };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { interpretarPedido, normalizar };
}

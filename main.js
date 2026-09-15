const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFParse } = require('pdf-parse');
const { autoUpdater } = require('electron-updater');
const { createClient } = require('@supabase/supabase-js');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const CLIENTES_PATH_LOCAL = path.join(app.getPath('userData'), 'clientes.json');
const POWERLIT_AUTH_PATH = path.join(app.getPath('userData'), 'powerlit-auth.json');

// --- Vínculo con Powerlit (misma base de Supabase que la web de gestión) ---
// La anon key es pública a propósito (viaja embebida en el bundle de la web también) —
// la seguridad real la da Row Level Security del lado del servidor, no el secreto de esta
// clave. Lo que sí es sensible es el usuario/contraseña de Powerlit que se guarda abajo,
// por eso se cifra con safeStorage (Credential Manager de Windows) antes de ir a disco.
const SUPABASE_URL = 'https://ekqyoweirbwpzvvfbchf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrcXlvd2VpcmJ3cHp2dmZiY2hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NTA4NzksImV4cCI6MjEwMzUyNjg3OX0.NPVy2Y2Lw8_Ck4-OQtvMyk6Ex8hg7-jq4z_QY-7X_kc';
const RECEIPTS_BUCKET = 'receipts';
const PROTOCOLO_BOLETA = 'powerlit-boleta';

// El Node que trae empaquetado Electron todavía no tiene WebSocket nativo, y el cliente de
// Supabase lo exige al construirse aunque acá nunca se use tiempo real (solo consultas y
// updates puntuales) — se le pasa el paquete "ws" para que no rompa toda la app al arrancar.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  realtime: { transport: require('ws') }
});

function guardarCredencialesPowerlit(email, password) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Este Windows no tiene disponible el cifrado de credenciales (Credential Manager).');
  }
  const payload = { email, password: safeStorage.encryptString(password).toString('base64') };
  fs.writeFileSync(POWERLIT_AUTH_PATH, JSON.stringify(payload), 'utf-8');
}

function leerCredencialesPowerlit() {
  try {
    const raw = JSON.parse(fs.readFileSync(POWERLIT_AUTH_PATH, 'utf-8'));
    const password = safeStorage.decryptString(Buffer.from(raw.password, 'base64'));
    return { email: raw.email, password };
  } catch {
    return null;
  }
}

function borrarCredencialesPowerlit() {
  try { fs.unlinkSync(POWERLIT_AUTH_PATH); } catch { /* no había nada guardado */ }
}

// Confirma (o renueva) la sesión de Supabase antes de leer/escribir un pedido. Se vuelve a
// iniciar sesión cada vez que hace falta en vez de guardar el token — es más simple y el
// login de por sí ya es rápido; la contraseña queda cifrada, nunca el token de sesión.
async function asegurarSesionPowerlit() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return true;
    const creds = leerCredencialesPowerlit();
    if (!creds) return false;
    const { error } = await supabase.auth.signInWithPassword(creds);
    return !error;
  } catch {
    return false; // sin internet u otro error de red — se trata igual que "no vinculado"
  }
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

// Si hay Google Drive sincronizado en esta PC, la lista de clientes vive ahí (así se
// comparte sola entre cualquier PC donde se instale la app con la misma cuenta). Si no
// hay Drive, queda solo en esta PC.
function clientesFilePath() {
  const driveFolder = guessDriveFolder();
  return driveFolder
    ? path.join(driveFolder, 'Powerlit App', 'clientes.json')
    : CLIENTES_PATH_LOCAL;
}

function loadClientes() {
  const filePath = clientesFilePath();
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    // Si ahora usamos Drive pero todavía no hay archivo ahí, y esta PC tenía clientes
    // guardados localmente de antes (de cuando no había Drive detectado), los migramos
    // una sola vez para no perderlos.
    if (filePath !== CLIENTES_PATH_LOCAL) {
      try {
        const locales = JSON.parse(fs.readFileSync(CLIENTES_PATH_LOCAL, 'utf-8'));
        if (Array.isArray(locales) && locales.length > 0) {
          saveClientesEn(filePath, locales);
          return locales;
        }
      } catch { /* no había nada local tampoco */ }
    }
    return [];
  }
}

function saveClientesEn(filePath, clientes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(clientes, null, 2), 'utf-8');
}

function saveClientes(clientes) {
  saveClientesEn(clientesFilePath(), clientes);
}

// Intenta adivinar dónde está la carpeta de Google Drive sincronizada en esta PC,
// para sugerirla como destino de guardado por defecto.
function guessDriveFolder() {
  const home = os.homedir();
  const homeCandidates = [
    path.join(home, 'My Drive'),
    path.join(home, 'Mi unidad'),
    path.join(home, 'Google Drive', 'My Drive'),
    path.join(home, 'Google Drive', 'Mi unidad'),
    path.join(home, 'Google Drive'),
    path.join(home, 'GoogleDrive')
  ];
  for (const c of homeCandidates) {
    if (fs.existsSync(c)) return c;
  }

  // Google Drive para escritorio monta como una unidad de letra propia (normalmente G:).
  // Recorremos D..Z (saltando C, el disco del sistema) buscando la carpeta raíz típica.
  for (let code = 68; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    for (const name of ['Mi unidad', 'My Drive']) {
      const candidate = `${letter}:\\${name}`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function defaultSaveFolder() {
  const guessed = guessDriveFolder();
  return guessed
    ? path.join(guessed, 'Powerlit', 'Presupuestos')
    : path.join(app.getPath('documents'), 'Powerlit', 'Presupuestos');
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Organiza el guardado en <carpeta base>/<año>/<mes> según la fecha del presupuesto.
function carpetaConAnioMes(basePath, fechaISO) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(fechaISO || '');
  if (!match) return basePath;
  const [, anio, mes] = match;
  const nombreMes = MESES[parseInt(mes, 10) - 1];
  if (!nombreMes) return basePath;
  return path.join(basePath, anio, nombreMes);
}

let mainWindow;
// saleId recibido por el protocolo powerlit-boleta:// antes de que la ventana termine de
// cargar (pasa al abrir la app desde cero) — se manda al renderer apenas esté lista.
let pedidoPendienteAlAbrir = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    icon: path.join(__dirname, 'src', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    if (pedidoPendienteAlAbrir) {
      mainWindow.webContents.send('cargar-pedido-powerlit', pedidoPendienteAlAbrir);
      pedidoPendienteAlAbrir = null;
    }
  });
}

// Registra la app como manejadora de links powerlit-boleta://, para que el botón "Cargar
// boleta" de la web de Powerlit pueda abrir esta app directo con el pedido ya elegido. En
// modo desarrollo (npm start) hay que apuntar explícitamente al ejecutable de Electron y al
// script actual — si no, Windows intentaría abrir "electron.exe" solo, sin argumentos.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOLO_BOLETA, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOLO_BOLETA);
}

function manejarUrlProtocolo(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return; // link mal formado — se ignora en vez de romper la app
  }
  const saleId = parsed.searchParams.get('saleId');
  if (!saleId) return;
  if (mainWindow && !mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.send('cargar-pedido-powerlit', saleId);
  } else {
    pedidoPendienteAlAbrir = saleId;
  }
}

// Windows abre una segunda instancia al tocar el link; se cierra esa y se reusa la ventana
// que ya estaba abierta, pasándole el pedido por este mismo camino.
const bloqueoInstanciaUnica = app.requestSingleInstanceLock();
if (!bloqueoInstanciaUnica) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const url = argv.find((a) => a.startsWith(`${PROTOCOLO_BOLETA}://`));
    if (url) manejarUrlProtocolo(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// macOS no aplica en esta app (solo se distribuye para Windows), pero no molesta dejarlo.
app.on('open-url', (event, url) => {
  event.preventDefault();
  manejarUrlProtocolo(url);
});

app.whenReady().then(() => {
  createWindow();
  const urlDeArranque = process.argv.find((a) => a.startsWith(`${PROTOCOLO_BOLETA}://`));
  if (urlDeArranque) manejarUrlProtocolo(urlDeArranque);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (app.isPackaged) {
    // Chequeo silencioso al arrancar. En modo desarrollo (npm start) no hay
    // app-update.yml empaquetado, así que ni se intenta.
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => console.error('checkForUpdates:', err.message));
    }, 3000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Auto-actualización (electron-updater, publica en GitHub Releases) ---
autoUpdater.autoDownload = true;
let chequeoManualEnCurso = false;

autoUpdater.on('update-not-available', () => {
  if (chequeoManualEnCurso) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Ya tenés instalada la última versión de Powerlit Presupuestos.'
    });
  }
  chequeoManualEnCurso = false;
});

autoUpdater.on('error', (err) => {
  console.error('Error buscando actualizaciones:', err.message);
  if (chequeoManualEnCurso) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      message: 'No se pudo buscar actualizaciones.',
      detail: err.message
    });
  }
  chequeoManualEnCurso = false;
});

autoUpdater.on('update-downloaded', async (info) => {
  chequeoManualEnCurso = false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['Más tarde', 'Reiniciar ahora'],
    defaultId: 1,
    cancelId: 0,
    title: 'Actualización lista',
    message: `Hay una versión nueva de Powerlit Presupuestos (${info.version}) lista para instalar.`,
    detail: 'Si elegís "Más tarde", se instala sola la próxima vez que cierres la app.'
  });
  if (response === 1) autoUpdater.quitAndInstall();
});

ipcMain.handle('buscar-actualizaciones', () => {
  if (!app.isPackaged) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'La búsqueda de actualizaciones solo funciona en la app instalada, no en modo desarrollo.'
    });
    return;
  }
  chequeoManualEnCurso = true;
  autoUpdater.checkForUpdates().catch(() => { /* el evento 'error' ya lo maneja */ });
});

// --- IPC: ajustes de carpeta de guardado ---
ipcMain.handle('get-settings', () => {
  const settings = loadSettings();
  if (!settings.savePath) {
    settings.savePath = defaultSaveFolder();
  }
  settings.driveDetectado = guessDriveFolder() !== null;
  settings.clientesEnDrive = settings.driveDetectado; // los clientes se guardan en Drive cuando hay Drive detectado
  settings.version = app.getVersion();
  return settings;
});

ipcMain.handle('choose-folder', async () => {
  const current = loadSettings().savePath || defaultSaveFolder();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir carpeta donde guardar los presupuestos (PDF)',
    defaultPath: current,
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const settings = loadSettings();
  settings.savePath = result.filePaths[0];
  saveSettings(settings);
  return settings.savePath;
});

// Sube la boleta y el precio a Powerlit cuando el presupuesto se generó a partir de un pedido
// abierto desde ahí (ver powerlit-fetch-pedido). El PDF ya generado localmente se reusa tal
// cual, no se vuelve a armar — sea cual sea el resultado, el PDF local ya quedó guardado.
async function enviarBoletaAPowerlit(saleId, pdfBuffer, lineas, total) {
  try {
    const sesionOk = await asegurarSesionPowerlit();
    if (!sesionOk) {
      return { ok: false, error: 'El PDF se guardó, pero no hay una sesión de Powerlit vinculada (o no hay internet) — no se pudo enviar el precio. Vinculate desde "⚙ Vincular con Powerlit".' };
    }

    const { error: uploadErr } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .upload(`${saleId}.pdf`, pdfBuffer, { upsert: true, contentType: 'application/pdf' });
    if (uploadErr) return { ok: false, error: 'El PDF se guardó local, pero no se pudo subir la boleta a Powerlit: ' + uploadErr.message };

    for (const linea of lineas) {
      if (!linea.productId) continue;
      const { error } = await supabase
        .from('sale_items')
        .update({ unit_price: linea.precioUnitario })
        .eq('sale_id', saleId)
        .eq('product_id', linea.productId);
      if (error) return { ok: false, error: 'Se subió la boleta pero no se pudo guardar el precio en Powerlit: ' + error.message };
    }

    const { error: saleErr } = await supabase
      .from('sales')
      .update({ total, priced_at: new Date().toISOString(), receipt_path: `${saleId}.pdf` })
      .eq('id', saleId);
    if (saleErr) return { ok: false, error: 'Se subió la boleta pero no se pudo guardar el total en Powerlit: ' + saleErr.message };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'El PDF se guardó local, pero no se pudo conectar con Powerlit: ' + err.message };
  }
}

// --- IPC: generar PDF a partir de HTML y guardarlo ---
ipcMain.handle('generar-pdf', async (event, { html, filename, fecha, powerlit }) => {
  const settings = loadSettings();
  const baseSavePath = settings.savePath || defaultSaveFolder();
  const savePath = carpetaConAnioMes(baseSavePath, fecha);

  try {
    fs.mkdirSync(savePath, { recursive: true });
  } catch (err) {
    return { ok: false, error: 'No se pudo crear/acceder a la carpeta de guardado: ' + err.message };
  }

  const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await printWin.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    });

    let fullPath = path.join(savePath, filename);
    let counter = 1;
    const base = filename.replace(/\.pdf$/i, '');
    while (fs.existsSync(fullPath)) {
      fullPath = path.join(savePath, `${base} (${counter}).pdf`);
      counter++;
    }
    fs.writeFileSync(fullPath, pdfBuffer);

    let resultadoPowerlit = null;
    if (powerlit && powerlit.saleId) {
      resultadoPowerlit = await enviarBoletaAPowerlit(powerlit.saleId, pdfBuffer, powerlit.lineas, powerlit.total);
    }

    return { ok: true, fullPath, savePath, powerlit: resultadoPowerlit };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    printWin.destroy();
  }
});

// --- IPC: vínculo con Powerlit y lectura de un pedido cargado ahí ---
ipcMain.handle('powerlit-login-estado', async () => {
  const creds = leerCredencialesPowerlit();
  if (!creds) return { vinculado: false };
  const ok = await asegurarSesionPowerlit();
  return { vinculado: ok, email: creds.email };
});

ipcMain.handle('powerlit-login', async (event, { email, password }) => {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: 'No se pudo iniciar sesión: ' + error.message };
    guardarCredencialesPowerlit(email, password);
    return { ok: true, email };
  } catch (err) {
    return { ok: false, error: 'No se pudo conectar con Powerlit: ' + err.message };
  }
});

ipcMain.handle('powerlit-logout', async () => {
  borrarCredencialesPowerlit();
  await supabase.auth.signOut();
  return { ok: true };
});

ipcMain.handle('powerlit-fetch-pedido', async (event, saleId) => {
  try {
    const sesionOk = await asegurarSesionPowerlit();
    if (!sesionOk) return { ok: false, error: 'No hay una sesión de Powerlit vinculada (o no hay internet). Configurala en "⚙ Vincular con Powerlit".' };

    const { data: sale, error: saleErr } = await supabase
      .from('sales').select('id,date,customer_id,priced_at').eq('id', saleId).single();
    if (saleErr || !sale) return { ok: false, error: 'No se encontró ese pedido en Powerlit.' };

    const { data: customer } = await supabase.from('customers').select('name').eq('id', sale.customer_id).single();

    const { data: items, error: itemsErr } = await supabase
      .from('sale_items').select('product_id,quantity').eq('sale_id', saleId);
    if (itemsErr) return { ok: false, error: itemsErr.message };
    if (!items || items.length === 0) return { ok: false, error: 'Ese pedido todavía no tiene productos cargados en Powerlit.' };

    const productIds = [...new Set(items.map((i) => i.product_id))];
    const { data: products } = await supabase.from('products').select('id,name').in('id', productIds);
    const nombrePorId = new Map((products || []).map((p) => [p.id, p.name]));

    let catalog;
    try {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'catalog.json'), 'utf-8'));
    } catch {
      catalog = [];
    }

    const lineas = items.map((item) => {
      const idx = catalog.findIndex((c) => c.powerlitId === item.product_id);
      return {
        idx: idx >= 0 ? idx : null,
        productId: item.product_id,
        cantidad: Number(item.quantity),
        nombrePowerlit: nombrePorId.get(item.product_id) || 'Producto'
      };
    });

    return {
      ok: true,
      saleId,
      cliente: customer && customer.name ? customer.name : '',
      fecha: sale.date,
      yaTenePrecio: !!sale.priced_at,
      lineas
    };
  } catch (err) {
    return { ok: false, error: 'No se pudo conectar con Powerlit: ' + err.message };
  }
});

ipcMain.handle('abrir-carpeta', (event, folderPath) => {
  shell.openPath(folderPath);
});

// Diálogo de confirmación nativo de Electron (no el window.confirm() del navegador, que en
// Windows deja la ventana "congelada" — sin responder a clicks/teclado — hasta que se hace
// clic afuera y de nuevo adentro, por un problema conocido de foco entre Chromium y Electron).
ipcMain.handle('confirmar', async (event, mensaje) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancelar', 'Confirmar'],
    defaultId: 1,
    cancelId: 0,
    message: mensaje
  });
  return response === 1;
});

ipcMain.handle('leer-portapapeles', () => clipboard.readText());

// --- IPC: lista de clientes (nombre, dirección, descuentos habituales) ---
ipcMain.handle('listar-clientes', () => loadClientes());

ipcMain.handle('guardar-cliente', (event, cliente) => {
  const clientes = loadClientes();
  const nombreNorm = (cliente.nombre || '').trim().toLowerCase();
  if (!nombreNorm) return loadClientes();

  const idx = cliente.id
    ? clientes.findIndex(c => c.id === cliente.id)
    : clientes.findIndex(c => c.nombre.trim().toLowerCase() === nombreNorm);

  const registro = {
    id: cliente.id || (idx >= 0 ? clientes[idx].id : String(Date.now())),
    nombre: cliente.nombre.trim(),
    direccion: (cliente.direccion || '').trim(),
    descuento1: cliente.descuento1 || '0',
    descuento2: cliente.descuento2 || '0',
    descuento3: cliente.descuento3 || '0'
  };

  if (idx >= 0) clientes[idx] = registro;
  else clientes.push(registro);

  saveClientes(clientes);
  return clientes;
});

ipcMain.handle('eliminar-cliente', (event, id) => {
  const clientes = loadClientes().filter(c => c.id !== id);
  saveClientes(clientes);
  return clientes;
});

// --- IPC: elegir un PDF de pedido y extraer su texto (todo local, sin internet) ---
ipcMain.handle('elegir-pdf-pedido', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir PDF del pedido del cliente',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const parser = new PDFParse({ data: fs.readFileSync(result.filePaths[0]) });
  try {
    const { text } = await parser.getText();
    return { ok: true, texto: text, nombreArchivo: path.basename(result.filePaths[0]) };
  } catch (err) {
    return { ok: false, error: 'No se pudo leer el PDF: ' + err.message };
  } finally {
    await parser.destroy();
  }
});

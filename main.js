const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFParse } = require('pdf-parse');
const { autoUpdater } = require('electron-updater');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const CLIENTES_PATH_LOCAL = path.join(app.getPath('userData'), 'clientes.json');

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
}

app.whenReady().then(() => {
  createWindow();
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

// --- IPC: generar PDF a partir de HTML y guardarlo ---
ipcMain.handle('generar-pdf', async (event, { html, filename, fecha }) => {
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
    return { ok: true, fullPath, savePath };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    printWin.destroy();
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

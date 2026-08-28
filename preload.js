const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('powerlit', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  generarPDF: (data) => ipcRenderer.invoke('generar-pdf', data),
  abrirCarpeta: (folderPath) => ipcRenderer.invoke('abrir-carpeta', folderPath),
  elegirPdfPedido: () => ipcRenderer.invoke('elegir-pdf-pedido'),
  leerPortapapeles: () => ipcRenderer.invoke('leer-portapapeles'),
  listarClientes: () => ipcRenderer.invoke('listar-clientes'),
  guardarCliente: (cliente) => ipcRenderer.invoke('guardar-cliente', cliente),
  eliminarCliente: (id) => ipcRenderer.invoke('eliminar-cliente', id),
  confirmar: (mensaje) => ipcRenderer.invoke('confirmar', mensaje)
});

const { app, BrowserWindow, ipcMain, dialog, globalShortcut, protocol } = require('electron');
const path = require('path');
const library = require('./library');
const { createMediaHandler } = require('./media');

let mainWindow;

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0e0f13',
    title: 'Tempo Player',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/* ------------------------------ Hand-picked files ------------------------------ */

ipcMain.handle('open-files', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: [...library.AUDIO_EXTS].map((e) => e.slice(1)) }]
  });
  if (res.canceled) return [];
  return library.loadPaths(res.filePaths);
});

ipcMain.handle('open-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled) return [];
  return library.loadPaths(res.filePaths);
});

ipcMain.handle('load-paths', (_e, paths) => library.loadPaths(paths));

/* ------------------------------ Library ------------------------------ */

ipcMain.handle('library:get', () => ({
  folders: library.getFolders(),
  tracks: library.getCachedTracks()
}));

ipcMain.handle('library:scan', (e) =>
  library.scan((done, total) => {
    if (!e.sender.isDestroyed()) e.sender.send('library:progress', { done, total });
  })
);

ipcMain.handle('library:add-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled) return library.getFolders();
  return library.addFolder(res.filePaths[0]);
});

ipcMain.handle('library:remove-folder', (_e, folder) => library.removeFolder(folder));

/* ------------------------------ App lifecycle ------------------------------ */

app.whenReady().then(() => {
  // Serve local audio files and cached cover art through a custom scheme
  // so the renderer can stream and seek them.
  protocol.handle('media', createMediaHandler(library.isServable));

  createWindow();

  const send = (action) => mainWindow && mainWindow.webContents.send('media-key', action);
  globalShortcut.register('MediaPlayPause', () => send('toggle'));
  globalShortcut.register('MediaNextTrack', () => send('next'));
  globalShortcut.register('MediaPreviousTrack', () => send('prev'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

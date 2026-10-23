const { app, BrowserWindow, ipcMain, dialog, globalShortcut, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.wma']);

let mainWindow;
let mm; // music-metadata (ESM, loaded lazily)

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

async function readMeta(filePath) {
  if (!mm) mm = await import('music-metadata');
  const base = {
    path: filePath,
    url: 'media://local/' + encodeURIComponent(filePath),
    title: path.basename(filePath, path.extname(filePath)),
    artist: 'Unknown artist',
    album: '',
    duration: 0,
    cover: null
  };
  try {
    const meta = await mm.parseFile(filePath, { duration: true });
    const c = meta.common;
    if (c.title) base.title = c.title;
    if (c.artist) base.artist = c.artist;
    if (c.album) base.album = c.album;
    base.duration = meta.format.duration || 0;
    const pic = mm.selectCover ? mm.selectCover(c.picture) : (c.picture && c.picture[0]);
    if (pic) {
      base.cover = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
    }
  } catch (err) {
    // keep the filename-based fallback
  }
  return base;
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function loadPaths(paths) {
  const files = [];
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) files.push(...walk(p));
      else if (AUDIO_EXTS.has(path.extname(p).toLowerCase())) files.push(p);
    } catch { /* ignore */ }
  }
  const tracks = [];
  for (const f of files) tracks.push(await readMeta(f));
  return tracks;
}

ipcMain.handle('open-files', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: [...AUDIO_EXTS].map((e) => e.slice(1)) }]
  });
  if (res.canceled) return [];
  return loadPaths(res.filePaths);
});

ipcMain.handle('open-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled) return [];
  return loadPaths(res.filePaths);
});

ipcMain.handle('load-paths', (_e, paths) => loadPaths(paths));

app.whenReady().then(() => {
  // Serve local audio files through a custom scheme so the renderer can stream and seek them.
  protocol.handle('media', (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
    return net.fetch(pathToFileURL(filePath).toString(), {
      headers: request.headers,
      method: request.method
    });
  });

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

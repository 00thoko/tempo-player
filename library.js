// Music library: remembers which folders to scan, scans them for audio files,
// reads tags, and caches the result so later start-ups are fast.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.wma']);
const COVER_EXTS = new Set(['.jpg', '.png', '.gif', '.webp']);

const CACHE_VERSION = 2;

let mm; // music-metadata (ESM, loaded lazily)
let scanning = false;

/* ------------------------------ Paths & storage ------------------------------ */

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const cacheFile = () => path.join(app.getPath('userData'), 'library-cache.json');
const coversDir = () => path.join(app.getPath('userData'), 'covers');

const mediaUrl = (p) => 'media://local/' + encodeURIComponent(p);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file); // atomic, so a crash never leaves a half-written file
}

/** Only audio files and our own cover images may be streamed through media://. */
function isServable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTS.has(ext)) return true;
  const dir = coversDir() + path.sep;
  return COVER_EXTS.has(ext) && path.resolve(filePath).startsWith(dir);
}

/* ------------------------------ Library folders ------------------------------ */

function getFolders() {
  const saved = readJson(settingsFile(), null);
  if (saved && Array.isArray(saved.folders)) return saved.folders;
  // First run: start with the system Music folder.
  const defaults = [app.getPath('music')];
  writeJson(settingsFile(), { folders: defaults });
  return defaults;
}

function setFolders(folders) {
  writeJson(settingsFile(), { folders });
  return folders;
}

function addFolder(folder) {
  const folders = getFolders();
  if (!folders.includes(folder)) folders.push(folder);
  return setFolders(folders);
}

function removeFolder(folder) {
  return setFolders(getFolders().filter((f) => f !== folder));
}

/* ------------------------------ Reading tags ------------------------------ */

function saveCover(pic) {
  const ext = /png/i.test(pic.format) ? '.png' : /gif/i.test(pic.format) ? '.gif' : /webp/i.test(pic.format) ? '.webp' : '.jpg';
  // Named by content hash, so every track on an album shares one image file.
  const hash = crypto.createHash('sha1').update(pic.data).digest('hex');
  const file = path.join(coversDir(), hash + ext);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(coversDir(), { recursive: true });
    fs.writeFileSync(file, pic.data);
  }
  return mediaUrl(file);
}

async function readMeta(filePath, st) {
  if (!st) st = fs.statSync(filePath);
  const track = {
    path: filePath,
    url: mediaUrl(filePath),
    title: path.basename(filePath, path.extname(filePath)),
    artist: 'Unknown artist',
    album: '',
    albumArtist: '',
    track: 0,
    disc: 0,
    duration: 0,
    cover: null,
    mtimeMs: st.mtimeMs,
    size: st.size
  };
  try {
    if (!mm) mm = await import('music-metadata');
    const meta = await mm.parseFile(filePath, { duration: true });
    const c = meta.common;
    if (c.title) track.title = c.title;
    if (c.artist) track.artist = c.artist;
    if (c.album) track.album = c.album;
    if (c.albumartist) track.albumArtist = c.albumartist;
    track.track = (c.track && c.track.no) || 0;
    track.disc = (c.disk && c.disk.no) || 0;
    track.duration = meta.format.duration || 0;
    const pic = mm.selectCover ? mm.selectCover(c.picture) : c.picture && c.picture[0];
    if (pic) track.cover = saveCover(pic);
  } catch {
    // unreadable tags: keep the filename-based fallback
  }
  return track;
}

/* ------------------------------ Scanning ------------------------------ */

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // hidden folders and files
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

const byLibraryOrder = (a, b) =>
  a.artist.localeCompare(b.artist) ||
  a.album.localeCompare(b.album) ||
  a.disc - b.disc ||
  a.track - b.track ||
  a.title.localeCompare(b.title);

function getCachedTracks() {
  const cached = readJson(cacheFile(), {});
  // Older caches lack newer fields (like the album artist), so rescan from scratch.
  return cached.version === CACHE_VERSION && Array.isArray(cached.tracks) ? cached.tracks : [];
}

/**
 * Scan every library folder. Files that haven't changed since the last scan
 * are taken from the cache, so only new or edited files are read again.
 * Returns null if a scan is already running.
 */
async function scan(onProgress = () => {}) {
  if (scanning) return null;
  scanning = true;
  try {
    const cache = new Map(getCachedTracks().map((t) => [t.path, t]));
    const files = new Set();
    for (const folder of getFolders()) walk(folder).forEach((f) => files.add(f));

    const total = files.size;
    const tracks = [];
    let done = 0;
    onProgress(0, total);

    for (const file of files) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      const hit = cache.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) tracks.push(hit);
      else tracks.push(await readMeta(file, st));

      done++;
      if (done % 20 === 0 || done === total) onProgress(done, total);
      if (done % 200 === 0) await new Promise((r) => setImmediate(r)); // keep the app responsive
    }

    tracks.sort(byLibraryOrder);
    writeJson(cacheFile(), { version: CACHE_VERSION, tracks });
    return tracks;
  } finally {
    scanning = false;
  }
}

/** Read tags for files or folders chosen by hand (not added to the library). */
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

module.exports = {
  AUDIO_EXTS,
  isServable,
  getFolders,
  addFolder,
  removeFolder,
  getCachedTracks,
  scan,
  loadPaths
};

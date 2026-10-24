// Saves playlists to a JSON file. The renderer owns the playlist data and sends
// the whole list on every change; this file only validates it and writes it safely.
const fs = require('fs');
const path = require('path');

const MAX_PLAYLISTS = 500;
const MAX_TRACKS = 20000;

const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);

/** Keep only well-formed playlists, so a bad file or bad message can't break the app. */
function clean(data) {
  if (!Array.isArray(data)) return [];
  const out = [];
  const ids = new Set();
  for (const p of data.slice(0, MAX_PLAYLISTS)) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue;
    const id = p.id.slice(0, 64);
    if (!id || ids.has(id)) continue;
    ids.add(id);

    const seen = new Set();
    const tracks = [];
    for (const t of Array.isArray(p.tracks) ? p.tracks : []) {
      if (!t || typeof t.path !== 'string' || !t.path || seen.has(t.path)) continue;
      seen.add(t.path);
      tracks.push({
        path: t.path,
        title: str(t.title),
        artist: str(t.artist),
        album: str(t.album),
        track: num(t.track),
        disc: num(t.disc),
        duration: num(t.duration)
      });
      if (tracks.length >= MAX_TRACKS) break;
    }
    out.push({ id, name: p.name.trim().slice(0, 100) || 'Untitled', created: num(p.created), tracks });
  }
  return out;
}

function createStore(file) {
  return {
    load() {
      try { return clean(JSON.parse(fs.readFileSync(file, 'utf8')).playlists); } catch { return []; }
    },
    save(data) {
      const playlists = clean(data);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, playlists }));
      fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written file
      return playlists;
    }
  };
}

module.exports = { createStore, clean };

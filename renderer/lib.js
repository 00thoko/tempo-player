// Pure helpers for grouping, sorting and playlists. No DOM and no Electron here,
// so this file can be tested with plain Node (see test/lib.test.js).
(function (root) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const cmp = (a, b) => collator.compare(a || '', b || '');

  const UNKNOWN_ARTIST = 'Unknown artist';
  const UNKNOWN_ALBUM = 'Unknown album';

  /* ------------------------------ Sorting ------------------------------ */

  // Order inside an album: disc, track number, then title.
  const trackOrder = (a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0) || cmp(a.title, b.title);

  const comparators = {
    artist: (a, b) => cmp(a.artist, b.artist) || cmp(a.album, b.album) || trackOrder(a, b),
    album: (a, b) => cmp(a.album, b.album) || cmp(a.artist, b.artist) || trackOrder(a, b),
    title: (a, b) => cmp(a.title, b.title) || cmp(a.artist, b.artist),
    duration: (a, b) => (a.duration || 0) - (b.duration || 0) || cmp(a.title, b.title),
    added: (a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0) || cmp(a.title, b.title)
  };

  /** Returns a sorted copy. `by` is artist | album | title | duration | added. */
  function sortTracks(tracks, by, desc = false) {
    const c = comparators[by] || comparators.artist;
    const out = tracks.slice().sort(c); // Array.sort is stable
    return desc ? out.reverse() : out;
  }

  /* ------------------------------ Grouping ------------------------------ */

  /** Albums: one group per (album artist, album). Compilations stay together when the album-artist tag is set. */
  function groupAlbums(tracks) {
    const map = new Map();
    for (const t of tracks) {
      const artist = t.albumArtist || t.artist || UNKNOWN_ARTIST;
      const album = t.album || '';
      const key = (artist + '\u0000' + album).toLowerCase();
      let g = map.get(key);
      if (!g) {
        g = { key, title: album || UNKNOWN_ALBUM, artist, cover: null, tracks: [], duration: 0 };
        map.set(key, g);
      }
      g.tracks.push(t);
      g.duration += t.duration || 0;
      if (!g.cover && t.cover) g.cover = t.cover;
    }
    const out = [...map.values()];
    for (const g of out) g.tracks.sort(trackOrder);
    return out.sort((a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title));
  }

  /** Artists: one group per track artist, each with its albums (by album name) inside. */
  function groupArtists(tracks) {
    const map = new Map();
    for (const t of tracks) {
      const name = t.artist || UNKNOWN_ARTIST;
      const key = name.toLowerCase();
      let g = map.get(key);
      if (!g) {
        g = { key, name, cover: null, tracks: [], duration: 0 };
        map.set(key, g);
      }
      g.tracks.push(t);
      g.duration += t.duration || 0;
      if (!g.cover && t.cover) g.cover = t.cover;
    }
    const out = [...map.values()];
    for (const g of out) {
      const albums = new Map();
      for (const t of g.tracks) {
        const k = (t.album || '').toLowerCase();
        if (!albums.has(k)) albums.set(k, { title: t.album || UNKNOWN_ALBUM, tracks: [] });
        albums.get(k).tracks.push(t);
      }
      g.albums = [...albums.values()].sort((a, b) => {
        if (a.title === UNKNOWN_ALBUM) return 1; // unknown album last
        if (b.title === UNKNOWN_ALBUM) return -1;
        return cmp(a.title, b.title);
      });
      for (const al of g.albums) al.tracks.sort(trackOrder);
      g.tracks = g.albums.flatMap((al) => al.tracks); // artist playback order = album by album
    }
    return out.sort((a, b) => cmp(a.name, b.name));
  }

  /* ------------------------------ Playlists ------------------------------ */

  const makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function newPlaylist(name) {
    return { id: makeId(), name: String(name).trim() || 'Untitled', created: Date.now(), tracks: [] };
  }

  /** The small record we save for each song in a playlist. */
  const snapshot = (t) => ({
    path: t.path,
    title: t.title || '',
    artist: t.artist || '',
    album: t.album || '',
    track: t.track || 0,
    disc: t.disc || 0,
    duration: t.duration || 0
  });

  /** Adds songs, skipping ones already in the playlist. Returns how many were added. */
  function addTracks(playlist, tracks) {
    const have = new Set(playlist.tracks.map((t) => t.path));
    let added = 0;
    for (const t of tracks) {
      if (have.has(t.path)) continue;
      have.add(t.path);
      playlist.tracks.push(snapshot(t));
      added++;
    }
    return added;
  }

  function removePath(playlist, path) {
    const before = playlist.tracks.length;
    playlist.tracks = playlist.tracks.filter((t) => t.path !== path);
    return before - playlist.tracks.length;
  }

  /** Move the item at `from` so it ends up at index `to` (index in the final array). */
  function moveItem(arr, from, to) {
    if (from === to || from < 0 || from >= arr.length) return arr;
    to = Math.max(0, Math.min(arr.length - 1, to));
    const [item] = arr.splice(from, 1);
    arr.splice(to, 0, item);
    return arr;
  }

  /** Reorders the playlist for good. `by` is artist | album | title | duration | reverse. */
  function sortPlaylist(playlist, by) {
    if (by === 'reverse') playlist.tracks.reverse();
    else playlist.tracks = sortTracks(playlist.tracks, by);
    return playlist;
  }

  /** Turn a saved playlist entry into a playable track, preferring the live library entry. */
  function resolveItem(item, byPath) {
    const live = byPath.get(item.path);
    if (live) return live;
    return {
      path: item.path,
      url: 'media://local/' + encodeURIComponent(item.path),
      title: item.title || item.path.split(/[\\/]/).pop(),
      artist: item.artist || UNKNOWN_ARTIST,
      album: item.album || '',
      track: item.track || 0,
      disc: item.disc || 0,
      duration: item.duration || 0,
      cover: null,
      mtimeMs: 0,
      offLibrary: true
    };
  }

  /* ------------------------------ Labels ------------------------------ */

  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

  function durationLabel(sec) {
    const mins = Math.round((sec || 0) / 60);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
  }

  const api = {
    UNKNOWN_ARTIST, UNKNOWN_ALBUM,
    sortTracks, groupAlbums, groupArtists,
    newPlaylist, snapshot, addTracks, removePath, moveItem, sortPlaylist, resolveItem,
    plural, durationLabel
  };
  root.TempoLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

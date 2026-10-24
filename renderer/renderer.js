const $ = (id) => document.getElementById(id);
const L = window.TempoLib;
const audio = $('audio');

const state = {
  view: 'songs',     // songs | albums | artists | playlists | queue
  detail: null,      // { type: 'album' | 'artist' | 'playlist', id }
  library: [],       // every track found by the scanner
  byPath: new Map(), // library lookup by file path
  folders: [],       // folders the scanner looks in
  scanning: false,
  playlists: [],
  sortBy: 'artist',  // sort order of the Songs tab
  queue: [],
  index: -1,
  shuffle: false,
  repeat: 'off',     // off | all | one
  history: [],       // played indices, used for "previous" while shuffling
  filter: ''
};

// The playable songs the main area is showing right now, in order.
let ctx = { tracks: [] };
let groups = null; // albums and artists, rebuilt whenever the library changes

const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
};

const setFill = (el) => {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--fill', pct + '%');
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const setArt = (node, cover) => { node.style.backgroundImage = cover ? `url("${cover}")` : ''; };

/* ------------------------------ Data helpers ------------------------------ */

function setLibrary(tracks) {
  state.library = tracks;
  state.byPath = new Map(tracks.map((t) => [t.path, t]));
  groups = null;
}

const getGroups = () => groups || (groups = { albums: L.groupAlbums(state.library), artists: L.groupArtists(state.library) });
const findPlaylist = (id) => state.playlists.find((p) => p.id === id);
const playlistTracks = (pl) => pl.tracks.map((it) => L.resolveItem(it, state.byPath));
const searchText = (t) => t._s || (t._s = `${t.title} ${t.artist} ${t.album}`.toLowerCase());
const matches = (t, q) => !q || searchText(t).includes(q);

function playlistCover(pl) {
  for (const it of pl.tracks) {
    const t = state.byPath.get(it.path);
    if (t && t.cover) return t.cover;
  }
  return null;
}

/** Find the album, artist or playlist the detail screen points at. */
function resolveDetail() {
  const d = state.detail;
  if (!d) return null;
  if (d.type === 'album') {
    const data = getGroups().albums.find((a) => a.key === d.id);
    return data && { type: 'album', data, tracks: data.tracks };
  }
  if (d.type === 'artist') {
    const data = getGroups().artists.find((a) => a.key === d.id);
    return data && { type: 'artist', data, tracks: data.tracks };
  }
  const data = findPlaylist(d.id);
  return data && { type: 'playlist', data, tracks: playlistTracks(data) };
}

function savePlaylists() {
  window.tempo.playlistsSet(state.playlists).catch(() => {});
}

function createPlaylist(name) {
  const pl = L.newPlaylist(name);
  state.playlists.push(pl);
  savePlaylists();
  return pl;
}

function addToPlaylist(id, tracks) {
  const pl = findPlaylist(id);
  if (!pl) return;
  const n = L.addTracks(pl, tracks);
  savePlaylists();
  toast(n ? `Added ${L.plural(n, 'song')} to “${pl.name}”` : `Already in “${pl.name}”`);
  render();
}

/* ------------------------------ Rendering ------------------------------ */

function buildRow(t, n, o) {
  const li = el('li', 'row' + (o.active ? ' active' : ''));
  li.dataset.path = t.path;
  li.dataset.n = n;
  li.dataset.i = o.i;
  if (o.draggable) li.draggable = true;

  const idx = el('div', 'r-idx', o.active && o.playing ? '▶' : n);

  const art = el('div', 'r-art');
  setArt(art, t.cover);

  const text = el('div', 'r-text');
  text.append(el('div', 'r-title', t.title), el('div', 'r-sub', [t.artist, t.album].filter(Boolean).join(' · ')));

  const right = el('div', 'r-right');
  const add = el('button', 'r-btn', '+');
  add.dataset.action = 'add';
  add.title = 'Add to playlist';
  right.append(add);
  if (o.removable) {
    const rm = el('button', 'r-btn danger', '✕');
    rm.dataset.action = 'remove';
    rm.title = o.removeTitle;
    right.append(rm);
  }
  right.append(el('span', 'r-dur', t.duration ? fmt(t.duration) : ''));

  li.append(idx, art, text, right);
  return li;
}

/** A row that opens a group (an artist or a playlist) instead of playing one song. */
function buildGroupRow(o) {
  const li = el('li', 'row');
  li.dataset.nav = o.nav;
  li.dataset.id = o.id;

  const art = el('div', 'r-art');
  setArt(art, o.cover);
  const text = el('div', 'r-text');
  text.append(el('div', 'r-title', o.title), el('div', 'r-sub', o.sub));

  const right = el('div', 'r-right');
  for (const [action, title, label, danger] of o.actions) {
    const b = el('button', 'r-btn' + (danger ? ' danger' : ''), label);
    b.dataset.action = action;
    b.title = title;
    right.append(b);
  }
  right.append(el('span', 'r-chev', '›'));

  li.append(el('div', 'r-idx', ''), art, text, right);
  return li;
}

function buildCard(a) {
  const card = el('div', 'card');
  card.dataset.id = a.key;
  const art = el('div', 'card-art' + (a.cover ? ' has-art' : ''));
  setArt(art, a.cover);
  art.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>');
  const play = el('button', 'card-play', '▶');
  play.dataset.action = 'play';
  play.title = 'Play album';
  art.append(play);
  card.append(art, el('div', 'card-title', a.title), el('div', 'card-sub', `${a.artist} · ${L.plural(a.tracks.length, 'song')}`));
  return card;
}

function songRows(tracks, o = {}) {
  const active = state.queue[state.index];
  const activePath = active && active.path;
  const playing = !audio.paused;
  const frag = document.createDocumentFragment();
  tracks.forEach((t, i) => frag.append(buildRow(t, i + 1, { active: t.path === activePath, playing, i, ...o })));
  return frag;
}

let lastScreen = '';

function render() {
  const q = state.filter.trim().toLowerCase();
  const g = getGroups();
  const detail = resolveDetail();
  if (state.detail && !detail) state.detail = null; // e.g. an album that no longer exists after a rescan

  updateChrome(detail);

  const list = $('list');
  const grid = $('grid');
  const screen = [state.view, state.detail && state.detail.id, state.filter, state.sortBy].join('|');
  const keepScroll = screen === lastScreen;
  const listTop = list.scrollTop;
  const gridTop = grid.scrollTop;
  lastScreen = screen;

  list.textContent = '';
  grid.textContent = '';
  let shown = 0;
  let useGrid = false;
  ctx = { tracks: [] };

  if (detail && detail.type === 'album') {
    ctx.tracks = detail.tracks.filter((t) => matches(t, q));
    list.append(songRows(ctx.tracks));
    shown = ctx.tracks.length;
  } else if (detail && detail.type === 'artist') {
    const frag = document.createDocumentFragment();
    const active = state.queue[state.index];
    const activePath = active && active.path;
    for (const al of detail.data.albums) {
      const ts = al.tracks.filter((t) => matches(t, q));
      if (!ts.length) continue;
      const head = el('li', 'group-head');
      head.append(el('span', null, al.title), el('span', null, L.plural(ts.length, 'song')));
      frag.append(head);
      const start = ctx.tracks.length;
      ctx.tracks.push(...ts);
      ts.forEach((t, i) => frag.append(buildRow(t, i + 1, { active: t.path === activePath, playing: !audio.paused, i: start + i })));
    }
    list.append(frag);
    shown = ctx.tracks.length;
  } else if (detail && detail.type === 'playlist') {
    ctx.tracks = detail.tracks.filter((t) => matches(t, q));
    list.append(songRows(ctx.tracks, { removable: true, removeTitle: 'Remove from playlist', draggable: !q }));
    shown = ctx.tracks.length;
  } else if (state.view === 'songs') {
    const sorted = L.sortTracks(state.library, state.sortBy, state.sortBy === 'added');
    ctx.tracks = q ? sorted.filter((t) => matches(t, q)) : sorted;
    list.append(songRows(ctx.tracks));
    shown = ctx.tracks.length;
  } else if (state.view === 'queue') {
    ctx.tracks = state.queue.filter((t) => matches(t, q));
    list.append(songRows(ctx.tracks, { removable: true, removeTitle: 'Remove from queue' }));
    shown = ctx.tracks.length;
  } else if (state.view === 'albums') {
    const albums = g.albums.filter((a) => !q || `${a.title} ${a.artist}`.toLowerCase().includes(q));
    for (const a of albums) grid.append(buildCard(a));
    useGrid = true;
    shown = albums.length;
  } else if (state.view === 'artists') {
    const artists = g.artists.filter((a) => !q || a.name.toLowerCase().includes(q));
    const frag = document.createDocumentFragment();
    for (const a of artists) {
      frag.append(buildGroupRow({
        nav: 'artist', id: a.key, cover: a.cover, title: a.name,
        sub: `${L.plural(a.albums.length, 'album')} · ${L.plural(a.tracks.length, 'song')}`,
        actions: [['play', 'Play artist', '▶']]
      }));
    }
    list.append(frag);
    shown = artists.length;
  } else if (state.view === 'playlists') {
    const pls = state.playlists.filter((p) => !q || p.name.toLowerCase().includes(q));
    const frag = document.createDocumentFragment();
    for (const p of pls) {
      const total = p.tracks.reduce((s, t) => s + (t.duration || 0), 0);
      frag.append(buildGroupRow({
        nav: 'playlist', id: p.id, cover: playlistCover(p), title: p.name,
        sub: `${L.plural(p.tracks.length, 'song')}${p.tracks.length ? ' · ' + L.durationLabel(total) : ''}`,
        actions: [['play', 'Play playlist', '▶'], ['rename', 'Rename', '✎'], ['delete', 'Delete playlist', '✕', true]]
      }));
    }
    list.append(frag);
    shown = pls.length;
  }

  list.hidden = useGrid;
  grid.hidden = !useGrid;
  if (keepScroll) { list.scrollTop = listTop; grid.scrollTop = gridTop; }

  updateCounts();
  renderEmpty(shown, q, detail);
}

function renderEmpty(shown, q, detail) {
  const e = $('empty');
  e.hidden = shown > 0;
  if (shown > 0) return;
  const v = state.view;
  if (q) e.textContent = 'Nothing matches your search.';
  else if (detail && detail.type === 'playlist') e.innerHTML = 'This playlist is empty.<br />Use the <b>+</b> button on any song to add it here.';
  else if (detail) e.textContent = 'No songs here.';
  else if (v === 'playlists') e.innerHTML = 'No playlists yet.<br />Create one with <b>New playlist</b>, or use the <b>+</b> button on any song.';
  else if (v === 'queue') e.innerHTML = 'Your queue is empty.<br />Pick songs from your library.';
  else if (state.scanning) e.textContent = 'Scanning your music…';
  else e.innerHTML = 'No music found yet.<br />Use <b>Folders</b> on the Songs tab to choose where your music lives.';
}

const PLACEHOLDERS = { songs: 'Search songs', albums: 'Search albums', artists: 'Search artists', playlists: 'Search playlists', queue: 'Search queue' };

function updateChrome(detail) {
  const v = state.view;
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.view === v;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  const top = !detail;
  $('sortBy').hidden = !(v === 'songs' && top);
  $('playAll').hidden = !(v === 'songs' && top);
  $('folders').hidden = !(v === 'songs' && top);
  $('newPlaylist').hidden = !(v === 'playlists' && top);
  $('saveQueue').hidden = !(v === 'queue' && top);
  $('clear').hidden = !(v === 'queue' && top);
  $('filter').placeholder = detail ? 'Search songs' : PLACEHOLDERS[v];
  $('sortBy').value = state.sortBy;

  $('detailHead').hidden = !detail;
  if (!detail) return;

  const { type, data, tracks } = detail;
  let title; let sub; let cover;
  if (type === 'album') {
    title = data.title;
    sub = `${data.artist} · ${L.plural(tracks.length, 'song')} · ${L.durationLabel(data.duration)}`;
    cover = data.cover;
  } else if (type === 'artist') {
    title = data.name;
    sub = `${L.plural(data.albums.length, 'album')} · ${L.plural(tracks.length, 'song')}`;
    cover = data.cover;
  } else {
    title = data.name;
    const total = data.tracks.reduce((s, t) => s + (t.duration || 0), 0);
    sub = `${L.plural(tracks.length, 'song')} · ${L.durationLabel(total)}`;
    cover = playlistCover(data);
  }
  $('detailTitle').textContent = title;
  $('detailSub').textContent = sub;
  setArt($('detailArt'), cover);
  const isPl = type === 'playlist';
  $('dAdd').hidden = isPl;
  $('dSort').hidden = !isPl;
  $('dRename').hidden = !isPl;
  $('dDelete').hidden = !isPl;
}

function updateCounts() {
  $('count').textContent = state.queue.length;
  $('libCount').textContent = state.library.length;
}

/** Cheap refresh of the highlighted row and play icon, without rebuilding the whole list. */
function updateActive() {
  const activePath = state.queue[state.index] && state.queue[state.index].path;
  const playing = !audio.paused;
  for (const row of $('list').children) {
    if (!row.dataset.path) continue; // group rows and headings
    const on = row.dataset.path === activePath;
    row.classList.toggle('active', on);
    row.firstChild.textContent = on && playing ? '▶' : row.dataset.n;
  }
}

function updateDuration(t) {
  const node = $('list').querySelector(`.row[data-path="${CSS.escape(t.path)}"] .r-dur`);
  if (node) node.textContent = fmt(t.duration);
}

function renderNowPlaying() {
  const t = state.queue[state.index];
  const cover = $('cover');
  if (!t) {
    $('title').textContent = 'Nothing playing';
    $('artist').textContent = 'Pick a song from your library';
    $('album').textContent = '';
    cover.style.backgroundImage = '';
    cover.classList.remove('has-art');
    document.title = 'Tempo Player';
    return;
  }
  $('title').textContent = t.title;
  $('artist').textContent = t.artist;
  $('album').textContent = t.album;
  if (t.cover) {
    cover.style.backgroundImage = `url("${t.cover}")`;
    cover.classList.add('has-art');
  } else {
    cover.style.backgroundImage = '';
    cover.classList.remove('has-art');
  }
  document.title = `${t.title} · ${t.artist}`;
}

function renderPlayIcon() {
  $('playIcon').innerHTML = audio.paused
    ? '<path fill="currentColor" d="M8 5v14l11-7z"/>'
    : '<path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
}

/** Switch tab (and optionally open a detail screen), clearing the search box. */
function go(view, detail = null) {
  state.view = view;
  state.detail = detail;
  state.filter = '';
  $('filter').value = '';
  hideMenu();
  render();
  scrollToActive();
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------------ Playback ------------------------------ */

function playIndex(i, { pushHistory = true } = {}) {
  if (i < 0 || i >= state.queue.length) return;
  if (pushHistory && state.index >= 0) state.history.push(state.index);
  state.index = i;
  audio.src = state.queue[i].url;
  audio.play().catch(() => {});
  renderNowPlaying();
  updateActive();
  scrollToActive();
}

/** Replace the queue with `list` and start playing at position `i`. */
function playFromList(list, i) {
  if (i < 0 || i >= list.length) return;
  state.queue = list;
  state.history = [];
  state.index = -1;
  updateCounts();
  playIndex(i, { pushHistory: false });
}

function playShuffled(list) {
  if (!list.length) return;
  setShuffle(true);
  playFromList(list.slice(), Math.floor(Math.random() * list.length));
}

function scrollToActive() {
  const row = $('list').querySelector('.row.active');
  if (row) row.scrollIntoView({ block: 'nearest' });
}

function pickNext() {
  const n = state.queue.length;
  if (!n) return -1;
  if (state.shuffle) {
    if (n === 1) return 0;
    let r;
    do { r = Math.floor(Math.random() * n); } while (r === state.index);
    return r;
  }
  const next = state.index + 1;
  if (next < n) return next;
  return state.repeat === 'all' ? 0 : -1;
}

function next() {
  const i = pickNext();
  if (i >= 0) playIndex(i);
  else { audio.pause(); audio.currentTime = 0; }
}

function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (state.shuffle && state.history.length) {
    playIndex(state.history.pop(), { pushHistory: false });
    return;
  }
  const p = state.index - 1;
  if (p >= 0) playIndex(p, { pushHistory: false });
  else if (state.repeat === 'all' && state.queue.length) playIndex(state.queue.length - 1, { pushHistory: false });
  else audio.currentTime = 0;
}

function toggle() {
  if (state.index < 0) {
    if (state.queue.length) playIndex(0);
    else if (state.library.length) playFromList(L.sortTracks(state.library, 'artist'), 0);
    return;
  }
  if (audio.paused) audio.play(); else audio.pause();
}

/** Songs opened by hand (dialogs or drag and drop) go to the queue. */
function addTracks(tracks) {
  if (!tracks || !tracks.length) return;
  const wasEmpty = state.queue.length === 0;
  const known = new Set(state.queue.map((t) => t.path));
  const fresh = tracks.filter((t) => !known.has(t.path));
  state.queue.push(...fresh);
  go('queue');
  if (wasEmpty && fresh.length) playIndex(0);
}

function removeAt(i) {
  const wasCurrent = i === state.index;
  state.queue.splice(i, 1);
  state.history = state.history.filter((h) => h !== i).map((h) => (h > i ? h - 1 : h));
  if (i < state.index) state.index--;
  if (wasCurrent && state.queue.length === 0) {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    state.index = -1;
  }
  render();
  if (wasCurrent && state.queue.length > 0) {
    state.index = Math.min(i, state.queue.length) - 1;
    next();
    return;
  }
  renderNowPlaying();
}

function clearQueue() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.queue = [];
  state.index = -1;
  state.history = [];
  renderNowPlaying();
  render();
  renderPlayIcon();
  $('seek').value = 0; setFill($('seek'));
  $('cur').textContent = '0:00'; $('dur').textContent = '0:00';
}

/** Play the songs on screen, starting at the one with this path. */
function playFromContext(path) {
  if (state.view === 'queue' && !state.detail) {
    playIndex(state.queue.findIndex((t) => t.path === path));
    return;
  }
  playFromList(ctx.tracks.slice(), ctx.tracks.findIndex((t) => t.path === path));
}

/* ------------------------------ Menu, name dialog ------------------------------ */

function hideMenu() { $('menu').hidden = true; }

function showMenu(x, y, items) {
  const m = $('menu');
  m.textContent = '';
  for (const it of items) {
    if (it.sep) { m.append(el('div', 'menu-sep')); continue; }
    if (it.heading) { m.append(el('div', 'menu-head', it.label)); continue; }
    const b = el('button', 'menu-item', it.label);
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    b.onclick = () => { hideMenu(); it.onClick(); };
    m.append(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
}

/** Menu entries that add `tracks` to a playlist (existing ones, or a new one). */
function addMenuItems(tracks) {
  const items = [{ heading: true, label: 'Add to playlist' }];
  for (const pl of state.playlists) items.push({ label: pl.name, onClick: () => addToPlaylist(pl.id, tracks) });
  if (state.playlists.length) items.push({ sep: true });
  items.push({
    label: 'New playlist…',
    onClick: async () => {
      const name = await askName('New playlist');
      if (name) addToPlaylist(createPlaylist(name).id, tracks);
    }
  });
  return items;
}

function openMenuBelow(button, items) {
  const r = button.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

function askName(title, initial = '') {
  return new Promise((resolve) => {
    const dlg = $('nameDialog');
    const input = $('nameInput');
    $('nameTitle').textContent = title;
    input.value = initial;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? input.value.trim() : null), { once: true });
    dlg.showModal();
    input.focus();
    input.select();
  });
}

$('nameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if ($('nameInput').value.trim()) $('nameDialog').close('ok');
});
$('nameCancel').onclick = () => $('nameDialog').close('cancel');

document.addEventListener('mousedown', (e) => { if (!$('menu').contains(e.target)) hideMenu(); });
window.addEventListener('blur', hideMenu);
$('list').addEventListener('scroll', hideMenu);

/* ------------------------------ Playlist actions ------------------------------ */

async function renamePlaylist(id) {
  const pl = findPlaylist(id);
  if (!pl) return;
  const name = await askName('Rename playlist', pl.name);
  if (!name) return;
  pl.name = name;
  savePlaylists();
  render();
}

function deletePlaylist(id) {
  const pl = findPlaylist(id);
  if (!pl || !confirm(`Delete “${pl.name}”? This can’t be undone.`)) return;
  state.playlists = state.playlists.filter((p) => p.id !== id);
  savePlaylists();
  go('playlists');
}

function sortPlaylist(id, by) {
  const pl = findPlaylist(id);
  if (!pl) return;
  L.sortPlaylist(pl, by);
  savePlaylists();
  render();
  toast('Playlist reordered');
}

function removeFromPlaylist(id, path) {
  const pl = findPlaylist(id);
  if (!pl) return;
  L.removePath(pl, path);
  savePlaylists();
  render();
}

/* ------------------------------ Library scanning ------------------------------ */

let scanHideTimer;
function showScan(text) {
  clearTimeout(scanHideTimer);
  const node = $('scanStatus');
  node.textContent = text;
  node.hidden = false;
}

async function rescan() {
  if (state.scanning) return;
  state.scanning = true;
  showScan('Scanning your music…');
  if (state.library.length === 0) render();
  try {
    const tracks = await window.tempo.libraryScan();
    if (tracks) {
      setLibrary(tracks);
      showScan(`Library updated: ${tracks.length} song${tracks.length === 1 ? '' : 's'}`);
    }
  } catch (err) {
    showScan('Could not scan your music folders.');
  } finally {
    state.scanning = false;
    scanHideTimer = setTimeout(() => { $('scanStatus').hidden = true; }, 3000);
    render();
  }
}

window.tempo.onLibraryProgress(({ done, total }) => {
  if (state.scanning) showScan(`Scanning your music… ${done} / ${total}`);
});

/* ------------------------------ Library folders dialog ------------------------------ */

function renderFolders(folders) {
  state.folders = folders;
  const ul = $('folderList');
  ul.textContent = '';
  if (!folders.length) {
    ul.append(el('li', 'f-none', 'No folders yet. Add one to build your library.'));
    return;
  }
  for (const f of folders) {
    const li = document.createElement('li');
    const p = el('span', 'f-path', f);
    p.title = f;
    const rm = el('button', null, '✕');
    rm.title = 'Stop scanning this folder';
    rm.onclick = async () => {
      renderFolders(await window.tempo.libraryRemoveFolder(f));
      rescan();
    };
    li.append(p, rm);
    ul.append(li);
  }
}

$('folders').onclick = () => { renderFolders(state.folders); $('foldersDialog').showModal(); };
$('closeFolders').onclick = () => $('foldersDialog').close();
$('rescan').onclick = rescan;
$('addLibFolder').onclick = async () => {
  const before = state.folders.length;
  const folders = await window.tempo.libraryAddFolder();
  renderFolders(folders);
  if (folders.length !== before) rescan();
};

/* ------------------------------ Audio events ------------------------------ */

audio.addEventListener('play', () => { renderPlayIcon(); updateActive(); });
audio.addEventListener('pause', () => { renderPlayIcon(); updateActive(); });
audio.addEventListener('loadedmetadata', () => {
  $('dur').textContent = fmt(currentDuration());
  const t = state.queue[state.index];
  if (t && !t.duration && isFinite(audio.duration)) { t.duration = audio.duration; updateDuration(t); }
});
audio.addEventListener('timeupdate', () => {
  const d = currentDuration();
  if (seeking || !d) return;
  $('cur').textContent = fmt(audio.currentTime);
  $('seek').value = Math.min(1000, Math.round((audio.currentTime / d) * 1000));
  setFill($('seek'));
});
// A drag can never stay "stuck": clear it when the seek lands or a new song loads.
audio.addEventListener('seeked', () => { seeking = false; });
audio.addEventListener('loadstart', () => { seeking = false; });
audio.addEventListener('ended', () => {
  if (state.repeat === 'one') { audio.currentTime = 0; audio.play(); }
  else next();
});
audio.addEventListener('error', () => {
  // skip files that fail to decode
  if (state.queue.length > 1) setTimeout(next, 300);
});

/* ------------------------------ Controls ------------------------------ */

/** Real duration from the audio element, or the tag duration if the element can't tell. */
function currentDuration() {
  if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  const t = state.queue[state.index];
  return (t && t.duration) || 0;
}

let seeking = false;
const seekEl = $('seek');
seekEl.addEventListener('input', () => {
  seeking = true;
  setFill(seekEl);
  const d = currentDuration();
  if (d) $('cur').textContent = fmt((seekEl.value / 1000) * d);
});
seekEl.addEventListener('change', () => {
  const d = currentDuration();
  if (d) audio.currentTime = (seekEl.value / 1000) * d;
  seeking = false;
});

const volEl = $('vol');
let lastVol = 80;
function applyVolume() {
  audio.volume = volEl.value / 100;
  setFill(volEl);
  $('volIcon').innerHTML = audio.muted || audio.volume === 0
    ? '<path fill="currentColor" d="M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>'
    : '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4z"/>';
}
volEl.addEventListener('input', () => {
  audio.muted = false;
  if (+volEl.value > 0) lastVol = +volEl.value;
  applyVolume();
});
function toggleMute() {
  if (audio.muted || audio.volume === 0) {
    audio.muted = false;
    volEl.value = lastVol || 80;
  } else {
    audio.muted = true;
  }
  applyVolume();
}

function setShuffle(on) {
  state.shuffle = on;
  $('shuffle').setAttribute('aria-pressed', String(on));
}
function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  const btn = $('repeat');
  btn.setAttribute('aria-pressed', String(state.repeat !== 'off'));
  $('repeatBadge').hidden = state.repeat !== 'one';
  btn.title = `Repeat: ${state.repeat} (R)`;
}

$('play').onclick = toggle;
$('next').onclick = next;
$('prev').onclick = prev;
$('shuffle').onclick = () => setShuffle(!state.shuffle);
$('repeat').onclick = cycleRepeat;
$('mute').onclick = toggleMute;
$('clear').onclick = clearQueue;
$('openFiles').onclick = async () => addTracks(await window.tempo.openFiles());
$('openFolder').onclick = async () => addTracks(await window.tempo.openFolder());

for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => go(tab.dataset.view);

$('playAll').onclick = () => {
  if (!ctx.tracks.length) return;
  playFromList(ctx.tracks.slice(), state.shuffle ? Math.floor(Math.random() * ctx.tracks.length) : 0);
};

$('sortBy').addEventListener('change', (e) => {
  state.sortBy = e.target.value;
  e.target.blur(); // so arrow keys don't keep changing the sort
  render();
});

$('newPlaylist').onclick = async () => {
  const name = await askName('New playlist');
  if (!name) return;
  const pl = createPlaylist(name);
  go('playlists', { type: 'playlist', id: pl.id });
};

$('saveQueue').onclick = async () => {
  if (!state.queue.length) { toast('The queue is empty'); return; }
  const name = await askName('Save queue as playlist', 'My queue');
  if (!name) return;
  const pl = createPlaylist(name);
  addToPlaylist(pl.id, state.queue);
};

let filterTimer;
$('filter').addEventListener('input', (e) => {
  state.filter = e.target.value;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(render, 120);
});

/* ---- detail header buttons ---- */

$('back').onclick = () => go(state.view);
$('dPlay').onclick = () => { if (ctx.tracks.length) playFromList(ctx.tracks.slice(), 0); };
$('dShuffle').onclick = () => playShuffled(ctx.tracks);
$('dAdd').onclick = (e) => {
  const d = resolveDetail();
  if (d) openMenuBelow(e.currentTarget, addMenuItems(d.tracks));
};
$('dSort').onclick = (e) => {
  const id = state.detail && state.detail.id;
  openMenuBelow(e.currentTarget, [
    { heading: true, label: 'Sort playlist by' },
    { label: 'Title (A–Z)', onClick: () => sortPlaylist(id, 'title') },
    { label: 'Artist (A–Z)', onClick: () => sortPlaylist(id, 'artist') },
    { label: 'Album (A–Z)', onClick: () => sortPlaylist(id, 'album') },
    { label: 'Length (shortest first)', onClick: () => sortPlaylist(id, 'duration') },
    { sep: true },
    { label: 'Reverse current order', onClick: () => sortPlaylist(id, 'reverse') },
    { heading: true, label: 'Or drag songs to reorder' }
  ]);
};
$('dRename').onclick = () => renamePlaylist(state.detail.id);
$('dDelete').onclick = () => deletePlaylist(state.detail.id);

/* ---- song lists ---- */

const trackForPath = (path) => ctx.tracks.find((t) => t.path === path) || state.byPath.get(path);

$('list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const action = e.target.closest('[data-action]');
  const act = action && action.dataset.action;

  if (row.dataset.nav === 'artist') {
    const a = getGroups().artists.find((x) => x.key === row.dataset.id);
    if (act === 'play') playFromList(a.tracks.slice(), 0);
    else go('artists', { type: 'artist', id: row.dataset.id });
    return;
  }
  if (row.dataset.nav === 'playlist') {
    const id = row.dataset.id;
    if (act === 'play') {
      const pl = findPlaylist(id);
      const ts = playlistTracks(pl);
      if (ts.length) playFromList(ts, 0); else toast('This playlist is empty');
    } else if (act === 'rename') renamePlaylist(id);
    else if (act === 'delete') deletePlaylist(id);
    else go('playlists', { type: 'playlist', id });
    return;
  }

  const path = row.dataset.path;
  if (act === 'add') {
    openMenuBelow(action, addMenuItems([trackForPath(path)]));
  } else if (act === 'remove') {
    if (state.detail && state.detail.type === 'playlist') removeFromPlaylist(state.detail.id, path);
    else removeAt(state.queue.findIndex((t) => t.path === path));
  } else {
    playFromContext(path);
  }
});

$('list').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row[data-path]');
  if (!row) return;
  e.preventDefault();
  const path = row.dataset.path;
  const items = [{ label: 'Play', onClick: () => playFromContext(path) }, { sep: true }, ...addMenuItems([trackForPath(path)])];
  if (state.detail && state.detail.type === 'playlist') {
    items.push({ sep: true }, { label: 'Remove from this playlist', onClick: () => removeFromPlaylist(state.detail.id, path) });
  } else if (state.view === 'queue' && !state.detail) {
    items.push({ sep: true }, { label: 'Remove from queue', onClick: () => removeAt(state.queue.findIndex((t) => t.path === path)) });
  }
  showMenu(e.clientX, e.clientY, items);
});

/* ---- album grid ---- */

$('grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  if (e.target.closest('[data-action="play"]')) {
    const a = getGroups().albums.find((x) => x.key === card.dataset.id);
    if (a) playFromList(a.tracks.slice(), 0);
  } else {
    go('albums', { type: 'album', id: card.dataset.id });
  }
});

/* ---- drag to reorder inside a playlist ---- */

let dragFrom = -1;
const clearDropMarks = () => {
  for (const r of $('list').querySelectorAll('.drop-before, .drop-after')) r.classList.remove('drop-before', 'drop-after');
};
const endDrag = () => {
  dragFrom = -1;
  clearDropMarks();
  for (const r of $('list').querySelectorAll('.dragging')) r.classList.remove('dragging');
};
const isAfter = (e, row) => {
  const r = row.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
};

$('list').addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row || !row.draggable) return;
  dragFrom = +row.dataset.i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', row.dataset.path);
  row.classList.add('dragging');
});
$('list').addEventListener('dragover', (e) => {
  if (dragFrom < 0) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  const row = e.target.closest('.row');
  if (row && row.draggable) row.classList.add(isAfter(e, row) ? 'drop-after' : 'drop-before');
});
$('list').addEventListener('drop', (e) => {
  if (dragFrom < 0) return;
  e.preventDefault();
  const row = e.target.closest('.row');
  const pl = state.detail && state.detail.type === 'playlist' && findPlaylist(state.detail.id);
  if (row && row.draggable && pl) {
    let to = +row.dataset.i + (isAfter(e, row) ? 1 : 0);
    if (dragFrom < to) to--;
    L.moveItem(pl.tracks, dragFrom, to);
    savePlaylists();
    endDrag();
    render();
    return;
  }
  endDrag();
});
$('list').addEventListener('dragend', endDrag);

/* ------------------------------ Keyboard & media keys ------------------------------ */

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range')) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') { hideMenu(); return; }
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'ArrowRight' && e.shiftKey) next();
  else if (e.code === 'ArrowLeft' && e.shiftKey) prev();
  else if (e.code === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
  else if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
  else if (e.code === 'ArrowUp') { volEl.value = Math.min(100, +volEl.value + 5); audio.muted = false; applyVolume(); }
  else if (e.code === 'ArrowDown') { volEl.value = Math.max(0, +volEl.value - 5); applyVolume(); }
  else if (e.key === 's' || e.key === 'S') setShuffle(!state.shuffle);
  else if (e.key === 'r' || e.key === 'R') cycleRepeat();
  else if (e.key === 'm' || e.key === 'M') toggleMute();
});

window.tempo.onMediaKey((a) => ({ toggle, next, prev }[a] || (() => {}))());

/* ------------------------------ Drag & drop of files ------------------------------ */

// Only react to files dragged in from outside, not to rows being reordered.
const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('drop').hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; }
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const paths = [...e.dataTransfer.files].map((f) => window.tempo.pathForFile(f)).filter(Boolean);
  if (paths.length) addTracks(await window.tempo.loadPaths(paths));
});

/* ------------------------------ Init ------------------------------ */

async function init() {
  applyVolume();
  setFill($('seek'));
  renderPlayIcon();
  // Show the cached library and saved playlists straight away, then refresh in the background.
  const [lib, playlists] = await Promise.all([
    window.tempo.libraryGet(),
    window.tempo.playlistsGet().catch(() => [])
  ]);
  state.folders = lib.folders;
  setLibrary(lib.tracks);
  state.playlists = playlists || [];
  render();
  rescan();
}
init();

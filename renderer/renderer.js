const $ = (id) => document.getElementById(id);
const audio = $('audio');

const state = {
  view: 'library',   // library | queue
  library: [],       // every track found by the scanner
  folders: [],       // folders the scanner looks in
  scanning: false,
  queue: [],
  index: -1,
  shuffle: false,
  repeat: 'off',     // off | all | one
  history: [],       // played indices, used for "previous" while shuffling
  filter: ''
};

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

/* ------------------------------ Rendering ------------------------------ */

const searchText = (t) => t._s || (t._s = `${t.title} ${t.artist} ${t.album}`.toLowerCase());

function visibleItems() {
  const q = state.filter.trim().toLowerCase();
  const items = state.view === 'queue' ? state.queue : state.library;
  return q ? items.filter((t) => searchText(t).includes(q)) : items.slice();
}

function buildRow(t, n, activePath, playing, removable) {
  const active = t.path === activePath;

  const li = document.createElement('li');
  li.className = 'row' + (active ? ' active' : '') + (removable ? ' removable' : '');
  li.dataset.path = t.path;
  li.dataset.n = n;

  const idx = document.createElement('div');
  idx.className = 'r-idx';
  idx.textContent = active && playing ? '▶' : n;

  const art = document.createElement('div');
  art.className = 'r-art';
  if (t.cover) art.style.backgroundImage = `url("${t.cover}")`;

  const text = document.createElement('div');
  text.className = 'r-text';
  const title = document.createElement('div');
  title.className = 'r-title';
  title.textContent = t.title;
  const sub = document.createElement('div');
  sub.className = 'r-sub';
  sub.textContent = [t.artist, t.album].filter(Boolean).join(' · ');
  text.append(title, sub);

  const right = document.createElement('div');
  const dur = document.createElement('span');
  dur.className = 'r-dur';
  dur.textContent = t.duration ? fmt(t.duration) : '';
  right.append(dur);
  if (removable) {
    const rm = document.createElement('button');
    rm.className = 'r-remove';
    rm.title = 'Remove from queue';
    rm.textContent = '✕';
    rm.dataset.remove = '1';
    right.append(rm);
  }

  li.append(idx, art, text, right);
  return li;
}

function renderList() {
  const items = visibleItems();
  const activePath = state.queue[state.index] && state.queue[state.index].path;
  const playing = !audio.paused;
  const removable = state.view === 'queue';

  const frag = document.createDocumentFragment();
  items.forEach((t, i) => frag.append(buildRow(t, i + 1, activePath, playing, removable)));
  const list = $('list');
  list.textContent = '';
  list.append(frag);

  $('count').textContent = state.queue.length;
  $('libCount').textContent = state.library.length;
  renderEmpty(items.length);
}

function renderEmpty(shown) {
  const el = $('empty');
  el.hidden = shown > 0;
  if (shown > 0) return;
  const searching = state.filter.trim() !== '';
  if (searching) el.textContent = 'No songs match your search.';
  else if (state.view === 'queue') el.innerHTML = 'Your queue is empty.<br />Pick songs from your library.';
  else if (state.scanning) el.textContent = 'Scanning your music…';
  else el.innerHTML = 'No music found yet.<br />Use <b>Folders</b> to choose where your music lives.';
}

/** Cheap refresh of the highlighted row and play icon, without rebuilding the whole list. */
function updateActive() {
  const activePath = state.queue[state.index] && state.queue[state.index].path;
  const playing = !audio.paused;
  for (const row of $('list').children) {
    const on = row.dataset.path === activePath;
    row.classList.toggle('active', on);
    row.firstChild.textContent = on && playing ? '▶' : row.dataset.n;
  }
}

function updateDuration(t) {
  const el = $('list').querySelector(`.row[data-path="${CSS.escape(t.path)}"] .r-dur`);
  if (el) el.textContent = fmt(t.duration);
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

function setView(view) {
  state.view = view;
  const lib = view === 'library';
  $('tabLibrary').classList.toggle('active', lib);
  $('tabLibrary').setAttribute('aria-selected', String(lib));
  $('tabQueue').classList.toggle('active', !lib);
  $('tabQueue').setAttribute('aria-selected', String(!lib));
  $('playAll').hidden = !lib;
  $('folders').hidden = !lib;
  $('clear').hidden = lib;
  $('filter').placeholder = lib ? 'Search library' : 'Search queue';
  $('filter').value = '';
  state.filter = '';
  renderList();
  scrollToActive();
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
  $('count').textContent = state.queue.length;
  playIndex(i, { pushHistory: false });
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
    else if (state.library.length) playFromList(state.library.slice(), 0);
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
  setView('queue');
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
  renderList();
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
  renderList();
  renderPlayIcon();
  $('seek').value = 0; setFill($('seek'));
  $('cur').textContent = '0:00'; $('dur').textContent = '0:00';
}

/* ------------------------------ Library scanning ------------------------------ */

let scanHideTimer;
function showScan(text) {
  clearTimeout(scanHideTimer);
  const el = $('scanStatus');
  el.textContent = text;
  el.hidden = false;
}

async function rescan() {
  if (state.scanning) return;
  state.scanning = true;
  showScan('Scanning your music…');
  if (state.view === 'library' && state.library.length === 0) renderEmpty(0);
  try {
    const tracks = await window.tempo.libraryScan();
    if (tracks) {
      state.library = tracks;
      showScan(`Library updated: ${tracks.length} song${tracks.length === 1 ? '' : 's'}`);
    }
  } catch (err) {
    showScan('Could not scan your music folders.');
  } finally {
    state.scanning = false;
    scanHideTimer = setTimeout(() => { $('scanStatus').hidden = true; }, 3000);
    renderList();
    updateActive();
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
    const li = document.createElement('li');
    li.className = 'f-none';
    li.textContent = 'No folders yet. Add one to build your library.';
    ul.append(li);
    return;
  }
  for (const f of folders) {
    const li = document.createElement('li');
    const p = document.createElement('span');
    p.className = 'f-path';
    p.title = f;
    p.textContent = f;
    const rm = document.createElement('button');
    rm.title = 'Stop scanning this folder';
    rm.textContent = '✕';
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
$('tabLibrary').onclick = () => setView('library');
$('tabQueue').onclick = () => setView('queue');
$('openFiles').onclick = async () => addTracks(await window.tempo.openFiles());
$('openFolder').onclick = async () => addTracks(await window.tempo.openFolder());

$('playAll').onclick = () => {
  const items = visibleItems();
  if (!items.length) return;
  playFromList(items, state.shuffle ? Math.floor(Math.random() * items.length) : 0);
};

let filterTimer;
$('filter').addEventListener('input', (e) => {
  state.filter = e.target.value;
  clearTimeout(filterTimer);
  filterTimer = setTimeout(renderList, 120);
});

$('list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const p = row.dataset.path;
  if (state.view === 'queue') {
    const i = state.queue.findIndex((t) => t.path === p);
    if (e.target.closest('[data-remove]')) removeAt(i);
    else playIndex(i);
  } else {
    // Playing from the library queues everything currently shown, starting here.
    const items = visibleItems();
    playFromList(items, items.findIndex((t) => t.path === p));
  }
});

/* ------------------------------ Keyboard & media keys ------------------------------ */

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'search') return;
  if ($('foldersDialog').open) return;
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

/* ------------------------------ Drag & drop ------------------------------ */

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
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
  setView('library');
  // Show the cached library straight away, then refresh it in the background.
  const { folders, tracks } = await window.tempo.libraryGet();
  state.folders = folders;
  state.library = tracks;
  renderList();
  rescan();
}
init();

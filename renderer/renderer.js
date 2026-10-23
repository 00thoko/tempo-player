const $ = (id) => document.getElementById(id);
const audio = $('audio');

const state = {
  queue: [],
  index: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  history: [],   // played indices, used for "previous" while shuffling
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

function renderQueue() {
  const list = $('list');
  list.textContent = '';
  const q = state.filter.trim().toLowerCase();

  state.queue.forEach((t, i) => {
    if (q && !`${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) return;

    const li = document.createElement('li');
    li.className = 'row' + (i === state.index ? ' active' : '');
    li.dataset.i = i;

    const idx = document.createElement('div');
    idx.className = 'r-idx';
    idx.textContent = i === state.index && !audio.paused ? '▶' : i + 1;

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
    const rm = document.createElement('button');
    rm.className = 'r-remove';
    rm.title = 'Remove from queue';
    rm.textContent = '✕';
    rm.dataset.remove = i;
    right.append(dur, rm);

    li.append(idx, art, text, right);
    list.append(li);
  });

  $('count').textContent = state.queue.length;
  $('empty').hidden = state.queue.length > 0;
}

function renderNowPlaying() {
  const t = state.queue[state.index];
  const cover = $('cover');
  if (!t) {
    $('title').textContent = 'Nothing playing';
    $('artist').textContent = 'Open files or a folder to start';
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

/* ------------------------------ Playback ------------------------------ */

function playIndex(i, { pushHistory = true } = {}) {
  if (i < 0 || i >= state.queue.length) return;
  if (pushHistory && state.index >= 0) state.history.push(state.index);
  state.index = i;
  audio.src = state.queue[i].url;
  audio.play().catch(() => {});
  renderNowPlaying();
  renderQueue();
  scrollToActive();
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
    return;
  }
  if (audio.paused) audio.play(); else audio.pause();
}

function addTracks(tracks) {
  if (!tracks || !tracks.length) return;
  const wasEmpty = state.queue.length === 0;
  const known = new Set(state.queue.map((t) => t.path));
  const fresh = tracks.filter((t) => !known.has(t.path));
  state.queue.push(...fresh);
  renderQueue();
  if (wasEmpty && fresh.length) playIndex(0);
}

function removeAt(i) {
  const wasCurrent = i === state.index;
  state.queue.splice(i, 1);
  state.history = state.history.filter((h) => h !== i).map((h) => (h > i ? h - 1 : h));
  if (i < state.index) state.index--;
  if (wasCurrent) {
    if (state.queue.length === 0) {
      audio.pause(); audio.removeAttribute('src'); audio.load();
      state.index = -1;
    } else {
      state.index = Math.min(i, state.queue.length) - 1;
      next();
      return;
    }
  }
  renderNowPlaying();
  renderQueue();
}

function clearQueue() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.queue = [];
  state.index = -1;
  state.history = [];
  renderNowPlaying();
  renderQueue();
  renderPlayIcon();
  $('seek').value = 0; setFill($('seek'));
  $('cur').textContent = '0:00'; $('dur').textContent = '0:00';
}

/* ------------------------------ Audio events ------------------------------ */

audio.addEventListener('play', () => { renderPlayIcon(); renderQueue(); });
audio.addEventListener('pause', () => { renderPlayIcon(); renderQueue(); });
audio.addEventListener('loadedmetadata', () => {
  $('dur').textContent = fmt(audio.duration);
  const t = state.queue[state.index];
  if (t && !t.duration && isFinite(audio.duration)) { t.duration = audio.duration; renderQueue(); }
});
audio.addEventListener('timeupdate', () => {
  if (seeking || !audio.duration) return;
  $('cur').textContent = fmt(audio.currentTime);
  $('seek').value = Math.round((audio.currentTime / audio.duration) * 1000);
  setFill($('seek'));
});
audio.addEventListener('ended', () => {
  if (state.repeat === 'one') { audio.currentTime = 0; audio.play(); }
  else next();
});
audio.addEventListener('error', () => {
  // skip files that fail to decode
  if (state.queue.length > 1) setTimeout(next, 300);
});

/* ------------------------------ Controls ------------------------------ */

let seeking = false;
const seekEl = $('seek');
seekEl.addEventListener('input', () => {
  seeking = true;
  setFill(seekEl);
  if (audio.duration) $('cur').textContent = fmt((seekEl.value / 1000) * audio.duration);
});
seekEl.addEventListener('change', () => {
  if (audio.duration) audio.currentTime = (seekEl.value / 1000) * audio.duration;
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
$('filter').addEventListener('input', (e) => { state.filter = e.target.value; renderQueue(); });

$('list').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) { removeAt(+rm.dataset.remove); return; }
  const row = e.target.closest('.row');
  if (row) playIndex(+row.dataset.i);
});

/* ------------------------------ Keyboard & media keys ------------------------------ */

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'search') return;
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

applyVolume();
setFill($('seek'));
renderQueue();
renderPlayIcon();

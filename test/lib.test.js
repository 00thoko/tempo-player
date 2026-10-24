const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../renderer/lib.js');
const { createStore, clean } = require('../playlists.js');

const t = (o) => ({ path: `/m/${o.title}.mp3`, title: 'x', artist: 'A', album: '', track: 0, disc: 0, duration: 100, cover: null, ...o });

const lib = [
  t({ title: 'Song B', artist: 'Zed', album: 'Second', track: 2, cover: 'c-second' }),
  t({ title: 'Song A', artist: 'Zed', album: 'Second', track: 1 }),
  t({ title: 'Opener', artist: 'Abe', album: 'First', track: 1, duration: 200 }),
  t({ title: 'Loose', artist: 'Abe', album: '', duration: 50 }),
  t({ title: 'Duet', artist: 'Abe feat. Zed', album: 'Second', albumArtist: 'Zed', track: 3 }),
  t({ title: 'Disc2', artist: 'Zed', album: 'Second', disc: 2, track: 1 })
];

test('sortTracks: by title, duration, reverse, stable copy', () => {
  assert.deepEqual(L.sortTracks(lib, 'title').map((x) => x.title), ['Disc2', 'Duet', 'Loose', 'Opener', 'Song A', 'Song B']);
  assert.deepEqual(L.sortTracks(lib, 'duration').map((x) => x.title).slice(0, 2), ['Loose', 'Disc2']); // 50s first, then ties by title
  assert.equal(L.sortTracks(lib, 'title', true)[0].title, 'Song B');
  assert.equal(lib[0].title, 'Song B', 'input is not mutated');
});

test('sortTracks: artist sort groups by album then track number', () => {
  const out = L.sortTracks(lib, 'artist').map((x) => x.title);
  assert.deepEqual(out.slice(0, 2), ['Loose', 'Opener']); // Abe: no album first, then First
  assert.deepEqual(out.filter((n) => ['Song A', 'Song B', 'Disc2'].includes(n)), ['Song A', 'Song B', 'Disc2']);
});

test('sortTracks: numeric-aware titles (Track 2 before Track 10)', () => {
  const xs = [t({ title: 'Track 10' }), t({ title: 'Track 2' })];
  assert.deepEqual(L.sortTracks(xs, 'title').map((x) => x.title), ['Track 2', 'Track 10']);
});

test('groupAlbums: groups, orders discs/tracks, honours album artist, picks a cover', () => {
  const albums = L.groupAlbums(lib);
  const second = albums.find((a) => a.title === 'Second');
  assert.equal(second.artist, 'Zed');
  assert.deepEqual(second.tracks.map((x) => x.title), ['Song A', 'Song B', 'Duet', 'Disc2']);
  assert.equal(second.cover, 'c-second');
  assert.equal(second.duration, 400);
  assert.ok(albums.find((a) => a.title === L.UNKNOWN_ALBUM && a.artist === 'Abe'));
  assert.equal(albums.length, 3);
});

test('groupArtists: counts, albums inside, playback order follows albums', () => {
  const artists = L.groupArtists(lib);
  const abe = artists.find((a) => a.name === 'Abe');
  assert.equal(abe.tracks.length, 2);
  assert.deepEqual(abe.albums.map((a) => a.title), ['First', L.UNKNOWN_ALBUM]); // unknown album last
  assert.deepEqual(abe.tracks.map((x) => x.title), ['Opener', 'Loose']);
  assert.equal(artists.length, 3); // Abe, Abe feat. Zed, Zed
});

test('groupArtists is case-insensitive and handles missing names', () => {
  const g = L.groupArtists([t({ artist: 'abe' }), t({ artist: 'ABE', title: 'y' }), t({ artist: '', title: 'z' })]);
  assert.equal(g.length, 2);
  assert.ok(g.find((a) => a.name === L.UNKNOWN_ARTIST));
});

test('playlist: create, add (no duplicates), remove', () => {
  const pl = L.newPlaylist('  Road trip  ');
  assert.equal(pl.name, 'Road trip');
  assert.equal(L.addTracks(pl, [lib[0], lib[1]]), 2);
  assert.equal(L.addTracks(pl, [lib[1], lib[2]]), 1, 'duplicate skipped');
  assert.equal(pl.tracks.length, 3);
  assert.equal(L.removePath(pl, lib[1].path), 1);
  assert.deepEqual(pl.tracks.map((x) => x.title), ['Song B', 'Opener']);
  assert.equal(L.newPlaylist('   ').name, 'Untitled');
});

test('playlist snapshots hold only small fields (no cover data)', () => {
  const pl = L.newPlaylist('p');
  L.addTracks(pl, [lib[0]]);
  assert.deepEqual(Object.keys(pl.tracks[0]).sort(), ['album', 'artist', 'disc', 'duration', 'path', 'title', 'track']);
});

test('moveItem: forwards, backwards, clamped, no-op', () => {
  assert.deepEqual(L.moveItem([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(L.moveItem([1, 2, 3, 4], 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(L.moveItem([1, 2, 3], 0, 99), [2, 3, 1]);
  assert.deepEqual(L.moveItem([1, 2, 3], 1, 1), [1, 2, 3]);
  assert.deepEqual(L.moveItem([1, 2, 3], 7, 0), [1, 2, 3]);
});

test('sortPlaylist: by title, duration and reverse', () => {
  const pl = L.newPlaylist('p');
  L.addTracks(pl, lib);
  L.sortPlaylist(pl, 'title');
  assert.equal(pl.tracks[0].title, 'Disc2');
  L.sortPlaylist(pl, 'reverse');
  assert.equal(pl.tracks[0].title, 'Song B');
  L.sortPlaylist(pl, 'duration');
  assert.equal(pl.tracks[0].title, 'Loose');
});

test('resolveItem: prefers library entry, falls back to snapshot', () => {
  const byPath = new Map([[lib[0].path, lib[0]]]);
  assert.equal(L.resolveItem({ path: lib[0].path }, byPath), lib[0]);
  const off = L.resolveItem({ path: 'C:\\Music\\a b.mp3', title: '', artist: '' }, byPath);
  assert.equal(off.title, 'a b.mp3');
  assert.equal(off.url, 'media://local/' + encodeURIComponent('C:\\Music\\a b.mp3'));
  assert.equal(off.offLibrary, true);
});

test('labels', () => {
  assert.equal(L.plural(1, 'song'), '1 song');
  assert.equal(L.plural(2, 'song'), '2 songs');
  assert.equal(L.durationLabel(600), '10 min');
  assert.equal(L.durationLabel(3900), '1 h 05 min');
});

test('playlist store: save, reload, and sanitise bad input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-pl-'));
  const file = path.join(dir, 'sub', 'playlists.json');
  const store = createStore(file);
  assert.deepEqual(store.load(), [], 'missing file = empty');

  const pl = L.newPlaylist('Mix');
  L.addTracks(pl, [lib[0], lib[2]]);
  store.save([pl]);
  assert.deepEqual(store.load(), [pl]);
  assert.equal(fs.existsSync(file + '.tmp'), false, 'temp file cleaned up');

  fs.writeFileSync(file, '{not json');
  assert.deepEqual(store.load(), [], 'corrupt file = empty, no crash');
});

test('clean(): drops malformed entries, dedupes, trims, caps names', () => {
  const out = clean([
    null,
    'x',
    { id: 'a', name: '   ', tracks: [{ path: '/a.mp3' }, { path: '/a.mp3' }, { nope: 1 }, { path: '' }] },
    { id: 'a', name: 'dup id', tracks: [] },
    { id: 'b', name: 'x'.repeat(300), tracks: 'bad' },
    { id: 5, name: 'bad id' }
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Untitled');
  assert.equal(out[0].tracks.length, 1);
  assert.equal(out[1].name.length, 100);
  assert.deepEqual(out[1].tracks, []);
  assert.deepEqual(clean('nope'), []);
});

# Tempo Player

A simple, modern desktop music player built with Electron.

## Features

- Automatic music library: scans your Music folder on start-up (and any folders you add under **Folders**), remembers them, and caches tags so later launches are fast
- Open single songs or folders to play once, including drag and drop (MP3, FLAC, WAV, OGG, M4A, AAC, Opus, WMA)
- Queue with title, artist, album, duration and cover art
- Play/pause, next/previous, seek bar, volume, mute
- Shuffle, repeat (off / all / one)
- Search within the queue
- Keyboard shortcuts and global media keys
- Dark theme

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

## Build an installer

```bash
npm run dist
```

The installer appears in the `dist/` folder (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`, depending on the OS you build on).

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Shift + Right / Left | Next / previous track |
| Right / Left | Seek 5 seconds |
| Up / Down | Volume |
| S | Toggle shuffle |
| R | Cycle repeat mode |
| M | Mute |

Keyboard media keys (play/pause, next, previous) also work when the app is not focused.

## Project layout

```
main.js            Electron main process: window, dialogs, IPC, media keys
library.js         Library folders, scanning, tag cache, cover art extraction
preload.js         Safe bridge between main and renderer
renderer/
  index.html       UI markup
  styles.css       Styling
  renderer.js      Playback, queue, controls
```

## Ideas for next steps

Lyrics view, equalizer, spectrum visualizer, mini player, saved playlists and library, remembering the last queue.

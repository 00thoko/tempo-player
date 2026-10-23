// Serves local files over the custom media:// scheme.
//
// Audio seeking needs HTTP Range support: when you drag the seek bar, the
// browser asks for "bytes=N-" and expects a 206 Partial Content reply.
// net.fetch() on a file:// URL ignores Range, which makes every seek restart
// the song, so we answer the requests ourselves.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

/** Turn a "Range" header into {start, end}, or null if absent, or 'invalid'. */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // ignore what we can't parse
  let start;
  let end = size - 1;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2])); // "last N bytes"
  } else {
    start = Number(m[1]);
    if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/** Build a protocol handler. `isServable(filePath)` decides which files may be read. */
function createMediaHandler(isServable) {
  return function handle(request) {
    const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!isServable(filePath)) return new Response('Forbidden', { status: 403 });

    let stat;
    try { stat = fs.statSync(filePath); } catch { return new Response('Not found', { status: 404 }); }
    const size = stat.size;

    const headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes'
    };

    if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });

    const range = parseRange(request.headers.get('range'), size);
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    let status = 200;
    let start = 0;
    let end = size - 1;
    if (range) {
      ({ start, end } = range);
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);

    if (request.method === 'HEAD') return new Response(null, { status, headers });
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), { status, headers });
  };
}

module.exports = { createMediaHandler, parseRange };

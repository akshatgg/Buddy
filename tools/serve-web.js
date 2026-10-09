'use strict';

/**
 * The website (web/public) on this computer, served the way Vercel serves it, to try Buddy on iPhone in a browser: clean
 * URLs (/app is app/index.html, /privacy is privacy.html), the service worker's scope header, and each file's type.
 * /api is not served here, so the app stays signed out.
 *
 *   npm run serve:web          then open http://localhost:8787/app
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'web', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** The file under `root` that a URL path is, as Vercel's clean URLs find it, or null. */
function fileFor(urlPath, root = PUBLIC) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const base = path.join(root, clean);
  if (base !== root && !base.startsWith(root + path.sep)) return null;
  for (const candidate of [base, `${base}.html`, path.join(base, 'index.html')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The headers Vercel sends with a file (web/vercel.json): its type, and the service worker's wider scope. */
function headersFor(file, root = PUBLIC) {
  const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
  if (path.relative(root, file) === path.join('app', 'sw.js')) headers['service-worker-allowed'] = '/app';
  return headers;
}

function serve({ port = Number(process.env.PORT) || 8787, root = PUBLIC } = {}) {
  const server = http.createServer((req, res) => {
    const file = fileFor(req.url, root);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, headersFor(file, root));
    fs.createReadStream(file).pipe(res);
  });
  return server.listen(port, () => console.log(`Buddy's site: http://localhost:${port}  (Buddy on iPhone: /app)`));
}

if (require.main === module) serve();

module.exports = { fileFor, headersFor, serve };

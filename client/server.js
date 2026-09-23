/**
 * Jan-Sankalp AI — Client Static Server
 * ------------------------------------------------------------------
 * Zero-dependency static file server for the SPA. Serves the files
 * inside `client/src/` on port 5500 so the frontend lives entirely
 * independently from the backend microservice (port 5000).
 *
 *   npm start        →  http://localhost:5500
 * ------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CLIENT_PORT) || 5500;
const ROOT = path.join(__dirname, 'src');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function send(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let relative = urlPath === '/' ? '/index.html' : urlPath;

    // Prevent directory traversal.
    const safePath = path
      .normalize(relative)
      .replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
      return send(res, 403, 'Forbidden');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback → serve index.html for unknown routes.
        fs.readFile(path.join(ROOT, 'index.html'), (fallbackErr, fallbackData) => {
          if (fallbackErr) {
            return send(res, 404, 'Not found');
          }
          send(res, 200, fallbackData, MIME_TYPES['.html']);
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      send(res, 200, data, MIME_TYPES[ext] || 'application/octet-stream');
    });
  } catch (err) {
    send(res, 500, 'Internal server error');
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Jan-Sankalp AI Client running on http://localhost:${PORT}`);
  console.log('  Backend API expected at http://localhost:5000/api/v1');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[client] Port ${PORT} is already in use. Set CLIENT_PORT to override.`);
  } else {
    console.error('[client] Server error:', err.message);
  }
  process.exit(1);
});
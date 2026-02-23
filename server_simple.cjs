const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // Basic CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  if (req.url === '/api/save-taxiways' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        // minimal validation
        if (!Array.isArray(payload.taxiways)) {
          return sendJSON(res, 400, { error: 'Invalid payload: missing taxiways array' });
        }

        const outDir = path.join(__dirname, 'data');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, 'custom_taxiways.json');
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

        console.log(`[server_simple] Saved ${payload.taxiways.length} taxiways to ${outPath}`);
        return sendJSON(res, 200, { ok: true, message: 'Saved' });
      } catch (err) {
        console.error('[server_simple] Error parsing/writing payload:', err);
        return sendJSON(res, 400, { error: err.message });
      }
    });
    return;
  }

  // health
  if (req.url === '/health' && req.method === 'GET') {
    return sendJSON(res, 200, { status: 'ok' });
  }

  // default
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`server_simple running at http://localhost:${PORT}`);
  console.log(`POST /api/save-taxiways to save data/custom_taxiways.json`);
});

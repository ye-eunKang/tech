const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CERT_FILE = process.env.CERT_FILE;
const KEY_FILE = process.env.KEY_FILE;
const VALID_ROLES = new Set(['phone', 'display', 'touchdesigner', 'unknown']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({ ok: true, clients: clients.size, time: Date.now() }));
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/display.html';
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const useHttps = Boolean(CERT_FILE && KEY_FILE);
const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) }, serve)
  : http.createServer(serve);

const clients = new Set();

function encodeFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function send(client, payload) {
  if (!client.socket.destroyed) client.socket.write(encodeFrame(JSON.stringify(payload)));
}

function broadcast(filter, payload, except = null) {
  for (const c of clients) {
    if (c === except || c.socket.destroyed) continue;
    if (filter(c)) send(c, payload);
  }
}

function cleanFishId(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

function register(client, role, fishId) {
  if (VALID_ROLES.has(role)) client.role = role;
  const cleanedFishId = cleanFishId(fishId);
  if (cleanedFishId) client.fishId = cleanedFishId;
}

function handleMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw); }
  catch { return; }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

  if (msg.type === 'REGISTER') {
    register(client, msg.role, msg.fishId);
    send(client, { type: 'REGISTERED', role: client.role, fishId: client.fishId });
    return;
  }

  if (msg.type === 'PING') {
    send(client, { type: 'PONG', serverTime: Date.now() });
    return;
  }

  const fishId = cleanFishId(msg.fishId) || client.fishId || 'fish01';
  const payload = { ...msg, fishId, source: client.role, serverTime: Date.now() };

  if (client.role === 'phone') {
    broadcast(c => c.role === 'display' && (!c.fishId || c.fishId === fishId), payload, client);
  } else if (client.role === 'display') {
    broadcast(c => c.role === 'phone' && c.fishId === fishId, payload, client);
  }

  if (msg.type === 'SPAWN_FISH') {
    broadcast(c => c.role === 'touchdesigner', payload, client);
  }
}

function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const b0 = client.buffer[0];
    const b1 = client.buffer[1];
    const opcode = b0 & 0x0f;
    const masked = Boolean(b1 & 0x80);
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (client.buffer.length < 4) return;
      len = client.buffer.readUInt16BE(2); offset = 4;
    } else if (len === 127) {
      if (client.buffer.length < 10) return;
      const big = client.buffer.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) { client.socket.destroy(); return; }
      len = Number(big); offset = 10;
    }

    let mask;
    if (masked) {
      if (client.buffer.length < offset + 4) return;
      mask = client.buffer.subarray(offset, offset + 4); offset += 4;
    }
    if (client.buffer.length < offset + len) return;

    let payload = Buffer.from(client.buffer.subarray(offset, offset + len));
    client.buffer = client.buffer.subarray(offset + len);
    if (masked) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }

    if (opcode === 0x8) { client.socket.end(encodeFrame('', 0x8)); return; }
    if (opcode === 0x9) { client.socket.write(encodeFrame(payload.toString(), 0xA)); continue; }
    if (opcode === 0x1) handleMessage(client, payload.toString('utf8'));
  }
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.destroy(); return;
  }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n'
  ].join('\r\n'));

  const queryRole = url.searchParams.get('role') || 'unknown';
  const client = {
    socket,
    buffer: Buffer.alloc(0),
    role: VALID_ROLES.has(queryRole) ? queryRole : 'unknown',
    fishId: cleanFishId(url.searchParams.get('fish'))
  };
  clients.add(client);
  send(client, { type: 'CONNECTED', role: client.role, fishId: client.fishId });

  socket.on('data', chunk => parseFrames(client, chunk));
  socket.on('close', () => clients.delete(client));
  socket.on('end', () => clients.delete(client));
  socket.on('error', () => clients.delete(client));
});

function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  for (const client of clients) {
    try { client.socket.end(encodeFrame('', 0x8)); } catch (_) {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fish interaction server: ${useHttps ? 'https' : 'http'}://0.0.0.0:${PORT}`);
  console.log('Display: /display.html');
  console.log('Phone/NFC: /phone.html?fish=fish01');
  console.log('Health: /health');
});

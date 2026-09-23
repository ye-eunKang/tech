const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { WebSocketServer, WebSocket } = require('ws');

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

const clients = new Set();

function cleanFishId(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      ok: true,
      clients: clients.size,
      time: Date.now()
    }));
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (pathname === '/') pathname = '/display.html';

  const relativePath = pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
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
  ? https.createServer({
      cert: fs.readFileSync(CERT_FILE),
      key: fs.readFileSync(KEY_FILE)
    }, serve)
  : http.createServer(serve);

const wss = new WebSocketServer({ noServer: true });

function send(client, payload) {
  if (client.readyState !== WebSocket.OPEN) return;
  client.send(JSON.stringify(payload));
}

function broadcast(filter, payload, except = null) {
  for (const client of clients) {
    if (client === except) continue;
    if (client.readyState !== WebSocket.OPEN) continue;
    if (filter(client)) send(client, payload);
  }
}

function register(client, role, fishId) {
  if (VALID_ROLES.has(role)) client.role = role;
  const cleanedFishId = cleanFishId(fishId);
  if (cleanedFishId) client.fishId = cleanedFishId;
}

function handleMessage(client, raw) {
  let msg;

  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

  if (msg.type === 'REGISTER') {
    register(client, msg.role, msg.fishId);
    send(client, {
      type: 'REGISTERED',
      role: client.role,
      fishId: client.fishId
    });
    return;
  }

  if (msg.type === 'PING') {
    send(client, {
      type: 'PONG',
      serverTime: Date.now()
    });
    return;
  }

  const fishId = cleanFishId(msg.fishId) || client.fishId || 'fish01';
  const payload = {
    ...msg,
    fishId,
    source: client.role,
    serverTime: Date.now()
  };

  if (client.role === 'phone') {
    broadcast(
      c => c.role === 'display' && (!c.fishId || c.fishId === fishId),
      payload,
      client
    );
  } else if (client.role === 'display') {
    broadcast(
      c => c.role === 'phone' && c.fishId === fishId,
      payload,
      client
    );
  }

  if (msg.type === 'SPAWN_FISH') {
    broadcast(c => c.role === 'touchdesigner', payload, client);
  }
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    ws.role = VALID_ROLES.has(url.searchParams.get('role'))
      ? url.searchParams.get('role')
      : 'unknown';
    ws.fishId = cleanFishId(url.searchParams.get('fish'));
    ws.isAlive = true;

    wss.emit('connection', ws, req);
  });
});

wss.on('connection', client => {
  clients.add(client);

  client.on('pong', () => {
    client.isAlive = true;
  });

  client.on('message', raw => {
    handleMessage(client, raw);
  });

  client.on('close', () => {
    clients.delete(client);
  });

  client.on('error', err => {
    console.error('WebSocket client error:', err.message);
    clients.delete(client);
  });

  send(client, {
    type: 'CONNECTED',
    role: client.role,
    fishId: client.fishId
  });
});

const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) {
      clients.delete(client);
      continue;
    }

    if (client.isAlive === false) {
      clients.delete(client);
      client.terminate();
      continue;
    }

    client.isAlive = false;
    client.ping();
  }
}, 25000);

heartbeat.unref();

function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  clearInterval(heartbeat);

  for (const client of clients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch (_) {}
  }

  wss.close();

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fish interaction server: ${useHttps ? 'https' : 'http'}://0.0.0.0:${PORT}`);
  console.log('Display: /display.html');
  console.log('Phone/NFC: /phone.html?fish=fish01');
  console.log('WebSocket: /ws');
  console.log('Health: /health');
});

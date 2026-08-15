// Optimization Galaxy: local server.
// Static files + shared multiplayer sessions (in-memory, SSE fanout). Zero dependencies.
// Usage: node server.js  (port 4610, binds 0.0.0.0 so teammates on the LAN can join)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4610;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------- sessions ----------
// sessions[id] = { state: {}, version, participants: Map<clientId,{name,joinedAt}>, streams: Set<res>, touched }
const sessions = Object.create(null);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function newId(len = 6) {
  return crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'a').slice(0, len).toUpperCase();
}

function getSession(id) {
  const s = sessions[id];
  if (s) s.touched = Date.now();
  return s;
}

function broadcast(session, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of session.streams) {
    try { res.write(payload); } catch (e) { session.streams.delete(res); }
  }
}

function roster(session) {
  return [...session.participants.values()].map(p => p.name);
}

setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(sessions)) {
    if (now - sessions[id].touched > SESSION_TTL_MS && sessions[id].streams.size === 0) delete sessions[id];
  }
}, 60 * 1000).unref();

// keepalive so proxies and browsers hold SSE open
setInterval(() => {
  for (const id of Object.keys(sessions)) {
    for (const res of sessions[id].streams) {
      try { res.write(': ping\n\n'); } catch (e) { sessions[id].streams.delete(res); }
    }
  }
}, 25 * 1000).unref();

function lanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function readBody(req, limit, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > limit) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => cb(Buffer.concat(chunks)));
  req.on('error', () => cb(null));
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ---------- API ----------
  if (p === '/api/hostinfo') {
    return json(res, 200, { port: PORT, lan: lanIPs() });
  }

  if (p === '/api/session' && req.method === 'POST') {
    let id = newId();
    while (sessions[id]) id = newId();
    sessions[id] = { state: {}, version: 0, participants: new Map(), streams: new Set(), touched: Date.now() };
    return json(res, 200, { id });
  }

  const mSession = p.match(/^\/api\/session\/([A-Z0-9]{4,12})\/(state|events|join|leave)$/);
  if (mSession) {
    const [, id, action] = mSession;
    const session = getSession(id);
    if (!session) return json(res, 404, { error: 'Session not found' });

    if (action === 'state' && req.method === 'GET') {
      return json(res, 200, { state: session.state, version: session.version, participants: roster(session) });
    }

    if (action === 'state' && req.method === 'POST') {
      return readBody(req, MAX_STATE_BYTES, buf => {
        if (!buf) return json(res, 413, { error: 'State too large' });
        let body;
        try { body = JSON.parse(buf.toString('utf8')); } catch (e) { return json(res, 400, { error: 'Bad JSON' }); }
        const patch = body.patch || {};
        for (const k of Object.keys(patch)) session.state[k] = patch[k];
        session.version += 1;
        broadcast(session, { type: 'state', patch, version: session.version, from: body.from || null });
        return json(res, 200, { version: session.version });
      });
    }

    if (action === 'join' && req.method === 'POST') {
      return readBody(req, 4096, buf => {
        let body = {};
        try { body = JSON.parse(buf.toString('utf8')); } catch (e) {}
        const clientId = String(body.clientId || newId(8));
        const name = String(body.name || 'Guest').slice(0, 24) || 'Guest';
        session.participants.set(clientId, { name, joinedAt: Date.now() });
        broadcast(session, { type: 'roster', participants: roster(session) });
        return json(res, 200, { clientId, participants: roster(session) });
      });
    }

    if (action === 'leave' && req.method === 'POST') {
      return readBody(req, 4096, buf => {
        let body = {};
        try { body = JSON.parse(buf.toString('utf8')); } catch (e) {}
        session.participants.delete(String(body.clientId || ''));
        broadcast(session, { type: 'roster', participants: roster(session) });
        return json(res, 200, { ok: true });
      });
    }

    if (action === 'events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'hello', version: session.version, participants: roster(session) })}\n\n`);
      session.streams.add(res);
      const clientId = url.searchParams.get('clientId');
      req.on('close', () => {
        session.streams.delete(res);
        if (clientId && session.participants.has(clientId)) {
          session.participants.delete(clientId);
          broadcast(session, { type: 'roster', participants: roster(session) });
        }
      });
      return;
    }
  }

  // ---------- video frame capture (used by record.html when producing the demo video) ----------
  if (p === '/api/frame' && req.method === 'POST') {
    const n = Number(url.searchParams.get('n'));
    if (!Number.isInteger(n) || n < 0 || n > 20000) return json(res, 400, { error: 'Bad frame number' });
    const dir = path.join(os.tmpdir(), 'og_frames');
    fs.mkdirSync(dir, { recursive: true });
    return readBody(req, 12 * 1024 * 1024, buf => {
      if (!buf) return json(res, 413, { error: 'Frame too large' });
      const m = buf.toString('utf8').match(/^data:image\/(jpeg|png);base64,(.+)$/s);
      if (!m) return json(res, 400, { error: 'Expected data URL' });
      fs.writeFileSync(path.join(dir, `frame_${String(n).padStart(5, '0')}.${m[1] === 'png' ? 'png' : 'jpg'}`), Buffer.from(m[2], 'base64'));
      return json(res, 200, { ok: true });
    });
  }

  // ---------- static ----------
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  let rel = decodeURIComponent(p);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const noStore = ext === '.html' || ext === '.css' || ext === '.js';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noStore ? 'no-store' : 'max-age=300',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Optimization Galaxy running on http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`LAN: http://${ip}:${PORT}`);
});

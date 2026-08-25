// Optimization Galaxy: local server.
// Static files, shared three-party sessions (factory / exporter / importer),
// a typed agent-envelope relay, and a real OCR endpoint (tesseract CLI).
// Zero npm dependencies. Usage: node server.js  (port 4610, binds 0.0.0.0)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4610;
const ROOT = __dirname;
const ORGS = ['factory', 'exporter', 'importer'];

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
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- sessions ----------
// One session per shipment. State is split into a shared surface and per-org
// surfaces; a client only ever receives shared plus its own org. That is the
// partition rule: money stays on private pages. (In-memory, demo grade.)
// sessions[id] = { shared, orgs:{factory,exporter,importer}, version,
//                  participants: Map, streams: Set<{res, org, clientId}>, touched }
const sessions = Object.create(null);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function newId(len = 6) {
  return crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'a').slice(0, len).toUpperCase();
}

function newSession() {
  return {
    shared: {},
    orgs: { factory: {}, exporter: {}, importer: {} },
    version: 0,
    participants: new Map(),
    streams: new Set(),
    touched: Date.now(),
  };
}

function getSession(id) {
  const s = sessions[id];
  if (s) s.touched = Date.now();
  return s;
}

// send an event to every stream that is allowed to see it.
// scope 'shared' goes to everyone; scope '<org>' goes only to that org.
function broadcast(session, event, scope) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of session.streams) {
    if (scope && scope !== 'shared' && client.org !== scope) continue;
    try { client.res.write(payload); } catch (e) { session.streams.delete(client); }
  }
}

function roster(session) {
  return [...session.participants.values()].map(p => ({ name: p.name, org: p.org }));
}

setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(sessions)) {
    if (now - sessions[id].touched > SESSION_TTL_MS && sessions[id].streams.size === 0) delete sessions[id];
  }
}, 60 * 1000).unref();

setInterval(() => {
  for (const id of Object.keys(sessions)) {
    for (const client of sessions[id].streams) {
      try { client.res.write(': ping\n\n'); } catch (e) { sessions[id].streams.delete(client); }
    }
  }
}, 25 * 1000).unref();

function lanIPs() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
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
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---------- OCR: real text extraction via the tesseract CLI ----------
// The image is upscaled and grayscaled first (small scans read far better),
// then handed to tesseract. If the tool is missing the caller is told plainly,
// and every field falls back to needs-human. Nothing pretends.

let TESSERACT = null;
function findBin(name) {
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  return null;
}
TESSERACT = findBin('tesseract');
const FFMPEG = findBin('ffmpeg');

function runOcr(imageBuffer, cb) {
  if (!TESSERACT) return cb({ error: 'tesseract not installed', engine: 'none' });
  const stamp = crypto.randomBytes(6).toString('hex');
  const dir = path.join(os.tmpdir(), 'og_ocr');
  fs.mkdirSync(dir, { recursive: true });
  const raw = path.join(dir, `${stamp}_in`);
  const pre = path.join(dir, `${stamp}_pre.png`);
  const outBase = path.join(dir, `${stamp}_out`);
  fs.writeFileSync(raw, imageBuffer);
  const t0 = Date.now();

  const afterPre = srcPath => {
    execFile(TESSERACT, [srcPath, outBase, '--psm', '6'], { timeout: 30000 }, err => {
      let text = '';
      try { text = fs.readFileSync(outBase + '.txt', 'utf8'); } catch (e) {}
      for (const f of [raw, pre, outBase + '.txt']) { try { fs.unlinkSync(f); } catch (e) {} }
      if (err && !text) return cb({ error: 'ocr failed', engine: 'tesseract' });
      cb({ text, words: text.split(/\s+/).filter(Boolean).length, ms: Date.now() - t0, engine: 'tesseract, local' });
    });
  };

  if (FFMPEG) {
    execFile(FFMPEG, ['-y', '-loglevel', 'error', '-i', raw,
      '-vf', 'scale=iw*2.5:ih*2.5:flags=lanczos,format=gray', pre], { timeout: 20000 },
      err => afterPre(err ? raw : pre));
  } else {
    afterPre(raw);
  }
}

// ---------- mail adapter ----------
// Sandbox mode serves the bundled specimen documents as if they had just been
// fetched from an inbox. Live mode is the seam for the Gmail API: it activates
// when the keys below exist in the environment, and the adapter in
// server-mail-gmail.js is where that integration lands.
//   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
const MAIL_MODE = (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) ? 'live' : 'sandbox';

const SANDBOX_MAIL = [
  {
    id: 'm1', org: 'exporter', channel: 'Email', from: 'IGI Antwerp', addr: 'reports@igi.org',
    subject: 'Report 7996745173 issued', docType: 'lab',
    attachment: { name: 'IGI-7996745173.png', url: '/assets/docs/igi-7996745173.png', real: true },
  },
  {
    id: 'm2', org: 'exporter', channel: 'WhatsApp', from: 'Kagiso Sebina', addr: '+267 71 4xx xxx',
    subject: 'Parcel PRC-88231, certificate attached', docType: 'mining',
    attachment: { name: 'KP-BW-2025-114872.pdf', url: null, real: false, structured: 'IGI-7996745173' },
  },
  {
    id: 'm3', org: 'importer', channel: 'Telegram', from: 'Antwerp buyer', addr: '@antwerp_dt',
    subject: 'Invoice INV-2026-0431', docType: 'invoice',
    attachment: { name: 'INV-2026-0431.pdf', url: null, real: false, structured: 'IGI-7996745173' },
  },
  {
    id: 'm4', org: 'exporter', channel: 'Email', from: 'GIA', addr: 'reports@gia.edu',
    subject: 'Report 7373304073', docType: 'lab',
    attachment: { name: 'GIA-7373304073.png', url: '/assets/docs/gia-7373304073.png', real: true },
  },
  {
    id: 'm5', org: 'importer', channel: 'Email', from: 'Kama Schachter Jewelry', addr: 'ap@kamaschachter.com',
    subject: 'Memo 001, MJ Diamonds', docType: 'invoice',
    attachment: { name: 'memo-kama-schachter.png', url: '/assets/docs/memo-kama-schachter.png', real: true },
  },
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ---------- info ----------
  if (p === '/api/hostinfo') {
    return json(res, 200, { port: PORT, lan: lanIPs(), ocr: TESSERACT ? 'tesseract, local' : 'unavailable', mail: MAIL_MODE });
  }

  // ---------- OCR ----------
  if (p === '/api/ocr' && req.method === 'POST') {
    return readBody(req, 16 * 1024 * 1024, buf => {
      if (!buf) return json(res, 413, { error: 'Too large' });
      const m = buf.toString('utf8').match(/^data:image\/[a-z+]+;base64,(.+)$/s);
      if (!m) return json(res, 400, { error: 'Expected an image data URL' });
      runOcr(Buffer.from(m[1], 'base64'), result => json(res, result.error && !result.text ? 422 : 200, result));
    });
  }

  // ---------- mail ----------
  if (p === '/api/mail/status') {
    return json(res, 200, {
      mode: MAIL_MODE,
      liveNeeds: MAIL_MODE === 'sandbox' ? ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'] : [],
    });
  }
  if (p === '/api/mail/poll') {
    const org = url.searchParams.get('org');
    if (MAIL_MODE === 'live') {
      // the Gmail adapter slots in here; until then live mode reports empty
      return json(res, 200, { mode: 'live', messages: [] });
    }
    const messages = SANDBOX_MAIL.filter(mm => !org || mm.org === org);
    return json(res, 200, { mode: 'sandbox', messages });
  }

  // ---------- sessions ----------
  if (p === '/api/session' && req.method === 'POST') {
    let id = newId();
    while (sessions[id]) id = newId();
    sessions[id] = newSession();
    return json(res, 200, { id });
  }

  const mSession = p.match(/^\/api\/session\/([A-Z0-9]{4,12})\/(state|events|join|leave|envelope)$/);
  if (mSession) {
    const [, id, action] = mSession;
    const session = getSession(id);
    if (!session) return json(res, 404, { error: 'Session not found' });

    if (action === 'state' && req.method === 'GET') {
      const org = url.searchParams.get('org');
      const visible = { shared: session.shared };
      if (ORGS.includes(org)) visible.org = session.orgs[org];
      return json(res, 200, { state: visible, version: session.version, participants: roster(session) });
    }

    if (action === 'state' && req.method === 'POST') {
      return readBody(req, MAX_STATE_BYTES, buf => {
        if (!buf) return json(res, 413, { error: 'State too large' });
        let body;
        try { body = JSON.parse(buf.toString('utf8')); } catch (e) { return json(res, 400, { error: 'Bad JSON' }); }
        const scope = ORGS.includes(body.scope) ? body.scope : 'shared';
        const target = scope === 'shared' ? session.shared : session.orgs[scope];
        const patch = body.patch || {};
        for (const k of Object.keys(patch)) target[k] = patch[k];
        session.version += 1;
        broadcast(session, { type: 'state', scope, patch, version: session.version, from: body.from || null }, scope);
        return json(res, 200, { version: session.version });
      });
    }

    if (action === 'envelope' && req.method === 'POST') {
      return readBody(req, 512 * 1024, buf => {
        let body;
        try { body = JSON.parse(buf.toString('utf8')); } catch (e) { return json(res, 400, { error: 'Bad JSON' }); }
        const env = {
          id: newId(8),
          ts: Date.now(),
          intent: String(body.intent || '').slice(0, 64),
          from: String(body.from || '').slice(0, 48),
          scope: ORGS.includes(body.scope) ? body.scope : 'shared',
          payload: body.payload || {},
        };
        if (!env.intent) return json(res, 400, { error: 'Envelope needs an intent' });
        broadcast(session, { type: 'envelope', envelope: env }, env.scope);
        return json(res, 200, { id: env.id });
      });
    }

    if (action === 'join' && req.method === 'POST') {
      return readBody(req, 4096, buf => {
        let body = {};
        try { body = JSON.parse(buf.toString('utf8')); } catch (e) {}
        const clientId = String(body.clientId || newId(8));
        const name = String(body.name || 'Guest').slice(0, 24) || 'Guest';
        const org = ORGS.includes(body.org) ? body.org : 'exporter';
        session.participants.set(clientId, { name, org, joinedAt: Date.now() });
        broadcast(session, { type: 'roster', participants: roster(session) });
        return json(res, 200, { clientId, org, participants: roster(session) });
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
      const org = ORGS.includes(url.searchParams.get('org')) ? url.searchParams.get('org') : 'exporter';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
      });
      const visible = { shared: session.shared, org: session.orgs[org] };
      res.write(`data: ${JSON.stringify({ type: 'hello', version: session.version, state: visible, participants: roster(session) })}\n\n`);
      const client = { res, org, clientId: url.searchParams.get('clientId') };
      session.streams.add(client);
      req.on('close', () => {
        session.streams.delete(client);
        if (client.clientId && session.participants.has(client.clientId)) {
          session.participants.delete(client.clientId);
          broadcast(session, { type: 'roster', participants: roster(session) });
        }
      });
      return;
    }
  }

  // ---------- video frame capture (used by record.html) ----------
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
  console.log(`OCR: ${TESSERACT ? 'tesseract, local' : 'NOT AVAILABLE (brew install tesseract)'}  Mail: ${MAIL_MODE}`);
  for (const ip of lanIPs()) console.log(`LAN: http://${ip}:${PORT}`);
});

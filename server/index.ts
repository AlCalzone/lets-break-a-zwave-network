import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage } from '../src/terminal/protocol.ts';
import { SdrSession } from './sdr-session.ts';
import { allowedHost, allowedOrigin, validateMessage } from './validation.ts';

const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535');
const token = randomBytes(32).toString('hex');
const cookieName = `sdrtop_session_${port}`;
const session = new SdrSession();
const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
const production = process.env.NODE_ENV === 'production';
const dist = resolve('dist');
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function authenticated(req: IncomingMessage) {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  const value = cookie?.slice(cookieName.length + 1);
  return !!value && Buffer.byteLength(value) === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}

function reject(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!allowedHost(req.headers.host, port)) return reject(res, 403, 'Loopback Host required');
  if (req.headers.origin && !allowedOrigin(req.headers.origin, req.headers.host, port)) return reject(res, 403, 'Same origin required');
  if (req.headers['sec-fetch-site'] === 'cross-site') return reject(res, 403, 'Cross-site request rejected');
  if (req.method !== 'GET' && req.method !== 'HEAD') return reject(res, 405, 'Method not allowed');
  let url: URL;
  try { url = new URL(req.url || '/', `http://${req.headers.host}`); }
  catch { return reject(res, 400, 'Invalid URL'); }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/api/session' && req.method === 'GET') {
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && req.headers['sec-fetch-site'] !== 'none') {
        return reject(res, 403, 'Same origin bootstrap required');
      }
      res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ state: session.state }));
      return;
    }
    if (!authenticated(req)) return reject(res, 401, 'Open the presentation first');
    return reject(res, 404, 'API route not found');
  }
  if (!production && vite) return vite.middlewares(req, res, () => reject(res, 404, 'Not found'));
  try {
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0')) return reject(res, 400, 'Invalid path');
    let path = resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!path.startsWith(dist + sep)) return reject(res, 403, 'Invalid path');
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      if (extname(path)) return reject(res, 404, 'Not found');
      path = resolve(dist, 'index.html');
    }
    const file = await stat(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': file.size });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(path);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    reject(res, 404, 'Build the presentation with npm run build first');
  }
});

const vite = production ? null : await (await import('vite')).createServer({
  server: {
    middlewareMode: true, hmr: false,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'] },
  },
});

server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/api/terminal' || !allowedOrigin(req.headers.origin, req.headers.host, port) || !authenticated(req) || sockets.clients.size >= 4) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit('connection', ws));
});

sockets.on('connection', (ws) => {
  let alive = true;
  let windowStart = Date.now();
  let actions = 0;
  let unacknowledged = 0;
  let lastAck = 0;
  const sent = new Map<number, number>();
  const send = (message: ServerMessage) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(message);
    if (message.type === 'output' || message.type === 'snapshot') {
      const bytes = Buffer.byteLength(data);
      if (message.type === 'snapshot') {
        sent.clear();
        unacknowledged = 0;
      }
      unacknowledged += bytes;
      sent.set(message.sequence, bytes);
    }
    if (unacknowledged > 1024 * 1024 || ws.bufferedAmount > 1024 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(data);
  };
  const state = (value: typeof session.state) => send({ type: 'state', state: value });
  session.on('state', state);
  session.on('output', send);
  session.on('reset', send);
  send(session.snapshot());
  state(session.state);
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);
  ws.on('pong', () => { alive = true; });
  ws.on('message', (raw, binary) => {
    if (binary) return ws.close(1003, 'Text messages required');
    try {
      const message = validateMessage(JSON.parse(raw.toString()));
      if (message.type === 'ack') {
        if (message.sequence < lastAck || message.sequence > session.sequence) throw new Error('Invalid acknowledgement');
        lastAck = message.sequence;
        for (const [sequence, size] of sent) {
          if (sequence <= message.sequence) {
            unacknowledged -= size;
            sent.delete(sequence);
          }
        }
        return;
      }
      if (Date.now() - windowStart > 1_000) { actions = 0; windowStart = Date.now(); }
      if (++actions > 10) return ws.close(1008, 'Too many commands');
      if (message.type === 'resize') {
        session.resize(message.cols, message.rows);
      } else {
        session.action(message.command).then(
          () => send({ type: 'result', id: message.id }),
          (error: unknown) => send({ type: 'result', id: message.id, error: error instanceof Error ? error.message : String(error) }),
        );
      }
    } catch {
      ws.close(1008, 'Invalid command');
    }
  });
  ws.on('error', () => ws.terminate());
  ws.on('close', () => {
    clearInterval(heartbeat);
    session.off('state', state);
    session.off('output', send);
    session.off('reset', send);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Presentation: http://127.0.0.1:${port}`);
  if (!shuttingDown) {
    void session.restore().catch((error: unknown) => {
      if (!shuttingDown) console.error(`Receiver startup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
});
server.on('error', async (error) => {
  console.error(error.message);
  await shutdown();
  process.exitCode = 1;
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const ws of sockets.clients) ws.close(1001, 'Local service is shutting down');
  await session.shutdown();
  sockets.close();
  await vite?.close();
  server.close();
  server.closeAllConnections();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@whogooned/shared';
import { authRouter } from './auth/routes.js';
import { config, tiktokEnabled } from './config.js';
import { GameEngine } from './game/engine.js';
import { Sessions } from './sessions.js';
import { registerSocketHandlers } from './socket.js';
import { createKV } from './store/index.js';

const kv = createKV();
const sessions = new Sessions(kv);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(authRouter(kv, sessions));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Production: serve the built web client from the same origin.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!auth|api|socket\.io).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: config.isProd ? undefined : { origin: config.publicUrl, credentials: true },
  maxHttpBufferSize: 64 * 1024,
});

const engine = new GameEngine(kv, io, sessions);
registerSocketHandlers(io, engine, sessions);

server.listen(config.port, () => {
  console.log(`[server] listening on :${config.port} — TikTok login ${tiktokEnabled() ? 'enabled' : 'disabled (link-only mode)'}`);
});

const shutdown = async () => {
  io.close();
  await kv.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

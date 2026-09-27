import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { bootstrap, ensureDemoContent } from './db/bootstrap.js';
import { initPush } from './services/push.js';
import { runSchedulerTick } from './services/scheduler.js';
import { api, errorHandler } from './routes/api.js';

export const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

if (config.corsOrigin) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
}

app.use(express.json({ limit: '100kb' }));
let initialized: Promise<void> | null = null;
export function initialize() {
  if (!initialized) initialized = (async () => {
    if (process.env.VERCEL && (!process.env.DATABASE_URL || !config.appToken)) throw new Error('Configuration de déploiement incomplète');
    if (!process.env.VERCEL) await migrate();
    await bootstrap();
    await initPush();
    if (!process.env.VERCEL) await ensureDemoContent();
  })().catch(error => { initialized = null; throw error; });
  return initialized;
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use((req, _res, next) => {
  if (req.path === '/healthz') return next();
  initialize().then(() => next(), next);
});

app.get('/api/internal/tick', async (req, res, next) => {
  const secret = process.env.CRON_SECRET ?? '';
  const supplied = req.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!secret || supplied.length !== secret.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return res.status(401).json({ error: 'Non autorisé' });
  try { await runSchedulerTick(); res.json({ ok: true }); } catch (e) { next(e); }
});

app.use('/api', api);

if (!process.env.VERCEL) {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

app.use(errorHandler);

export default app;

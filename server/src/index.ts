import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { bootstrap, ensureDemoContent } from './db/bootstrap.js';
import { initPush } from './services/push.js';
import { startScheduler } from './services/scheduler.js';
import { api, errorHandler } from './routes/api.js';

const app = express();
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
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', api);

// En production, le serveur sert aussi l'interface compilée (client/dist).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);

await migrate();
await bootstrap();
await initPush();
await ensureDemoContent();
app.listen(config.port, () => {
  console.log(`[vigie] API sur http://localhost:${config.port} — fuseau ${config.timezone} — OpenAI ${config.openaiApiKey ? 'configuré' : 'absent (analyseur local)'}`);
  startScheduler();
});

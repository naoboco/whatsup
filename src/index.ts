import express from 'express';
import vigie from '../server/src/app.js';

const app = express();
app.disable('x-powered-by');
app.get('/', (_req, res) => res.redirect('/index.html'));
app.use(vigie);

export default app;

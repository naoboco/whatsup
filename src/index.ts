import express from 'express';
import vigie from '../server/src/app.js';

const app = express();
app.use(vigie);

export default app;

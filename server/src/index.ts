import { config } from './config.js';
import { startScheduler } from './services/scheduler.js';
import app, { initialize } from './app.js';

await initialize();
app.listen(config.port, () => {
  console.log(`[vigie] API sur http://localhost:${config.port} — fuseau ${config.timezone} — OpenAI ${config.openaiApiKey ? 'configuré' : 'absent (analyseur local)'}`);
  startScheduler();
});

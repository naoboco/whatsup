import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { collectDue } from './collector.js';
import { fireDueReminders } from './reminders.js';
import { ensureDemoContent } from '../db/bootstrap.js';

/**
 * Planificateur interne. Chaque tâche prend un verrou consultatif PostgreSQL :
 * si plusieurs instances tournent, une seule exécute la tâche à un instant donné.
 */
async function withLock(key: number, fn: () => Promise<unknown>) {
  const c = await pool.connect();
  try {
    const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [key]);
    if (!rows[0].ok) return;
    try { await fn(); } finally { await c.query('SELECT pg_advisory_unlock($1)', [key]); }
  } catch (e) {
    console.error('[planificateur]', e);
  } finally {
    c.release();
  }
}

const timers: NodeJS.Timeout[] = [];

export function startScheduler() {
  if (!config.schedulerEnabled) { console.log('[planificateur] désactivé (SCHEDULER_ENABLED=false)'); return; }
  const reminders = () => withLock(71001, fireDueReminders);
  const collect = () => withLock(71002, async () => { await collectDue(); await ensureDemoContent(); });
  reminders();
  setTimeout(collect, 2000);
  timers.push(setInterval(reminders, config.reminderTickSeconds * 1000));
  timers.push(setInterval(collect, config.collectTickSeconds * 1000));
  console.log(`[planificateur] rappels toutes les ${config.reminderTickSeconds}s, collecte vérifiée toutes les ${config.collectTickSeconds}s`);
}

export function stopScheduler() { timers.forEach(clearInterval); }

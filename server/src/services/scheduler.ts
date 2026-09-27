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
    await c.query('BEGIN');
    const { rows } = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [key]);
    if (rows[0].ok) await fn();
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[planificateur]', e);
    throw e;
  } finally {
    c.release();
  }
}

const timers: NodeJS.Timeout[] = [];

export async function runSchedulerTick() {
  await withLock(71001, fireDueReminders);
  await withLock(71002, async () => { await collectDue(); await ensureDemoContent(); });
}

export function startScheduler() {
  if (!config.schedulerEnabled) { console.log('[planificateur] désactivé (SCHEDULER_ENABLED=false)'); return; }
  const reminders = () => withLock(71001, fireDueReminders).catch(e => console.error('[rappels]', e));
  const collect = () => withLock(71002, async () => { await collectDue(); await ensureDemoContent(); }).catch(e => console.error('[collecte]', e));
  reminders();
  setTimeout(collect, 2000);
  timers.push(setInterval(reminders, config.reminderTickSeconds * 1000));
  timers.push(setInterval(collect, config.collectTickSeconds * 1000));
  console.log(`[planificateur] rappels toutes les ${config.reminderTickSeconds}s, collecte vérifiée toutes les ${config.collectTickSeconds}s`);
}

export function stopScheduler() { timers.forEach(clearInterval); }

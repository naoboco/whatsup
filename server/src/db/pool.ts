import pg from 'pg';
import { config } from '../config.js';
import { supabaseCa } from './supabaseCa.js';

const databaseUrl = new URL(config.databaseUrl);
const sslMode = databaseUrl.searchParams.get('sslmode');
databaseUrl.searchParams.delete('sslmode');
const supabaseHost = /(^|\.)pooler\.supabase\.com$/.test(databaseUrl.hostname) || /(^|\.)supabase\.co$/.test(databaseUrl.hostname);

export const pool = new pg.Pool({
  connectionString: databaseUrl.toString(),
  max: process.env.VERCEL ? 4 : 10,
  ssl: sslMode && sslMode !== 'disable'
    ? { rejectUnauthorized: true, ...(supabaseHost ? { ca: supabaseCa } : {}) }
    : undefined,
});

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

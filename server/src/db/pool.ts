import pg from 'pg';
import { config } from '../config.js';

// timestamptz -> ISO string handled by pg as Date; we serialize via toISOString in JSON.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: process.env.VERCEL ? 4 : 10 });

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

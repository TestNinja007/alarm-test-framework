import pg from 'pg';
import { env } from './env.js';

/**
 * Direct database access, for the assertions the API cannot make.
 *
 * Used sparingly and deliberately. Most of the time asserting through the API
 * is the better test, because it exercises what a user reaches. This exists
 * for the questions the API cannot answer: did deleting a group really remove
 * its alarms rather than orphan them, is that column actually storing UTC, did
 * the partial unique index do what the migration claimed.
 *
 * Optional. When DATABASE_URL is unset the pool is never created and the specs
 * tagged @db skip, so the rest of the suite still runs.
 */

let pool: pg.Pool | undefined;

export function databaseAvailable(): boolean {
  return Boolean(env.databaseUrl);
}

function getPool(): pg.Pool {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not set; this spec should have been skipped.');
  }
  pool ??= new pg.Pool({ connectionString: env.databaseUrl, max: 4 });
  return pool;
}

export async function queryRows<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

export async function queryRow<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await queryRows<T>(sql, params);
  return rows[0];
}

export async function countRows(table: string, where = '', params: unknown[] = []): Promise<number> {
  // The table name is interpolated because identifiers cannot be parameters.
  // Only ever called with literals written in this repository.
  const sql = `SELECT count(*)::int AS count FROM ${table}${where ? ` WHERE ${where}` : ''}`;
  const row = await queryRow<{ count: number }>(sql, params);
  return row?.count ?? 0;
}

/** Closed once, from global teardown; an open pool keeps the process alive. */
export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

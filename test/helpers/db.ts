import { pool } from '../../src/db';
import { assertIsTestDatabase } from '../setup/testDatabaseUrl';

/**
 * Every application table, in no particular order — CASCADE handles the
 * foreign keys. `schema_migrations` is deliberately absent: wiping it would
 * make the next run re-apply migrations onto an existing schema.
 */
const TABLES = [
  'password_reset_tokens',
  'reviews',
  'messages',
  'orders',
  'favorites',
  'listing_images',
  'listings',
  'categories',
  'users',
] as const;

/**
 * Truncates everything and resets the identity sequences, so each test starts
 * from ids 1, 2, 3 and can assert on them.
 *
 * RESTART IDENTITY is what makes tests independent of execution order. Without
 * it, a test that expects the first user to be id 1 passes alone and fails in
 * a suite.
 */
export async function resetDatabase(): Promise<void> {
  // Belt and braces: the guard already ran in globalSetup and env.ts, but this
  // is the function that actually destroys data, so it checks for itself.
  assertIsTestDatabase(process.env.DATABASE_URL ?? '');
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

/** Reads a listing's status straight from the table, bypassing the API. */
export async function listingStatus(id: number): Promise<string | null> {
  const { rows } = await pool.query<{ status: string }>(
    'SELECT status FROM listings WHERE id = $1',
    [id],
  );
  return rows[0]?.status ?? null;
}

/** Counts rows, for asserting that a rollback really rolled back. */
export async function countRows(table: (typeof TABLES)[number]): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return rows[0]?.count ?? 0;
}

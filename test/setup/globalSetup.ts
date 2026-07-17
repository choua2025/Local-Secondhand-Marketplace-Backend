/**
 * Runs once, before any test file.
 *
 * Creates the test database if it does not exist, then applies every migration
 * to it. Schema changes therefore reach the tests automatically: add a .sql
 * file, and the next `npm test` builds it into the test database.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { databaseName, maintenanceUrl, testDatabaseUrl } from './testDatabaseUrl';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function createDatabaseIfMissing(url: string): Promise<void> {
  const name = databaseName(url);
  const admin = new Client({ connectionString: maintenanceUrl(url) });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) {
      // CREATE DATABASE cannot run inside a transaction or take a parameter,
      // so the identifier is quoted by hand. `name` comes from our own env, not
      // from user input.
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`Created test database "${name}".`);
    }
  } finally {
    await admin.end();
  }
}

async function migrate(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(rows.map((row) => row.filename));

    const pending = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .filter((file) => !applied.has(file));

    for (const filename of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(`Test DB: applied ${filename}`);
    }
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  const url = testDatabaseUrl(); // throws unless the name ends in _test
  await createDatabaseIfMissing(url);
  await migrate(url);
}

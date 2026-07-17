/**
 * A deliberately small migration runner. No framework, no down-migrations.
 *
 * It reads every .sql file in migrations/, sorts them by filename, and applies
 * the ones it has not applied before — recording each in a `schema_migrations`
 * table so re-running is a no-op rather than an error.
 *
 * Each file runs inside its own transaction, so a migration that fails halfway
 * leaves the database exactly as it was. (PostgreSQL, unlike MySQL, can roll
 * back DDL — CREATE TABLE inside a transaction really does undo.)
 *
 * Run with: npm run migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, withTransaction } from '../src/db';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedFilenames(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(rows.map((row) => row.filename));
}

async function main(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedFilenames();

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log('No pending migrations. Database is up to date.');
    return;
  }

  for (const filename of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    });
    console.log(`Applied ${filename}`);
  }

  console.log(`\n${pending.length} migration(s) applied.`);
}

main()
  .catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

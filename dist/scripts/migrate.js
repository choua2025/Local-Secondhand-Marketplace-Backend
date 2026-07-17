"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const db_1 = require("../src/db");
const MIGRATIONS_DIR = (0, node_path_1.join)(__dirname, '..', 'migrations');
async function ensureMigrationsTable() {
    await db_1.pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}
async function appliedFilenames() {
    const { rows } = await db_1.pool.query('SELECT filename FROM schema_migrations');
    return new Set(rows.map((row) => row.filename));
}
async function main() {
    await ensureMigrationsTable();
    const applied = await appliedFilenames();
    const pending = (0, node_fs_1.readdirSync)(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .filter((name) => !applied.has(name));
    if (pending.length === 0) {
        console.log('No pending migrations. Database is up to date.');
        return;
    }
    for (const filename of pending) {
        const sql = (0, node_fs_1.readFileSync)((0, node_path_1.join)(MIGRATIONS_DIR, filename), 'utf8');
        await (0, db_1.withTransaction)(async (client) => {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        });
        console.log(`Applied ${filename}`);
    }
    console.log(`\n${pending.length} migration(s) applied.`);
}
main()
    .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
})
    .finally(() => db_1.pool.end());
//# sourceMappingURL=migrate.js.map
/**
 * Runs before each test *file* is imported, which is the only window in which
 * DATABASE_URL can still be changed: src/db.ts creates its Pool at module load,
 * reading the variable exactly once.
 *
 * Note dotenv never overwrites a variable that is already set, so assigning
 * here wins over whatever .env says — and the assertion in testDatabaseUrl()
 * has already refused anything not ending in `_test`.
 */
import { afterAll } from 'vitest';
import { testDatabaseUrl } from './testDatabaseUrl';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET ??= 'test-secret-not-used-outside-tests';
process.env.NODE_ENV = 'test';

// Imported *after* the assignment above, so the Pool picks up the test URL.
const { pool } = await import('../../src/db');

// One pool per test file (Vitest gives each file its own module registry).
// Without this the process hangs on open sockets after the last test passes.
afterAll(async () => {
  await pool.end();
});

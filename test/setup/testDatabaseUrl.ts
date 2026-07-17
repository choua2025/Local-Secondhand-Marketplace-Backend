import 'dotenv/config';

/**
 * The connection string every test uses.
 *
 * Derived from DATABASE_URL by appending `_test` to the database name, unless
 * TEST_DATABASE_URL says otherwise. Deriving it means you cannot forget to set
 * a second variable and silently point the suite at development data.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return assertIsTestDatabase(explicit);

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('Neither TEST_DATABASE_URL nor DATABASE_URL is set. See server/.env.example.');
  }

  const url = new URL(base);
  // pathname is "/dbname"; the leading slash stays.
  url.pathname = `${url.pathname}_test`;
  return assertIsTestDatabase(url.toString());
}

/**
 * The guard rail. Every test run truncates every table, so a connection string
 * pointing anywhere but a database whose name ends in `_test` is refused —
 * loudly, before a single row is touched.
 */
export function assertIsTestDatabase(connectionString: string): string {
  const name = databaseName(connectionString);
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name}": the test suite TRUNCATEs every table, ` +
        `and only databases whose name ends in "_test" are allowed.`,
    );
  }
  return connectionString;
}

export function databaseName(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, '');
}

/** A connection string for the same server, but the `postgres` maintenance DB. */
export function maintenanceUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

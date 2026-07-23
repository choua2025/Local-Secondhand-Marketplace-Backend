import 'dotenv/config';
import { Pool, PoolClient, types } from 'pg';

/**
 * pg hands every value back as a string unless a type parser says otherwise,
 * because that is the only lossless default. Two decisions follow:
 *
 *   int8 / BIGINT (oid 20) -> parsed to `number`. JavaScript numbers hold
 *   integers exactly up to 2^53-1 (~9 quadrillion). Our ids will never come
 *   close, so this is safe and saves stringly-typed ids leaking everywhere.
 *
 *   numeric (oid 1700) -> LEFT AS A STRING, deliberately. Turning "19.99" into
 *   a float is exactly the bug NUMERIC(10,2) exists to prevent. Prices and
 *   order amounts stay strings all the way to the browser, which only ever
 *   displays them. If we ever need to do arithmetic on money, we do it in SQL
 *   or in integer cents — never in a JS float.
 */
types.setTypeParser(types.builtins.INT8, (value: string): number => parseInt(value, 10));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy server/.env.example to server/.env.');
}

/**
 * In production, a DATABASE_URL pointing at localhost is always a
 * misconfiguration: the database lives in another container or another host, so
 * nothing is listening on the app's own loopback interface. Left to itself, pg
 * reports this as ECONNREFUSED 127.0.0.1:5432, which says nothing about the
 * cause — the usual culprit is a local .env value pasted into a hosting
 * dashboard. Failing here instead names the actual problem.
 */
function assertRemoteHostInProduction(url: string): void {
  if (process.env.NODE_ENV !== 'production') return;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Not URL-shaped (e.g. a libpq "host=... port=..." DSN). Nothing to check.
    return;
  }

  // An empty hostname means a Unix socket / implicit localhost.
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]', ''];
  if (!loopback.includes(hostname.toLowerCase())) return;

  throw new Error(
    `DATABASE_URL points at "${hostname || 'localhost'}", but NODE_ENV is production. ` +
      'A deployed app cannot reach a database on its own loopback interface — this is ' +
      'usually a local .env value copied into the host\'s environment settings. Set ' +
      'DATABASE_URL to the managed database\'s own connection string. On Render, the ' +
      'blueprint wires it automatically via fromDatabase; if the service was created by ' +
      'hand instead, delete the DATABASE_URL you entered and add it from the database ' +
      "(Environment → Add from database), or redeploy the repo as a Blueprint.",
  );
}

/**
 * TLS for the database connection, chosen by DATABASE_SSL:
 *
 *   unset / 'false' / 'disable' — no TLS. The right answer for a local Postgres
 *                                 on localhost, where there is nothing between
 *                                 the app and the database to eavesdrop.
 *   'require'    — TLS with full certificate verification. The correct choice
 *                  in production: the connection is encrypted AND the server's
 *                  certificate is checked, so nothing can eavesdrop or MITM it.
 *   'no-verify'  — TLS but the certificate is not verified. Some managed
 *                  providers hand out self-signed or intermediate certs that
 *                  fail strict verification; this encrypts the wire without
 *                  proving the peer. A fallback, not the goal.
 *
 * Sending a password over an unencrypted connection to a remote database is a
 * plaintext-credential leak, which is why a remote DB must set this.
 */
function sslConfig(): { rejectUnauthorized: boolean } | undefined {
  const mode = process.env.DATABASE_SSL;
  if (!mode || mode === 'false' || mode === 'disable') return undefined;
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

assertRemoteHostInProduction(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: sslConfig(),
  // Cap the pool so a burst cannot open more connections than Postgres allows
  // (its default max_connections is 100, shared across every app instance).
  max: Number(process.env.DB_POOL_MAX ?? 10),
  // Fail a checkout that cannot get a connection in 10s rather than hanging the
  // request forever when the database is unreachable.
  connectionTimeoutMillis: 10_000,
  // Return idle connections to Postgres after 30s instead of holding them open.
  idleTimeoutMillis: 30_000,
});

/**
 * Anything that can run a query: the pool itself, or a single checked-out
 * client inside a transaction. Repository functions take an optional
 * `Queryable` so a service can thread one transaction through several repo
 * calls, or pass nothing and get an implicit single-statement transaction.
 */
export type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/**
 * Runs `fn` inside BEGIN/COMMIT, rolling back on any thrown error.
 *
 * The client is checked out for the whole callback and released in `finally`,
 * so a leaked client cannot exhaust the pool even if COMMIT itself throws.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

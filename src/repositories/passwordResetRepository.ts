/**
 * All password_reset_tokens SQL. No hashing and no token generation — those are
 * lib/resetToken.ts. This layer takes a hash and reads or writes a row.
 */
import { pool, Queryable } from '../db';
import { PasswordResetToken } from '../types/domain';

export interface InsertResetTokenInput {
  user_id: number;
  token_hash: string;
  expires_at: Date;
}

export async function insert(
  input: InsertResetTokenInput,
  db: Queryable = pool,
): Promise<PasswordResetToken> {
  const { rows } = await db.query<PasswordResetToken>(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.user_id, input.token_hash, input.expires_at],
  );
  const row = rows[0];
  if (!row) throw new Error('Insert returned no row');
  return row;
}

/**
 * A token that exists, has not been redeemed, and has not expired — or null.
 *
 * The three conditions live in the WHERE clause rather than in the service on
 * purpose. `now()` is the database's clock, so an app server with a skewed clock
 * cannot honour a token Postgres considers dead, and the check is atomic with
 * respect to the read.
 */
export async function findRedeemable(
  tokenHash: string,
  db: Queryable = pool,
): Promise<PasswordResetToken | null> {
  const { rows } = await db.query<PasswordResetToken>(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

/**
 * Spends a token, returning whether this call was the one that spent it.
 *
 * `used_at IS NULL` in the WHERE clause is the whole point: two requests racing
 * with the same link both pass `findRedeemable`, but only one UPDATE matches a
 * row, so only one gets `true` back. Checking `used_at` in JavaScript instead
 * would let both through.
 */
export async function markUsed(id: number, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE password_reset_tokens SET used_at = now()
     WHERE id = $1 AND used_at IS NULL`,
    [id],
  );
  return rowCount === 1;
}

/**
 * Kills every outstanding link for a user. Called when a new one is requested
 * (so the old email stops working) and again after a successful reset (so a
 * second link that arrived in the meantime cannot undo the first).
 */
export async function invalidateAllForUser(userId: number, db: Queryable = pool): Promise<void> {
  await db.query(
    `UPDATE password_reset_tokens SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insert = insert;
exports.findRedeemable = findRedeemable;
exports.markUsed = markUsed;
exports.invalidateAllForUser = invalidateAllForUser;
/**
 * All password_reset_tokens SQL. No hashing and no token generation — those are
 * lib/resetToken.ts. This layer takes a hash and reads or writes a row.
 */
const db_1 = require("../db");
async function insert(input, db = db_1.pool) {
    const { rows } = await db.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`, [input.user_id, input.token_hash, input.expires_at]);
    const row = rows[0];
    if (!row)
        throw new Error('Insert returned no row');
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
async function findRedeemable(tokenHash, db = db_1.pool) {
    const { rows } = await db.query(`SELECT * FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [tokenHash]);
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
async function markUsed(id, db = db_1.pool) {
    const { rowCount } = await db.query(`UPDATE password_reset_tokens SET used_at = now()
     WHERE id = $1 AND used_at IS NULL`, [id]);
    return rowCount === 1;
}
/**
 * Kills every outstanding link for a user. Called when a new one is requested
 * (so the old email stops working) and again after a successful reset (so a
 * second link that arrived in the meantime cannot undo the first).
 */
async function invalidateAllForUser(userId, db = db_1.pool) {
    await db.query(`UPDATE password_reset_tokens SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL`, [userId]);
}
//# sourceMappingURL=passwordResetRepository.js.map
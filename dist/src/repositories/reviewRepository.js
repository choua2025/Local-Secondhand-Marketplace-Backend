"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insert = insert;
exports.listForReviewee = listForReviewee;
/**
 * All review SQL.
 *
 * `insert` does not check for an existing review first. UNIQUE (order_id,
 * reviewer_id) is declared on the table, so a duplicate raises SQLSTATE 23505
 * and the service translates it. A pre-check would leave a window in which two
 * concurrent requests both find nothing and both insert.
 */
const db_1 = require("../db");
async function insert(orderId, reviewerId, revieweeId, rating, body, db = db_1.pool) {
    const { rows } = await db.query(`WITH inserted AS (
       INSERT INTO reviews (order_id, reviewer_id, reviewee_id, rating, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, order_id, reviewer_id, rating, body, created_at
     )
     SELECT inserted.*, u.display_name AS reviewer_name, u.avatar_url AS reviewer_avatar_url
     FROM inserted
     JOIN users u ON u.id = inserted.reviewer_id`, [orderId, reviewerId, revieweeId, rating, body]);
    const row = rows[0];
    if (!row)
        throw new Error('Review insert returned no row');
    return row;
}
/** Reviews written *about* this user, newest first, with the average. */
async function listForReviewee(revieweeId, db = db_1.pool) {
    const { rows } = await db.query(`SELECT r.id, r.order_id, r.reviewer_id, r.rating, r.body, r.created_at,
            u.display_name AS reviewer_name,
            u.avatar_url   AS reviewer_avatar_url
     FROM reviews r
     JOIN users u ON u.id = r.reviewer_id
     WHERE r.reviewee_id = $1
     ORDER BY r.created_at DESC, r.id DESC`, [revieweeId]);
    const reviews = rows.map((row) => ({
        id: row.id,
        order_id: row.order_id,
        reviewer_id: row.reviewer_id,
        reviewer_name: row.reviewer_name,
        reviewer_avatar_url: row.reviewer_avatar_url,
        rating: row.rating,
        body: row.body,
        created_at: row.created_at,
    }));
    // Averaged here rather than in SQL: we already have every row in memory, and
    // a second round-trip for AVG() would buy nothing. `null` when unreviewed —
    // an average of 0 would render as a one-star seller.
    const count = reviews.length;
    const average = count === 0 ? null : reviews.reduce((sum, review) => sum + review.rating, 0) / count;
    return { reviews, average, count };
}
//# sourceMappingURL=reviewRepository.js.map
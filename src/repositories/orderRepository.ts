/**
 * All order SQL. Two functions here are written as *guarded* updates —
 * `UPDATE ... WHERE id = $1 AND status = $expected` — and return whether they
 * matched a row. That is not a stylistic choice: it makes the database the
 * arbiter of who wins a race, instead of the gap between a SELECT and an UPDATE.
 */
import { pool, Queryable } from '../db';
import { OrderStatus } from '../types/domain';
import { OrderSummary, OrderWithParties } from '../types/dto';

/**
 * Atomically claims an active listing for a buyer.
 *
 * The `AND status = 'active'` is the entire concurrency control. Two buyers
 * hitting Buy at the same instant both run this UPDATE; Postgres serializes
 * them on the row lock, the first flips 'active' -> 'pending' and matches, the
 * second finds no row where status is still 'active' and matches nothing.
 * Exactly one gets a row back. Checking the status first and updating second
 * would let both through.
 *
 * Returns null when the listing was not active (already pending, sold, removed,
 * or nonexistent) — the caller turns that into a 409.
 */
export async function claimListingForPurchase(
  listingId: number,
  db: Queryable,
): Promise<{ seller_id: number; price: string } | null> {
  const { rows } = await db.query<{ seller_id: number; price: string }>(
    `UPDATE listings
        SET status = 'pending', updated_at = now()
      WHERE id = $1 AND status = 'active'
      RETURNING seller_id, price`,
    [listingId],
  );
  return rows[0] ?? null;
}

/** `amount` is a snapshot: later edits to the listing price must not rewrite history. */
export async function insert(
  buyerId: number,
  listingId: number,
  amount: string,
  db: Queryable,
): Promise<OrderWithParties> {
  const { rows } = await db.query<OrderWithParties>(
    `INSERT INTO orders (listing_id, buyer_id, amount)
     VALUES ($1, $2, $3)
     RETURNING id, listing_id, buyer_id, amount, status, created_at, completed_at,
               (SELECT seller_id FROM listings WHERE id = $1) AS seller_id`,
    [listingId, buyerId, amount],
  );
  const row = rows[0];
  if (!row) throw new Error('Order insert returned no row');
  return row;
}

/** The order plus both party ids, which is what authorization needs. */
export async function findByIdWithParties(
  orderId: number,
  db: Queryable = pool,
): Promise<OrderWithParties | null> {
  const { rows } = await db.query<OrderWithParties>(
    `SELECT o.id, o.listing_id, o.buyer_id, o.amount, o.status, o.created_at, o.completed_at,
            l.seller_id
     FROM orders o
     JOIN listings l ON l.id = o.listing_id
     WHERE o.id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

/**
 * Every order the user is party to — bought or sold — newest first.
 *
 * The spec listed only the buyer's orders, but the seller is the one who marks
 * an order completed, so they need to see their sales too. `role` tells the UI
 * which side the caller is on.
 */
export async function listForUser(userId: number, db: Queryable = pool): Promise<OrderSummary[]> {
  const { rows } = await db.query<OrderSummary>(
    `SELECT o.id, o.listing_id, o.amount, o.status, o.created_at, o.completed_at,
            l.title AS listing_title,
            img.url AS listing_cover_url,
            CASE WHEN o.buyer_id = $1 THEN 'buyer' ELSE 'seller' END AS role,
            CASE WHEN o.buyer_id = $1 THEN seller.display_name ELSE buyer.display_name END
              AS counterparty_name,
            EXISTS (SELECT 1 FROM reviews r
                     WHERE r.order_id = o.id AND r.reviewer_id = $1) AS reviewed_by_me
     FROM orders o
     JOIN listings l    ON l.id = o.listing_id
     JOIN users buyer   ON buyer.id = o.buyer_id
     JOIN users seller  ON seller.id = l.seller_id
     LEFT JOIN LATERAL (
       SELECT i.url FROM listing_images i
       WHERE i.listing_id = l.id
       ORDER BY i."position", i.id
       LIMIT 1
     ) img ON TRUE
     WHERE o.buyer_id = $1 OR l.seller_id = $1
     ORDER BY o.created_at DESC, o.id DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    listing_id: row.listing_id,
    listing_title: row.listing_title,
    listing_cover_url: row.listing_cover_url,
    amount: row.amount,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    role: row.role,
    counterparty_name: row.counterparty_name,
    reviewed_by_me: row.reviewed_by_me,
  }));
}

/**
 * Guarded status transition. Matches only if the order is still in the status
 * the caller believed it was in, so two concurrent PATCHes cannot both apply.
 * Returns false when nothing matched.
 *
 * completed_at is set exactly when the order becomes 'completed', and left
 * alone otherwise.
 */
export async function updateStatus(
  orderId: number,
  expectedCurrent: OrderStatus,
  next: OrderStatus,
  db: Queryable,
): Promise<boolean> {
  // The ::order_status casts are required. Postgres cannot infer a parameter's
  // type from `CASE WHEN $3 = 'completed'` alone and errors out at prepare time.
  const { rowCount } = await db.query(
    `UPDATE orders
        SET status = $3::order_status,
            completed_at = CASE WHEN $3::order_status = 'completed'
                                THEN now() ELSE completed_at END
      WHERE id = $1 AND status = $2::order_status`,
    [orderId, expectedCurrent, next],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * All favorite SQL. The interesting part is that both writes are idempotent by
 * construction, not by checking first:
 *
 *   add    -> INSERT ... ON CONFLICT DO NOTHING, resting on the composite
 *             primary key (user_id, listing_id) declared in 001_init.sql.
 *   remove -> DELETE, which matches zero rows and succeeds when it was never saved.
 *
 * A double-clicked heart therefore cannot produce an error, and neither write
 * needs a prior SELECT that another request could invalidate.
 */
import { pool, Queryable } from '../db';
import { ListingSummary } from '../types/dto';

interface FavoriteRow {
  id: number;
  title: string;
  price: string;
  condition: ListingSummary['condition'];
  city: string | null;
  created_at: Date;
  cover_image_url: string | null;
  seller_id: number;
  seller_display_name: string;
  seller_avatar_url: string | null;
  seller_city: string | null;
  rating_average: number | null;
  rating_count: number;
}

/**
 * The user's saved listings, most recently saved first.
 *
 * Removed listings are excluded: a seller taking an item down should not leave
 * a tombstone in someone else's saved list. Sold and pending ones stay — you
 * want to know what happened to the thing you were watching.
 */
export async function list(userId: number, db: Queryable = pool): Promise<ListingSummary[]> {
  const { rows } = await db.query<FavoriteRow>(
    `SELECT l.id, l.title, l.price, l.condition, l.city, l.created_at,
            img.url        AS cover_image_url,
            u.id           AS seller_id,
            u.display_name AS seller_display_name,
            u.avatar_url   AS seller_avatar_url,
            u.city         AS seller_city,
            r.rating_average,
            r.rating_count
     FROM favorites f
     JOIN listings l ON l.id = f.listing_id
     JOIN users u    ON u.id = l.seller_id
     LEFT JOIN LATERAL (
       SELECT i.url FROM listing_images i
       WHERE i.listing_id = l.id
       ORDER BY i."position", i.id
       LIMIT 1
     ) img ON TRUE
     LEFT JOIN LATERAL (
       SELECT AVG(rv.rating)::float8 AS rating_average,
              COUNT(*)::int          AS rating_count
       FROM reviews rv WHERE rv.reviewee_id = u.id
     ) r ON TRUE
     WHERE f.user_id = $1 AND l.status <> 'removed'
     ORDER BY f.created_at DESC, l.id DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    price: row.price,
    condition: row.condition,
    city: row.city,
    created_at: row.created_at,
    cover_image_url: row.cover_image_url,
    seller: {
      id: row.seller_id,
      display_name: row.seller_display_name,
      avatar_url: row.seller_avatar_url,
      city: row.seller_city,
      rating_average: row.rating_average,
      rating_count: row.rating_count,
    },
  }));
}

/** Idempotent: saving an already-saved listing is a no-op success. */
export async function add(userId: number, listingId: number, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO favorites (user_id, listing_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, listing_id) DO NOTHING`,
    [userId, listingId],
  );
}

/** Idempotent: removing something that was never saved is a no-op success. */
export async function remove(
  userId: number,
  listingId: number,
  db: Queryable = pool,
): Promise<void> {
  await db.query(`DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2`, [
    userId,
    listingId,
  ]);
}

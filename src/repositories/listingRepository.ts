/**
 * The ONLY place listing SQL lives. No business rules, no HTTP, no req/res.
 * Every function takes raw values, runs a query, and maps untyped `pg` rows
 * into typed domain/DTO objects before returning them.
 */
import { pool, Queryable } from '../db';
import { ListingCondition, ListingStatus } from '../types/domain';
import {
  CreateListingInput,
  ListingDetail,
  ListingImageDto,
  ListingSummary,
  OwnListing,
  SellerSummary,
  UpdateListingInput,
} from '../types/dto';

/** The seller columns every listing query selects. Shared by browse and detail. */
interface SellerRow {
  seller_id: number;
  seller_display_name: string;
  seller_avatar_url: string | null;
  seller_city: string | null;
  rating_average: number | null;
  rating_count: number;
}

/** The raw row shape returned by the browse query. pg gives us `any`; we name it. */
interface BrowseRow extends SellerRow {
  id: number;
  title: string;
  price: string;
  condition: ListingCondition;
  city: string | null;
  created_at: Date;
  cover_image_url: string | null;
}

function toSeller(row: SellerRow): SellerSummary {
  return {
    id: row.seller_id,
    display_name: row.seller_display_name,
    avatar_url: row.seller_avatar_url,
    city: row.seller_city,
    rating_average: row.rating_average,
    rating_count: row.rating_count,
  };
}

function toSummary(row: BrowseRow): ListingSummary {
  return {
    id: row.id,
    title: row.title,
    price: row.price,
    condition: row.condition,
    city: row.city,
    created_at: row.created_at,
    cover_image_url: row.cover_image_url,
    seller: toSeller(row),
  };
}

/**
 * In a LIKE/ILIKE pattern, `%` and `_` are wildcards and `\` escapes them. A
 * user searching for "50%" would otherwise get a match-anything wildcard, and
 * a search for "_" would match every single character. Escape them, then
 * wrap the result in our own `%…%`.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface BrowseFilters {
  city?: string | undefined;
  categorySlug?: string | undefined;
  q?: string | undefined;
  limit: number;
  offset: number;
}

/**
 * Active listings, newest first, with cover image and seller rating.
 *
 * Two things worth understanding here:
 *
 * 1. ORDER BY (created_at DESC, id DESC). created_at is not unique, and a tie
 *    makes the sort order arbitrary — across two pages of a paginated query
 *    that means rows can repeat or vanish. `id` is the unique tiebreaker that
 *    makes the ordering total.
 *
 * 2. The two LEFT JOIN LATERALs. A lateral subquery can reference columns from
 *    the rows to its left, so each listing gets its own "first image" lookup
 *    and each seller their own rating aggregate — without collapsing the result
 *    with a GROUP BY over the whole join, which would also multiply rows once
 *    a listing has several images.
 */
export async function browse(filters: BrowseFilters): Promise<ListingSummary[]> {
  const params: unknown[] = [];
  const conditions: string[] = [`l.status = 'active'`];
  let categoryCte = '';

  // A recursive CTE walks the category tree downward, so browsing "electronics"
  // also returns listings filed under Phones and iPhone.
  if (filters.categorySlug) {
    params.push(filters.categorySlug);
    categoryCte = `
      WITH RECURSIVE subtree AS (
        SELECT id FROM categories WHERE slug = $${params.length}
        UNION ALL
        SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
      )`;
    conditions.push(`l.category_id IN (SELECT id FROM subtree)`);
  }

  if (filters.city) {
    params.push(filters.city);
    conditions.push(`l.city = $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${escapeLikePattern(filters.q)}%`);
    conditions.push(`l.title ILIKE $${params.length}`);
  }

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  const sql = `
    ${categoryCte}
    SELECT l.id, l.title, l.price, l.condition, l.city, l.created_at,
           img.url            AS cover_image_url,
           u.id               AS seller_id,
           u.display_name     AS seller_display_name,
           u.avatar_url       AS seller_avatar_url,
           u.city             AS seller_city,
           r.rating_average,
           r.rating_count
    FROM listings l
    JOIN users u ON u.id = l.seller_id
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
    WHERE ${conditions.join(' AND ')}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const { rows } = await pool.query<BrowseRow>(sql, params);
  return rows.map(toSummary);
}

interface DetailRow extends SellerRow {
  id: number;
  title: string;
  description: string | null;
  price: string;
  condition: ListingCondition;
  status: ListingStatus;
  city: string | null;
  created_at: Date;
  updated_at: Date;
  view_count: number;
  category_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  category_parent_id: number | null;
}

/** One listing with its seller and category. Returns null if there is no such row. */
export async function findByIdWithDetail(
  id: number,
  db: Queryable = pool,
): Promise<ListingDetail | null> {
  const { rows } = await db.query<DetailRow>(
    `SELECT l.id, l.title, l.description, l.price, l.condition, l.status, l.city,
            l.created_at, l.updated_at, l.view_count,
            u.id           AS seller_id,
            u.display_name AS seller_display_name,
            u.avatar_url   AS seller_avatar_url,
            u.city         AS seller_city,
            r.rating_average,
            r.rating_count,
            c.id           AS category_id,
            c.name         AS category_name,
            c.slug         AS category_slug,
            c.parent_id    AS category_parent_id
     FROM listings l
     JOIN users u ON u.id = l.seller_id
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN LATERAL (
       SELECT AVG(rv.rating)::float8 AS rating_average,
              COUNT(*)::int          AS rating_count
       FROM reviews rv WHERE rv.reviewee_id = u.id
     ) r ON TRUE
     WHERE l.id = $1`,
    [id],
  );

  const row = rows[0];
  if (!row) return null;

  const images = await findImages(row.id, db);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    condition: row.condition,
    status: row.status,
    city: row.city,
    created_at: row.created_at,
    updated_at: row.updated_at,
    view_count: row.view_count,
    images,
    seller: toSeller(row),
    category:
      row.category_id !== null && row.category_name !== null && row.category_slug !== null
        ? {
            id: row.category_id,
            name: row.category_name,
            slug: row.category_slug,
            parent_id: row.category_parent_id,
          }
        : null,
  };
}

/**
 * Just the owner and status of a listing. Used for authorization checks, where
 * loading the whole detail payload (images, seller, rating) would be waste.
 * Returns null when the row does not exist.
 */
export async function findOwner(
  id: number,
  db: Queryable = pool,
): Promise<{ seller_id: number; status: ListingStatus } | null> {
  const { rows } = await db.query<{ seller_id: number; status: ListingStatus }>(
    `SELECT seller_id, status FROM listings WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Inserts the listing row. Images go in separately, via insertImage. */
export async function insert(
  sellerId: number,
  city: string | null,
  input: Omit<CreateListingInput, 'image_urls'>,
  db: Queryable = pool,
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO listings (seller_id, category_id, title, description, price, condition, city)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      sellerId,
      input.category_id,
      input.title,
      input.description,
      // The price string goes straight into NUMERIC(10,2). pg sends it as text
      // and Postgres parses it exactly — no float in the middle.
      input.price,
      input.condition,
      city,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('Listing insert returned no row');
  return row.id;
}

/**
 * One image row. `public_id` is the Cloudinary handle needed to delete the
 * asset, or null when the URL points at something we did not upload and have no
 * right to destroy. See lib/cloudinary.publicIdFromUrl.
 */
export interface ImageAsset {
  url: string;
  public_id: string | null;
}

export async function insertImage(
  listingId: number,
  image: ImageAsset,
  position: number,
  db: Queryable = pool,
): Promise<void> {
  await db.query(
    `INSERT INTO listing_images (listing_id, url, public_id, "position") VALUES ($1, $2, $3, $4)`,
    [listingId, image.url, image.public_id, position],
  );
}

/**
 * The urls and public_ids of a listing's images.
 *
 * Separate from `findImages` on purpose: that returns a DTO bound for the API,
 * and a public_id is an internal storage handle no client has any use for.
 */
export async function findImageAssets(
  listingId: number,
  db: Queryable = pool,
): Promise<ImageAsset[]> {
  const { rows } = await db.query<ImageAsset>(
    `SELECT url, public_id FROM listing_images WHERE listing_id = $1 ORDER BY "position", id`,
    [listingId],
  );
  return rows;
}

/**
 * Swaps a listing's whole gallery for a new one, in order.
 *
 * Delete-then-insert rather than a careful diff. The rows carry no identity a
 * user cares about — reordering photos is indistinguishable from replacing
 * them — and the caller runs this inside a transaction, so nobody ever observes
 * the gallery empty. A diff would be more code to arrive at the same rows.
 *
 * Returns the assets that were removed, so the caller can destroy the ones that
 * are no longer referenced. It does NOT talk to Cloudinary itself: a repository
 * that reached across the network would be untestable and would tie a storage
 * failure to a database transaction.
 */
export async function replaceImages(
  listingId: number,
  images: readonly ImageAsset[],
  db: Queryable = pool,
): Promise<ImageAsset[]> {
  const previous = await findImageAssets(listingId, db);

  await db.query(`DELETE FROM listing_images WHERE listing_id = $1`, [listingId]);

  // position 0 is the cover; the rest follow in the order the seller gave.
  for (const [position, image] of images.entries()) {
    await insertImage(listingId, image, position, db);
  }

  // An image the seller kept appears in both lists. Only the ones that are gone
  // are orphans — deleting an asset that is still on the listing would blank it.
  const keptUrls = new Set(images.map((image) => image.url));
  return previous.filter((image) => !keptUrls.has(image.url));
}

/**
 * Applies only the fields present in `fields`. seller_id, status and city are
 * unreachable from here by construction — the allow-list below is the guard,
 * not a comment asking future code to behave.
 */
export async function update(
  id: number,
  fields: UpdateListingInput,
  db: Queryable = pool,
): Promise<void> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  const updatable = ['title', 'description', 'price', 'condition', 'category_id'] as const;
  for (const column of updatable) {
    if (fields[column] !== undefined) {
      params.push(fields[column]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (assignments.length === 0) return; // Nothing sent; nothing to do.

  assignments.push(`updated_at = now()`);
  params.push(id);
  await db.query(`UPDATE listings SET ${assignments.join(', ')} WHERE id = $${params.length}`, params);
}

/** Soft delete and the sold/pending transitions both go through here. */
export async function setStatus(
  id: number,
  status: ListingStatus,
  db: Queryable = pool,
): Promise<void> {
  await db.query(`UPDATE listings SET status = $1, updated_at = now() WHERE id = $2`, [status, id]);
}

/**
 * A seller's own listings, every status except 'removed', newest first.
 * Removed rows still exist (orders reference them) but nobody wants to see them.
 */
export async function listBySeller(sellerId: number, db: Queryable = pool): Promise<OwnListing[]> {
  const { rows } = await db.query<OwnListing>(
    `SELECT l.id, l.title, l.price, l.condition, l.status, l.city, l.created_at,
            l.view_count,
            img.url AS cover_image_url
     FROM listings l
     LEFT JOIN LATERAL (
       SELECT i.url FROM listing_images i
       WHERE i.listing_id = l.id
       ORDER BY i."position", i.id
       LIMIT 1
     ) img ON TRUE
     WHERE l.seller_id = $1 AND l.status <> 'removed'
     ORDER BY l.created_at DESC, l.id DESC`,
    [sellerId],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    price: row.price,
    condition: row.condition,
    status: row.status,
    city: row.city,
    created_at: row.created_at,
    view_count: row.view_count,
    cover_image_url: row.cover_image_url,
  }));
}

/**
 * Bumps a listing's view counter and returns the new total.
 *
 * `view_count + 1` in the UPDATE itself, not read-then-write in JS: the
 * increment is atomic, so two people opening the page at once both count. The
 * caller decides *whether* to count (it excludes the owner); this just does it.
 */
export async function incrementViewCount(id: number, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ view_count: number }>(
    `UPDATE listings SET view_count = view_count + 1 WHERE id = $1 RETURNING view_count`,
    [id],
  );
  return rows[0]?.view_count ?? 0;
}

/** The current count without touching it — for the owner's own view, which is not counted. */
export async function getViewCount(id: number, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ view_count: number }>(
    `SELECT view_count FROM listings WHERE id = $1`,
    [id],
  );
  return rows[0]?.view_count ?? 0;
}

/** Distinct cities that currently have at least one active listing. */
export async function distinctCities(db: Queryable = pool): Promise<string[]> {
  const { rows } = await db.query<{ city: string }>(
    `SELECT DISTINCT city
     FROM listings
     WHERE status = 'active' AND city IS NOT NULL
     ORDER BY city`,
  );
  return rows.map((row) => row.city);
}

/** All images for a listing, cover (position 0) first. */
export async function findImages(
  listingId: number,
  db: Queryable = pool,
): Promise<ListingImageDto[]> {
  const { rows } = await db.query<{ id: number; url: string; position: number }>(
    `SELECT id, url, "position"
     FROM listing_images
     WHERE listing_id = $1
     ORDER BY "position", id`,
    [listingId],
  );
  return rows.map((row) => ({ id: row.id, url: row.url, position: row.position }));
}

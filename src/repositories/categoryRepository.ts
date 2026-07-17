import { pool, Queryable } from '../db';
import { CategorySummary } from '../types/dto';

/**
 * Every category as a flat list. The tree is small (tens of rows, not
 * thousands), so we send it whole and let the client assemble the hierarchy
 * from parent_id rather than paying for a recursive query on every page load.
 */
export async function listAll(db: Queryable = pool): Promise<CategorySummary[]> {
  const { rows } = await db.query<CategorySummary>(
    `SELECT id, name, slug, parent_id
     FROM categories
     ORDER BY parent_id NULLS FIRST, name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    parent_id: row.parent_id,
  }));
}

/** Does a category with this slug exist? Used to reject bogus browse filters. */
export async function existsBySlug(slug: string, db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM categories WHERE slug = $1) AS exists`,
    [slug],
  );
  return rows[0]?.exists ?? false;
}

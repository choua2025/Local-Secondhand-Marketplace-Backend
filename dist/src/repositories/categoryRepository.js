"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAll = listAll;
exports.existsBySlug = existsBySlug;
const db_1 = require("../db");
/**
 * Every category as a flat list. The tree is small (tens of rows, not
 * thousands), so we send it whole and let the client assemble the hierarchy
 * from parent_id rather than paying for a recursive query on every page load.
 */
async function listAll(db = db_1.pool) {
    const { rows } = await db.query(`SELECT id, name, slug, parent_id
     FROM categories
     ORDER BY parent_id NULLS FIRST, name`);
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        parent_id: row.parent_id,
    }));
}
/** Does a category with this slug exist? Used to reject bogus browse filters. */
async function existsBySlug(slug, db = db_1.pool) {
    const { rows } = await db.query(`SELECT EXISTS (SELECT 1 FROM categories WHERE slug = $1) AS exists`, [slug]);
    return rows[0]?.exists ?? false;
}
//# sourceMappingURL=categoryRepository.js.map
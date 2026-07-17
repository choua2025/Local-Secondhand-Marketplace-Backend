"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_SIZE = void 0;
exports.browse = browse;
exports.cities = cities;
exports.getById = getById;
exports.listMine = listMine;
exports.create = create;
exports.update = update;
exports.registerView = registerView;
exports.remove = remove;
/**
 * Business logic for listings. Knows nothing about HTTP — no req, no res, no
 * status codes. It validates, decides, and throws typed errors; something else
 * turns those into responses.
 */
const db_1 = require("../db");
const errors_1 = require("../errors");
const cloudinary_1 = require("../lib/cloudinary");
const pgErrors_1 = require("../lib/pgErrors");
const listingRepository = __importStar(require("../repositories/listingRepository"));
const userRepository = __importStar(require("../repositories/userRepository"));
const domain_1 = require("../types/domain");
exports.PAGE_SIZE = 20;
const MAX_TITLE_LENGTH = 140;
const MAX_IMAGES = 8;
/**
 * NUMERIC(10,2) holds 10 significant digits with 2 after the point, so at most
 * 8 before it. Validating the *string* — rather than parsing to a number and
 * checking that — is what keeps money away from binary floating point.
 * "19.999" and "1e3" and "-5" are all rejected here.
 */
const PRICE_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
function validatePrice(price) {
    if (typeof price !== 'string' || !PRICE_PATTERN.test(price)) {
        throw new errors_1.ValidationError('Price must be a number with up to 2 decimal places, e.g. 19.99');
    }
    return price;
}
function validateTitle(title) {
    if (typeof title !== 'string' || title.trim().length === 0) {
        throw new errors_1.ValidationError('Title is required');
    }
    const trimmed = title.trim();
    if (trimmed.length > MAX_TITLE_LENGTH) {
        throw new errors_1.ValidationError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer`);
    }
    return trimmed;
}
function validateCondition(condition) {
    if (typeof condition !== 'string' ||
        !domain_1.LISTING_CONDITIONS.includes(condition)) {
        throw new errors_1.ValidationError(`Condition must be one of: ${domain_1.LISTING_CONDITIONS.join(', ')}`);
    }
    return condition;
}
/**
 * Turns the client's `image_urls` into rows we can store.
 *
 * `describeImageUrl` does the per-URL work: it rejects anything that is not
 * http(s) — a `javascript:` or `data:` URL rendered into an <img src> is stored
 * XSS — and derives the Cloudinary public_id, or null for a URL we did not
 * upload and therefore may never delete.
 *
 * Duplicates are dropped. Two identical URLs in one gallery render as the same
 * photo twice, and they break the orphan calculation in `replaceImages`, which
 * compares by URL.
 */
function validateImages(urls) {
    if (!Array.isArray(urls))
        throw new errors_1.ValidationError('image_urls must be an array');
    if (urls.length > MAX_IMAGES) {
        throw new errors_1.ValidationError(`At most ${MAX_IMAGES} images per listing`);
    }
    const images = urls.map(cloudinary_1.describeImageUrl);
    const seen = new Set();
    return images.filter((image) => {
        if (seen.has(image.url))
            return false;
        seen.add(image.url);
        return true;
    });
}
/**
 * Loads the listing's owner and asserts the caller is it.
 *
 * 404 for a missing row, 403 for someone else's — we do not hide the existence
 * of a listing, since anyone can already see it through the public browse.
 */
async function assertOwner(sellerId, listingId) {
    const owner = await listingRepository.findOwner(listingId);
    if (!owner)
        throw new errors_1.NotFoundError('Listing not found');
    if (owner.seller_id !== sellerId) {
        throw new errors_1.ForbiddenError('You can only modify your own listings');
    }
}
/**
 * A page of active listings.
 *
 * `hasMore` is computed by asking for one row more than we intend to return.
 * If the extra row comes back, there is at least one more page. The obvious
 * alternative — a second `COUNT(*)` query — makes the database scan the whole
 * filtered set just to produce a number the UI only uses as a boolean.
 */
async function browse(query) {
    if (!Number.isInteger(query.page) || query.page < 1) {
        throw new errors_1.ValidationError('page must be a positive integer');
    }
    const rows = await listingRepository.browse({
        city: query.city,
        categorySlug: query.category,
        q: query.q,
        limit: exports.PAGE_SIZE + 1,
        offset: (query.page - 1) * exports.PAGE_SIZE,
    });
    const hasMore = rows.length > exports.PAGE_SIZE;
    return {
        items: hasMore ? rows.slice(0, exports.PAGE_SIZE) : rows,
        page: query.page,
        hasMore,
    };
}
/** Cities the location filter can offer. Only ones with something to show. */
async function cities() {
    return listingRepository.distinctCities();
}
/**
 * One listing, with images, seller and category.
 *
 * A removed listing 404s rather than 403s: whether a removed listing ever
 * existed is not information a stranger is entitled to. Sold and pending
 * listings stay visible — people want to see what went for what.
 */
async function getById(id) {
    if (!Number.isInteger(id) || id < 1) {
        throw new errors_1.ValidationError('listing id must be a positive integer');
    }
    const listing = await listingRepository.findByIdWithDetail(id);
    if (!listing || listing.status === 'removed') {
        throw new errors_1.NotFoundError('Listing not found');
    }
    return listing;
}
/** The seller's own listings, including sold and pending ones browse hides. */
async function listMine(sellerId) {
    return listingRepository.listBySeller(sellerId);
}
/**
 * Creates a listing and its gallery atomically.
 *
 * The listing row and every image row go in inside ONE transaction, threading
 * the same client through each repository call. Without it, a failure on the
 * third image would leave a published listing with a half-built gallery and no
 * way to tell that it was broken.
 *
 * The seller's city is copied onto the listing here, in the service — the
 * denormalization the schema calls for.
 */
async function create(sellerId, input) {
    const title = validateTitle(input.title);
    const price = validatePrice(input.price);
    const condition = validateCondition(input.condition);
    const images = validateImages(input.image_urls ?? []);
    const description = typeof input.description === 'string' && input.description.trim().length > 0
        ? input.description.trim()
        : null;
    const categoryId = input.category_id === null || input.category_id === undefined
        ? null
        : Number(input.category_id);
    if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId < 1)) {
        throw new errors_1.ValidationError('category_id must be a positive integer');
    }
    const city = await userRepository.findCity(sellerId);
    try {
        return await (0, db_1.withTransaction)(async (client) => {
            const listingId = await listingRepository.insert(sellerId, city, { title, description, price, condition, category_id: categoryId }, client);
            // position 0 is the cover; the rest follow in the order the seller gave.
            for (const [position, image] of images.entries()) {
                await listingRepository.insertImage(listingId, image, position, client);
            }
            // Read back through the same client, so we see our own uncommitted writes.
            const created = await listingRepository.findByIdWithDetail(listingId, client);
            if (!created)
                throw new Error('Listing vanished inside its own transaction');
            return created;
        });
    }
    catch (error) {
        // The only foreign key on this insert is category_id. Letting Postgres
        // decide beats a pre-check SELECT, which another transaction could
        // invalidate in the gap before the insert.
        if ((0, pgErrors_1.isForeignKeyViolation)(error)) {
            throw new errors_1.ValidationError('That category does not exist');
        }
        throw error;
    }
}
/**
 * Applies the provided fields to a listing. Only the owner may call this.
 *
 * PATCH semantics throughout: a key the client did not send is left alone, and
 * is not the same as a key sent as null. `description: null` clears the
 * description; omitting `description` keeps it. The controller is what draws
 * that distinction, by copying across only the keys actually present in the
 * body — the service can then trust `undefined` to mean "absent".
 *
 * Images are all-or-nothing. Sending `image_urls` replaces the entire gallery
 * in the order given, so the first URL becomes the new cover. There is no
 * "append one photo" operation, because reordering and replacing are the same
 * request and the client already holds the full list.
 *
 * Photos dropped from the gallery are deleted from Cloudinary — but only after
 * the transaction commits, and only if we uploaded them. See below.
 */
async function update(sellerId, id, fields) {
    if (!Number.isInteger(id) || id < 1) {
        throw new errors_1.ValidationError('listing id must be a positive integer');
    }
    await assertOwner(sellerId, id);
    const patch = {};
    if (fields.title !== undefined)
        patch.title = validateTitle(fields.title);
    if (fields.price !== undefined)
        patch.price = validatePrice(fields.price);
    if (fields.condition !== undefined)
        patch.condition = validateCondition(fields.condition);
    if (fields.description !== undefined) {
        patch.description =
            typeof fields.description === 'string' && fields.description.trim().length > 0
                ? fields.description.trim()
                : null;
    }
    if (fields.category_id !== undefined)
        patch.category_id = fields.category_id;
    // Validated before the transaction opens: a bad URL should cost a 400 and no
    // database work at all, rather than a BEGIN and a ROLLBACK.
    const images = fields.image_urls === undefined ? undefined : validateImages(fields.image_urls);
    let orphaned = [];
    try {
        await (0, db_1.withTransaction)(async (client) => {
            await listingRepository.update(id, patch, client);
            if (images !== undefined) {
                // The row change and the gallery change land together. A crash between
                // them would otherwise leave a listing whose title no longer matches
                // its photos, with nothing to say which half is right.
                orphaned = await listingRepository.replaceImages(id, images, client);
            }
        });
    }
    catch (error) {
        if ((0, pgErrors_1.isForeignKeyViolation)(error)) {
            throw new errors_1.ValidationError('That category does not exist');
        }
        throw error;
    }
    /**
     * Cleanup runs after the commit, and never inside it.
     *
     * Deleting a remote file is not transactional. If we destroyed the asset
     * first and the transaction then rolled back, the listing would still point
     * at an image that no longer exists — a broken photo, unrecoverable. Doing it
     * afterwards inverts the failure: the worst case is a file nobody references,
     * which costs a little storage and breaks nothing.
     *
     * `destroyAssets` skips public_id === null, which is how images somebody
     * pasted in from another site survive: they were never ours to delete.
     */
    await (0, cloudinary_1.destroyAssets)(orphaned.map((image) => image.public_id));
    const updated = await listingRepository.findByIdWithDetail(id);
    if (!updated)
        throw new errors_1.NotFoundError('Listing not found');
    return updated;
}
/**
 * Records that someone opened a listing's page, and returns the new total.
 *
 * Two views are deliberately not counted:
 *   - The seller opening their own listing. A view count is a signal of outside
 *     interest, and a seller checking their own page all day would drown it.
 *   - A view of a removed listing, which 404s like every other read of one.
 *
 * Sold and pending listings DO count — people look at what sold and for how
 * much, and that interest is real. `viewerId` is null for a logged-out visitor,
 * whose view counts (they cannot be the owner).
 */
async function registerView(listingId, viewerId) {
    if (!Number.isInteger(listingId) || listingId < 1) {
        throw new errors_1.ValidationError('listing id must be a positive integer');
    }
    const owner = await listingRepository.findOwner(listingId);
    if (!owner || owner.status === 'removed') {
        throw new errors_1.NotFoundError('Listing not found');
    }
    if (viewerId !== null && viewerId === owner.seller_id) {
        return listingRepository.getViewCount(listingId);
    }
    return listingRepository.incrementViewCount(listingId);
}
/**
 * Soft delete. Never a DELETE: orders and reviews hold foreign keys into this
 * row, and a sale that happened stays a fact even if the seller takes the
 * listing down.
 */
async function remove(sellerId, id) {
    if (!Number.isInteger(id) || id < 1) {
        throw new errors_1.ValidationError('listing id must be a positive integer');
    }
    await assertOwner(sellerId, id);
    await listingRepository.setStatus(id, 'removed');
}
//# sourceMappingURL=listingService.js.map
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
exports.list = list;
exports.add = add;
exports.remove = remove;
const errors_1 = require("../errors");
const favoriteRepository = __importStar(require("../repositories/favoriteRepository"));
const listingRepository = __importStar(require("../repositories/listingRepository"));
function validateListingId(listingId) {
    if (!Number.isInteger(listingId) || listingId < 1) {
        throw new errors_1.ValidationError('listing id must be a positive integer');
    }
}
async function list(userId) {
    return favoriteRepository.list(userId);
}
/**
 * Saves a listing. Idempotent — saving twice succeeds both times.
 *
 * We do check the listing exists first, but for a different reason than usual:
 * without it the foreign key would reject the insert with a raw 23503 and the
 * user would see a 500. There is no race worth worrying about here, because the
 * worst outcome of a listing disappearing in the gap is a favorite row pointing
 * at a listing `list()` already filters out.
 */
async function add(userId, listingId) {
    validateListingId(listingId);
    const listing = await listingRepository.findOwner(listingId);
    if (!listing || listing.status === 'removed') {
        throw new errors_1.NotFoundError('Listing not found');
    }
    await favoriteRepository.add(userId, listingId);
}
/**
 * Unsaves a listing. Idempotent, and deliberately does NOT check the listing
 * exists: letting someone clean up a favorite pointing at a removed listing is
 * strictly better than making them fail at it.
 */
async function remove(userId, listingId) {
    validateListingId(listingId);
    await favoriteRepository.remove(userId, listingId);
}
//# sourceMappingURL=favoriteService.js.map
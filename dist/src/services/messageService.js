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
exports.thread = thread;
exports.listThreads = listThreads;
exports.send = send;
exports.markRead = markRead;
exports.unreadCount = unreadCount;
/**
 * Messaging between a buyer and a seller about a listing.
 *
 * The schema enforces `sender_id <> recipient_id` and the foreign keys. The two
 * rules it cannot express live here: a message must be attached to a listing,
 * and one of the two parties must be that listing's seller.
 */
const errors_1 = require("../errors");
const pgErrors_1 = require("../lib/pgErrors");
const listingRepository = __importStar(require("../repositories/listingRepository"));
const messageRepository = __importStar(require("../repositories/messageRepository"));
const MAX_BODY_LENGTH = 2000;
function validateId(value, name) {
    if (!Number.isInteger(value) || value < 1) {
        throw new errors_1.ValidationError(`${name} must be a positive integer`);
    }
}
/**
 * A thread is symmetric and scoped to the caller: the repository query has the
 * caller's id on both sides of the OR, so a non-participant asking for someone
 * else's conversation gets an empty array, not their messages. There is no
 * separate permission check because there is no query that could leak.
 */
async function thread(userId, listingId, otherUserId) {
    validateId(listingId, 'listingId');
    validateId(otherUserId, 'otherUserId');
    if (otherUserId === userId) {
        throw new errors_1.ValidationError('You cannot have a conversation with yourself');
    }
    return messageRepository.thread(userId, listingId, otherUserId);
}
async function listThreads(userId) {
    return messageRepository.listThreads(userId);
}
async function send(senderId, input) {
    const listingId = Number(input.listing_id);
    const recipientId = Number(input.recipient_id);
    validateId(listingId, 'listing_id');
    validateId(recipientId, 'recipient_id');
    if (recipientId === senderId) {
        // The DB's CHECK would reject this too, but as an opaque 500. Say why.
        throw new errors_1.ValidationError('You cannot message yourself');
    }
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (body.length === 0) {
        throw new errors_1.ValidationError('Message cannot be empty');
    }
    if (body.length > MAX_BODY_LENGTH) {
        throw new errors_1.ValidationError(`Message must be ${MAX_BODY_LENGTH} characters or fewer`);
    }
    const listing = await listingRepository.findOwner(listingId);
    if (!listing || listing.status === 'removed') {
        throw new errors_1.NotFoundError('Listing not found');
    }
    /**
     * One party must be the seller. Without this, any user could message any
     * other user by naming a listing neither of them has anything to do with —
     * the listing would just be a pretext for an open messaging channel.
     */
    if (listing.seller_id !== senderId && listing.seller_id !== recipientId) {
        throw new errors_1.ValidationError('You can only message the seller of this listing');
    }
    try {
        return await messageRepository.insert(senderId, recipientId, listingId, body);
    }
    catch (error) {
        // The only remaining foreign key is recipient_id -> users.
        if ((0, pgErrors_1.isForeignKeyViolation)(error)) {
            throw new errors_1.NotFoundError('That user does not exist');
        }
        throw error;
    }
}
/** Marks the other person's messages in this thread as read. Returns how many. */
async function markRead(userId, listingId, otherUserId) {
    validateId(listingId, 'listing_id');
    validateId(otherUserId, 'other_user_id');
    return messageRepository.markRead(userId, listingId, otherUserId);
}
async function unreadCount(userId) {
    return messageRepository.unreadCount(userId);
}
//# sourceMappingURL=messageService.js.map
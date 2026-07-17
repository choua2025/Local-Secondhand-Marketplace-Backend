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
exports.place = place;
exports.listForUser = listForUser;
exports.updateStatus = updateStatus;
/**
 * Buying, and the lifecycle of an order.
 *
 * Two rules the schema alone cannot express live here:
 *   1. Exactly one buyer may claim a listing (enforced with a guarded UPDATE,
 *      not a check-then-write).
 *   2. Only certain people may make certain status transitions.
 */
const db_1 = require("../db");
const errors_1 = require("../errors");
const listingRepository = __importStar(require("../repositories/listingRepository"));
const orderRepository = __importStar(require("../repositories/orderRepository"));
const domain_1 = require("../types/domain");
const TRANSITIONS = [
    { from: 'pending', to: 'paid', who: ['buyer'], listingBecomes: null },
    { from: 'paid', to: 'completed', who: ['seller'], listingBecomes: 'sold' },
    { from: 'pending', to: 'cancelled', who: ['buyer', 'seller'], listingBecomes: 'active' },
    { from: 'paid', to: 'cancelled', who: ['buyer', 'seller'], listingBecomes: 'active' },
    { from: 'completed', to: 'refunded', who: ['seller'], listingBecomes: 'active' },
];
function findTransition(from, to) {
    return TRANSITIONS.find((t) => t.from === from && t.to === to);
}
/**
 * Places an order.
 *
 * Everything happens inside one transaction, and the *first* statement is the
 * guarded UPDATE that claims the listing. That ordering matters: it takes the
 * row lock before we do anything else, so a second buyer arriving mid-flight
 * blocks on it and then finds the listing no longer 'active'.
 *
 * Throwing anywhere in here rolls back the claim, which is how the self-purchase
 * check below can run *after* the listing has already been flipped to 'pending'.
 */
async function place(buyerId, listingId) {
    if (!Number.isInteger(listingId) || listingId < 1) {
        throw new errors_1.ValidationError('listing id must be a positive integer');
    }
    return (0, db_1.withTransaction)(async (client) => {
        const claimed = await orderRepository.claimListingForPurchase(listingId, client);
        if (!claimed) {
            // Either it never existed, or somebody else got there first. Distinguish
            // the two only for the message — both are terminal for this request.
            const listing = await listingRepository.findOwner(listingId, client);
            if (!listing || listing.status === 'removed') {
                throw new errors_1.NotFoundError('Listing not found');
            }
            throw new errors_1.ConflictError('This listing is no longer available');
        }
        if (claimed.seller_id === buyerId) {
            // Rolls back the claim we just made, restoring 'active'.
            throw new errors_1.ValidationError('You cannot buy your own listing');
        }
        // claimed.price is the snapshot. Reading it from the same UPDATE that
        // claimed the row means no other transaction can have changed it in between.
        return orderRepository.insert(buyerId, listingId, claimed.price, client);
    });
}
async function listForUser(userId) {
    return orderRepository.listForUser(userId);
}
/**
 * Moves an order along its lifecycle, updating the listing to match.
 *
 * Authorization is a three-part question: are you party to this order at all,
 * is the move legal from where the order currently is, and is it legal *for
 * your role*. All three are answered before anything is written.
 */
async function updateStatus(userId, orderId, newStatus) {
    if (!Number.isInteger(orderId) || orderId < 1) {
        throw new errors_1.ValidationError('order id must be a positive integer');
    }
    if (!domain_1.ORDER_STATUSES.includes(newStatus)) {
        throw new errors_1.ValidationError(`status must be one of: ${domain_1.ORDER_STATUSES.join(', ')}`);
    }
    const target = newStatus;
    const order = await orderRepository.findByIdWithParties(orderId);
    if (!order)
        throw new errors_1.NotFoundError('Order not found');
    const role = order.buyer_id === userId ? 'buyer' : order.seller_id === userId ? 'seller' : null;
    if (role === null) {
        throw new errors_1.ForbiddenError('You are not part of this order');
    }
    const transition = findTransition(order.status, target);
    if (!transition) {
        throw new errors_1.ValidationError(`Cannot change an order from ${order.status} to ${target}`);
    }
    if (!transition.who.includes(role)) {
        const allowed = transition.who.join(' or ');
        throw new errors_1.ForbiddenError(`Only the ${allowed} can mark an order ${target}`);
    }
    return (0, db_1.withTransaction)(async (client) => {
        // Guarded on the status we read above. If a concurrent request moved the
        // order in the meantime, this matches nothing and we refuse rather than
        // applying a transition from a state that no longer holds.
        const applied = await orderRepository.updateStatus(orderId, order.status, target, client);
        if (!applied) {
            throw new errors_1.ConflictError('This order was just updated by someone else. Try again.');
        }
        if (transition.listingBecomes !== null) {
            await listingRepository.setStatus(order.listing_id, transition.listingBecomes, client);
        }
        const updated = await orderRepository.findByIdWithParties(orderId, client);
        if (!updated)
            throw new Error('Order vanished inside its own transaction');
        return updated;
    });
}
//# sourceMappingURL=orderService.js.map
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
exports.create = create;
exports.listForUser = listForUser;
/**
 * Reviews. The anti-fake-review guarantee is structural, not procedural:
 *
 *   - A review hangs off an ORDER, so you can only review someone you actually
 *     transacted with. The foreign key says so.
 *   - `reviewee_id` is DERIVED from the order, never read from the request. A
 *     caller cannot name who they are reviewing.
 *   - UNIQUE (order_id, reviewer_id) allows one review per person per order.
 *
 * This service adds the one rule the schema cannot see: the order must have
 * actually concluded.
 */
const errors_1 = require("../errors");
const pgErrors_1 = require("../lib/pgErrors");
const orderRepository = __importStar(require("../repositories/orderRepository"));
const reviewRepository = __importStar(require("../repositories/reviewRepository"));
const MAX_BODY_LENGTH = 1000;
/**
 * A refunded order is reviewable. The transaction demonstrably happened and
 * then unwound, and the unwinding is often the very thing worth writing about.
 * Excluding it would also hand a seller an eraser: refund the buyer, delete the
 * bad review.
 */
const REVIEWABLE_STATUSES = ['completed', 'refunded'];
async function create(reviewerId, input) {
    const orderId = Number(input.order_id);
    if (!Number.isInteger(orderId) || orderId < 1) {
        throw new errors_1.ValidationError('order_id must be a positive integer');
    }
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new errors_1.ValidationError('Rating must be a whole number from 1 to 5');
    }
    const body = typeof input.body === 'string' && input.body.trim().length > 0 ? input.body.trim() : null;
    if (body !== null && body.length > MAX_BODY_LENGTH) {
        throw new errors_1.ValidationError(`Review must be ${MAX_BODY_LENGTH} characters or fewer`);
    }
    const order = await orderRepository.findByIdWithParties(orderId);
    if (!order)
        throw new errors_1.NotFoundError('Order not found');
    if (!REVIEWABLE_STATUSES.includes(order.status)) {
        throw new errors_1.ValidationError('You can only review an order once it is completed');
    }
    // The reviewee is whichever party the reviewer is not. Deriving it here is
    // what makes "review someone you never dealt with" unrepresentable.
    let revieweeId;
    if (order.buyer_id === reviewerId) {
        revieweeId = order.seller_id;
    }
    else if (order.seller_id === reviewerId) {
        revieweeId = order.buyer_id;
    }
    else {
        throw new errors_1.ForbiddenError('You were not part of this order');
    }
    try {
        return await reviewRepository.insert(orderId, reviewerId, revieweeId, rating, body);
    }
    catch (error) {
        if ((0, pgErrors_1.isUniqueViolation)(error)) {
            throw new errors_1.ConflictError('You have already reviewed this order');
        }
        throw error;
    }
}
/** Public: reviews written about a user, plus their average. */
async function listForUser(userId) {
    if (!Number.isInteger(userId) || userId < 1) {
        throw new errors_1.ValidationError('user id must be a positive integer');
    }
    return reviewRepository.listForReviewee(userId);
}
//# sourceMappingURL=reviewService.js.map
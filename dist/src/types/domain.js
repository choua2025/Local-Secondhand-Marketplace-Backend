"use strict";
/**
 * Domain types: the shape of a row *after* a repository has mapped it.
 * Raw `pg` rows are untyped objects; nothing outside repositories should ever
 * see one.
 *
 * Note `price` and `amount` are `string`, not `number`. See the comment in
 * db.ts — NUMERIC comes back as a string on purpose so money never touches a
 * binary float.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDER_STATUSES = exports.LISTING_STATUSES = exports.LISTING_CONDITIONS = void 0;
/** The runtime counterparts, for validating untrusted input against the enums. */
exports.LISTING_CONDITIONS = [
    'new',
    'like_new',
    'good',
    'fair',
    'for_parts',
];
exports.LISTING_STATUSES = ['active', 'pending', 'sold', 'removed'];
exports.ORDER_STATUSES = [
    'pending',
    'paid',
    'completed',
    'cancelled',
    'refunded',
];
//# sourceMappingURL=domain.js.map
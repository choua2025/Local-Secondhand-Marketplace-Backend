/**
 * Buying, and the lifecycle of an order.
 *
 * Two rules the schema alone cannot express live here:
 *   1. Exactly one buyer may claim a listing (enforced with a guarded UPDATE,
 *      not a check-then-write).
 *   2. Only certain people may make certain status transitions.
 */
import { withTransaction } from '../db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import * as listingRepository from '../repositories/listingRepository';
import * as orderRepository from '../repositories/orderRepository';
import { ListingStatus, ORDER_STATUSES, OrderStatus } from '../types/domain';
import { OrderRole, OrderSummary, OrderWithParties } from '../types/dto';

/**
 * The legal transitions, as data rather than nested ifs.
 *
 *   pending --pay--------> paid --complete--> completed --refund--> refunded
 *      \                     \
 *       `----cancel----------`----cancel----> cancelled
 *
 * `who` is who may perform the move:
 *   - Only the BUYER pays. Nobody else can claim money changed hands on their behalf.
 *   - Only the SELLER completes. Completing flips the listing to 'sold'; letting
 *     a buyer do it would let them close a sale the seller never agreed happened.
 *   - EITHER may cancel, while the goods have not yet changed hands.
 *   - Only the SELLER refunds, since only they can give the money back.
 *
 * `listingBecomes` is the listing status this transition implies. Cancelling or
 * refunding returns the item to 'active' — without that, a cancelled order would
 * strand the listing at 'pending' forever, unbuyable by anyone. The spec does
 * not mention this; it is a hole, and this is the patch.
 */
interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  who: OrderRole[];
  listingBecomes: ListingStatus | null;
}

const TRANSITIONS: readonly Transition[] = [
  { from: 'pending', to: 'paid', who: ['buyer'], listingBecomes: null },
  { from: 'paid', to: 'completed', who: ['seller'], listingBecomes: 'sold' },
  { from: 'pending', to: 'cancelled', who: ['buyer', 'seller'], listingBecomes: 'active' },
  { from: 'paid', to: 'cancelled', who: ['buyer', 'seller'], listingBecomes: 'active' },
  { from: 'completed', to: 'refunded', who: ['seller'], listingBecomes: 'active' },
];

function findTransition(from: OrderStatus, to: OrderStatus): Transition | undefined {
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
export async function place(buyerId: number, listingId: number): Promise<OrderWithParties> {
  if (!Number.isInteger(listingId) || listingId < 1) {
    throw new ValidationError('listing id must be a positive integer');
  }

  return withTransaction(async (client) => {
    const claimed = await orderRepository.claimListingForPurchase(listingId, client);

    if (!claimed) {
      // Either it never existed, or somebody else got there first. Distinguish
      // the two only for the message — both are terminal for this request.
      const listing = await listingRepository.findOwner(listingId, client);
      if (!listing || listing.status === 'removed') {
        throw new NotFoundError('Listing not found');
      }
      throw new ConflictError('This listing is no longer available');
    }

    if (claimed.seller_id === buyerId) {
      // Rolls back the claim we just made, restoring 'active'.
      throw new ValidationError('You cannot buy your own listing');
    }

    // claimed.price is the snapshot. Reading it from the same UPDATE that
    // claimed the row means no other transaction can have changed it in between.
    return orderRepository.insert(buyerId, listingId, claimed.price, client);
  });
}

export async function listForUser(userId: number): Promise<OrderSummary[]> {
  return orderRepository.listForUser(userId);
}

/**
 * Moves an order along its lifecycle, updating the listing to match.
 *
 * Authorization is a three-part question: are you party to this order at all,
 * is the move legal from where the order currently is, and is it legal *for
 * your role*. All three are answered before anything is written.
 */
export async function updateStatus(
  userId: number,
  orderId: number,
  newStatus: string,
): Promise<OrderWithParties> {
  if (!Number.isInteger(orderId) || orderId < 1) {
    throw new ValidationError('order id must be a positive integer');
  }
  if (!ORDER_STATUSES.includes(newStatus as OrderStatus)) {
    throw new ValidationError(`status must be one of: ${ORDER_STATUSES.join(', ')}`);
  }
  const target = newStatus as OrderStatus;

  const order = await orderRepository.findByIdWithParties(orderId);
  if (!order) throw new NotFoundError('Order not found');

  const role: OrderRole | null =
    order.buyer_id === userId ? 'buyer' : order.seller_id === userId ? 'seller' : null;
  if (role === null) {
    throw new ForbiddenError('You are not part of this order');
  }

  const transition = findTransition(order.status, target);
  if (!transition) {
    throw new ValidationError(`Cannot change an order from ${order.status} to ${target}`);
  }
  if (!transition.who.includes(role)) {
    const allowed = transition.who.join(' or ');
    throw new ForbiddenError(`Only the ${allowed} can mark an order ${target}`);
  }

  return withTransaction(async (client) => {
    // Guarded on the status we read above. If a concurrent request moved the
    // order in the meantime, this matches nothing and we refuse rather than
    // applying a transition from a state that no longer holds.
    const applied = await orderRepository.updateStatus(orderId, order.status, target, client);
    if (!applied) {
      throw new ConflictError('This order was just updated by someone else. Try again.');
    }

    if (transition.listingBecomes !== null) {
      await listingRepository.setStatus(order.listing_id, transition.listingBecomes, client);
    }

    const updated = await orderRepository.findByIdWithParties(orderId, client);
    if (!updated) throw new Error('Order vanished inside its own transaction');
    return updated;
  });
}

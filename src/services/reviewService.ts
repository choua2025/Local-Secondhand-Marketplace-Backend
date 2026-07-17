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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { isUniqueViolation } from '../lib/pgErrors';
import * as orderRepository from '../repositories/orderRepository';
import * as reviewRepository from '../repositories/reviewRepository';
import { OrderStatus } from '../types/domain';
import { CreateReviewInput, ReviewDto, UserReviews } from '../types/dto';

const MAX_BODY_LENGTH = 1000;

/**
 * A refunded order is reviewable. The transaction demonstrably happened and
 * then unwound, and the unwinding is often the very thing worth writing about.
 * Excluding it would also hand a seller an eraser: refund the buyer, delete the
 * bad review.
 */
const REVIEWABLE_STATUSES: readonly OrderStatus[] = ['completed', 'refunded'];

export async function create(reviewerId: number, input: CreateReviewInput): Promise<ReviewDto> {
  const orderId = Number(input.order_id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    throw new ValidationError('order_id must be a positive integer');
  }

  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ValidationError('Rating must be a whole number from 1 to 5');
  }

  const body =
    typeof input.body === 'string' && input.body.trim().length > 0 ? input.body.trim() : null;
  if (body !== null && body.length > MAX_BODY_LENGTH) {
    throw new ValidationError(`Review must be ${MAX_BODY_LENGTH} characters or fewer`);
  }

  const order = await orderRepository.findByIdWithParties(orderId);
  if (!order) throw new NotFoundError('Order not found');

  if (!REVIEWABLE_STATUSES.includes(order.status)) {
    throw new ValidationError('You can only review an order once it is completed');
  }

  // The reviewee is whichever party the reviewer is not. Deriving it here is
  // what makes "review someone you never dealt with" unrepresentable.
  let revieweeId: number;
  if (order.buyer_id === reviewerId) {
    revieweeId = order.seller_id;
  } else if (order.seller_id === reviewerId) {
    revieweeId = order.buyer_id;
  } else {
    throw new ForbiddenError('You were not part of this order');
  }

  try {
    return await reviewRepository.insert(orderId, reviewerId, revieweeId, rating, body);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('You have already reviewed this order');
    }
    throw error;
  }
}

/** Public: reviews written about a user, plus their average. */
export async function listForUser(userId: number): Promise<UserReviews> {
  if (!Number.isInteger(userId) || userId < 1) {
    throw new ValidationError('user id must be a positive integer');
  }
  return reviewRepository.listForReviewee(userId);
}

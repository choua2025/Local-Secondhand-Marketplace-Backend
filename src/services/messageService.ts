/**
 * Messaging between a buyer and a seller about a listing.
 *
 * The schema enforces `sender_id <> recipient_id` and the foreign keys. The two
 * rules it cannot express live here: a message must be attached to a listing,
 * and one of the two parties must be that listing's seller.
 */
import { NotFoundError, ValidationError } from '../errors';
import { isForeignKeyViolation } from '../lib/pgErrors';
import * as listingRepository from '../repositories/listingRepository';
import * as messageRepository from '../repositories/messageRepository';
import { MessageDto, SendMessageInput, ThreadSummary } from '../types/dto';

const MAX_BODY_LENGTH = 2000;

function validateId(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
}

/**
 * A thread is symmetric and scoped to the caller: the repository query has the
 * caller's id on both sides of the OR, so a non-participant asking for someone
 * else's conversation gets an empty array, not their messages. There is no
 * separate permission check because there is no query that could leak.
 */
export async function thread(
  userId: number,
  listingId: number,
  otherUserId: number,
): Promise<MessageDto[]> {
  validateId(listingId, 'listingId');
  validateId(otherUserId, 'otherUserId');
  if (otherUserId === userId) {
    throw new ValidationError('You cannot have a conversation with yourself');
  }
  return messageRepository.thread(userId, listingId, otherUserId);
}

export async function listThreads(userId: number): Promise<ThreadSummary[]> {
  return messageRepository.listThreads(userId);
}

export async function send(senderId: number, input: SendMessageInput): Promise<MessageDto> {
  const listingId = Number(input.listing_id);
  const recipientId = Number(input.recipient_id);
  validateId(listingId, 'listing_id');
  validateId(recipientId, 'recipient_id');

  if (recipientId === senderId) {
    // The DB's CHECK would reject this too, but as an opaque 500. Say why.
    throw new ValidationError('You cannot message yourself');
  }

  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length === 0) {
    throw new ValidationError('Message cannot be empty');
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new ValidationError(`Message must be ${MAX_BODY_LENGTH} characters or fewer`);
  }

  const listing = await listingRepository.findOwner(listingId);
  if (!listing || listing.status === 'removed') {
    throw new NotFoundError('Listing not found');
  }

  /**
   * One party must be the seller. Without this, any user could message any
   * other user by naming a listing neither of them has anything to do with —
   * the listing would just be a pretext for an open messaging channel.
   */
  if (listing.seller_id !== senderId && listing.seller_id !== recipientId) {
    throw new ValidationError('You can only message the seller of this listing');
  }

  try {
    return await messageRepository.insert(senderId, recipientId, listingId, body);
  } catch (error: unknown) {
    // The only remaining foreign key is recipient_id -> users.
    if (isForeignKeyViolation(error)) {
      throw new NotFoundError('That user does not exist');
    }
    throw error;
  }
}

/** Marks the other person's messages in this thread as read. Returns how many. */
export async function markRead(
  userId: number,
  listingId: number,
  otherUserId: number,
): Promise<number> {
  validateId(listingId, 'listing_id');
  validateId(otherUserId, 'other_user_id');
  return messageRepository.markRead(userId, listingId, otherUserId);
}

export async function unreadCount(userId: number): Promise<number> {
  return messageRepository.unreadCount(userId);
}

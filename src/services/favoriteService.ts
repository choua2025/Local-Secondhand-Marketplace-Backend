import { NotFoundError, ValidationError } from '../errors';
import * as favoriteRepository from '../repositories/favoriteRepository';
import * as listingRepository from '../repositories/listingRepository';
import { ListingSummary } from '../types/dto';

function validateListingId(listingId: number): void {
  if (!Number.isInteger(listingId) || listingId < 1) {
    throw new ValidationError('listing id must be a positive integer');
  }
}

export async function list(userId: number): Promise<ListingSummary[]> {
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
export async function add(userId: number, listingId: number): Promise<void> {
  validateListingId(listingId);

  const listing = await listingRepository.findOwner(listingId);
  if (!listing || listing.status === 'removed') {
    throw new NotFoundError('Listing not found');
  }

  await favoriteRepository.add(userId, listingId);
}

/**
 * Unsaves a listing. Idempotent, and deliberately does NOT check the listing
 * exists: letting someone clean up a favorite pointing at a removed listing is
 * strictly better than making them fail at it.
 */
export async function remove(userId: number, listingId: number): Promise<void> {
  validateListingId(listingId);
  await favoriteRepository.remove(userId, listingId);
}

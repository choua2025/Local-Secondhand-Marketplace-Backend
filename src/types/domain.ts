/**
 * Domain types: the shape of a row *after* a repository has mapped it.
 * Raw `pg` rows are untyped objects; nothing outside repositories should ever
 * see one.
 *
 * Note `price` and `amount` are `string`, not `number`. See the comment in
 * db.ts — NUMERIC comes back as a string on purpose so money never touches a
 * binary float.
 */

export type ListingCondition = 'new' | 'like_new' | 'good' | 'fair' | 'for_parts';
export type ListingStatus = 'active' | 'pending' | 'sold' | 'removed';
export type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled' | 'refunded';

/** The runtime counterparts, for validating untrusted input against the enums. */
export const LISTING_CONDITIONS: readonly ListingCondition[] = [
  'new',
  'like_new',
  'good',
  'fair',
  'for_parts',
];
export const LISTING_STATUSES: readonly ListingStatus[] = ['active', 'pending', 'sold', 'removed'];
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'paid',
  'completed',
  'cancelled',
  'refunded',
];

/**
 * A user as stored. `password_hash` is present here and must be stripped before
 * this ever crosses the API boundary — see `PublicUser`.
 */
export interface User {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  phone: string | null;
  city: string | null;
  avatar_url: string | null;
  is_active: boolean;
  /** When they last had a socket open. NULL if never. Drives the presence line. */
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** A user as the outside world sees them. Structurally cannot carry the hash. */
export type PublicUser = Omit<User, 'password_hash'>;

/**
 * One password-reset link. `token_hash` is a SHA-256 of the token that was
 * emailed; the token itself is never stored. `used_at` is NULL until redeemed.
 *
 * This type never crosses the API boundary — there is no DTO for it, because
 * the client has no business knowing a reset row exists.
 */
export interface PasswordResetToken {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  created_at: Date;
}

export interface Listing {
  id: number;
  seller_id: number;
  category_id: number | null;
  title: string;
  description: string | null;
  price: string;
  condition: ListingCondition;
  status: ListingStatus;
  city: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListingImage {
  id: number;
  listing_id: number;
  url: string;
  position: number;
  created_at: Date;
}

export interface Order {
  id: number;
  listing_id: number;
  buyer_id: number;
  amount: string;
  status: OrderStatus;
  created_at: Date;
  completed_at: Date | null;
}

export interface Review {
  id: number;
  order_id: number;
  reviewer_id: number;
  reviewee_id: number;
  rating: number;
  body: string | null;
  created_at: Date;
}

export interface Message {
  id: number;
  listing_id: number | null;
  sender_id: number;
  recipient_id: number;
  body: string;
  is_read: boolean;
  created_at: Date;
}

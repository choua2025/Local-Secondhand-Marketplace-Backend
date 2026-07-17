/**
 * DTOs — the shapes that cross the API boundary.
 *
 * These are deliberately *not* the domain types. A `User` row carries a
 * password_hash; a `SellerSummary` cannot. Keeping them separate means a
 * careless `res.json(user)` can't leak a hash, because the type system won't
 * let the row get that far.
 *
 * `Date` fields serialize to ISO-8601 strings over JSON, so the client's
 * mirrored types declare them as `string`. That asymmetry is expected.
 */
import { ListingCondition, ListingStatus, OrderStatus, PublicUser } from './domain';

/** Which side of an order the current user is on. */
export type OrderRole = 'buyer' | 'seller';

/** One row in the dashboard's Orders tab. */
export interface OrderSummary {
  id: number;
  listing_id: number;
  listing_title: string;
  listing_cover_url: string | null;
  /** The price snapshot taken when the order was placed, not the listing's price now. */
  amount: string;
  status: OrderStatus;
  created_at: Date;
  completed_at: Date | null;
  /** 'buyer' if you bought it, 'seller' if you sold it. */
  role: OrderRole;
  /** The other party's display name. */
  counterparty_name: string;
  /** Whether the caller has already left their one review for this order. */
  reviewed_by_me: boolean;
}

/** An order plus the identities needed to authorize a status change. */
export interface OrderWithParties {
  id: number;
  listing_id: number;
  buyer_id: number;
  seller_id: number;
  amount: string;
  status: OrderStatus;
  created_at: Date;
  completed_at: Date | null;
}

export interface RegisterInput {
  email: string;
  password: string;
  display_name: string;
  city: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  /** The opaque token from the emailed link, not a JWT. */
  token: string;
  password: string;
}

/**
 * What register and login both return. `user` is a PublicUser, so the type
 * system makes it impossible to hand back a password_hash by accident.
 *
 * Note that resetting a password returns nothing at all. Handing back a session
 * would sign in whoever holds the link; making them log in with the password
 * they just chose proves they know it.
 */
export interface AuthResponse {
  user: PublicUser;
  token: string;
}

/** The seller as shown on a card or a detail page. No email, no hash. */
export interface SellerSummary {
  id: number;
  display_name: string;
  avatar_url: string | null;
  city: string | null;
  /** null when the seller has never been reviewed. */
  rating_average: number | null;
  rating_count: number;
}

export interface CategorySummary {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
}

/** One card in the browse grid. */
export interface ListingSummary {
  id: number;
  title: string;
  price: string;
  condition: ListingCondition;
  city: string | null;
  created_at: Date;
  cover_image_url: string | null;
  seller: SellerSummary;
}

/** The full listing page: every image, the whole seller, the category. */
export interface ListingDetail {
  id: number;
  title: string;
  description: string | null;
  price: string;
  condition: ListingCondition;
  status: ListingStatus;
  city: string | null;
  created_at: Date;
  updated_at: Date;
  /** How many times the listing page has been opened. Owner's own opens excluded. */
  view_count: number;
  images: ListingImageDto[];
  seller: SellerSummary;
  category: CategorySummary | null;
}

export interface ListingImageDto {
  id: number;
  url: string;
  position: number;
}

/**
 * `price` is a decimal string, never a number. It is validated against a regex
 * and handed to Postgres as-is, so no float ever touches money on the way in.
 */
export interface CreateListingInput {
  title: string;
  description: string | null;
  price: string;
  condition: ListingCondition;
  category_id: number | null;
  image_urls: string[];
}

/** Every field optional: PATCH applies only what was sent. */
export interface UpdateListingInput {
  title?: string;
  description?: string | null;
  price?: string;
  condition?: ListingCondition;
  category_id?: number | null;
  /**
   * The gallery, entire and in order — the first is the cover. Omitting this
   * leaves the photos untouched; sending `[]` removes them all. Any Cloudinary
   * image dropped from the list is deleted from storage.
   */
  image_urls?: string[];
}

/**
 * A user editing their own profile. `email` is absent by design: changing it
 * is an identity change, needing confirmation at the new address before the old
 * one stops working, and that is a slice of its own.
 *
 * Every field is optional and `null` means "clear it" for the nullable columns.
 */
export interface UpdateProfileInput {
  display_name?: string;
  city?: string | null;
  phone?: string | null;
  /** A Cloudinary URL, or null to fall back to the default avatar. */
  avatar_url?: string | null;
}

/**
 * A seller's own listing. Unlike ListingSummary this carries `status`, because
 * the dashboard must show sold and pending items that browse would never return.
 */
export interface OwnListing {
  id: number;
  title: string;
  price: string;
  condition: ListingCondition;
  status: ListingStatus;
  city: string | null;
  created_at: Date;
  view_count: number;
  cover_image_url: string | null;
}

export interface CreateReviewInput {
  order_id: number;
  rating: number;
  body: string | null;
}

/** A review as shown on someone's profile. Carries the reviewer, not the reviewee. */
export interface ReviewDto {
  id: number;
  order_id: number;
  reviewer_id: number;
  reviewer_name: string;
  reviewer_avatar_url: string | null;
  rating: number;
  body: string | null;
  created_at: Date;
}

export interface UserReviews {
  reviews: ReviewDto[];
  /** null when the user has never been reviewed — not 0, which would read as "terrible". */
  average: number | null;
  count: number;
}

/** One message in a thread. */
export interface MessageDto {
  id: number;
  listing_id: number;
  sender_id: number;
  recipient_id: number;
  body: string;
  is_read: boolean;
  created_at: Date;
}

/**
 * A conversation, keyed by (listing_id, other_user_id).
 *
 * `messages.listing_id` is nullable in the schema, but the service requires one
 * on every message — every entry point to messaging is a listing page, and a
 * listing-less inbox would need a second thread key with nothing to show for it.
 */
export interface ThreadSummary {
  listing_id: number;
  listing_title: string;
  listing_cover_url: string | null;
  other_user_id: number;
  other_user_name: string;
  other_user_avatar_url: string | null;
  last_message_body: string;
  last_message_at: Date;
  /** True when the last message in the thread was sent by the current user. */
  last_message_mine: boolean;
  /** Unread messages *from the other person* — never your own. */
  unread_count: number;
}

export interface SendMessageInput {
  recipient_id: number;
  listing_id: number;
  body: string;
}

/** Parsed, validated query params for GET /api/listings. */
export interface BrowseQuery {
  city?: string;
  /** A category *slug*. Matches that category and every descendant of it. */
  category?: string;
  /** Free-text, matched case-insensitively against the title. */
  q?: string;
  page: number;
}

export interface BrowseResult {
  items: ListingSummary[];
  page: number;
  hasMore: boolean;
}

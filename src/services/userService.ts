/**
 * A user editing their own profile.
 *
 * Nothing here takes a "which user" argument that a client controls — every
 * function acts on the id the auth middleware recovered from the token. There
 * is no PATCH /api/users/:id, so there is no route through which one person
 * could reach another's row, and no ownership check to forget.
 */
import { NotFoundError, ValidationError } from '../errors';
import { destroyAsset, publicIdFromUrl } from '../lib/cloudinary';
import * as userRepository from '../repositories/userRepository';
import type { UpdateProfileFields } from '../repositories/userRepository';
import { PublicUser } from '../types/domain';
import { UpdateProfileInput } from '../types/dto';

const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_CITY_LENGTH = 80;
const MAX_PHONE_LENGTH = 32;

/**
 * Deliberately loose. Phone numbers are formatted a dozen ways across the world
 * — "+1 (503) 555-0100", "07700 900123" — and a regex strict enough to be
 * useful rejects somebody's real number. This checks the characters are
 * plausible and lets a human read the rest.
 */
const PHONE_PATTERN = /^[\d\s+()./-]+$/;

function validateId(id: number): void {
  if (!Number.isInteger(id) || id < 1) {
    throw new ValidationError('user id must be a positive integer');
  }
}

/** Trims, then maps "" to null. An empty text box means "clear this field". */
function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = optionalText(value, field, maxLength);
  if (text === null) throw new ValidationError(`${field} is required`);
  return text;
}

/**
 * Validates an avatar URL and pairs it with the Cloudinary id we would need to
 * delete it later. Returns nulls for "clear the avatar".
 *
 * The http(s) check is the same stored-XSS guard listings use: an avatar is
 * rendered into an <img src>, and a `javascript:` URL there executes.
 */
function describeAvatar(value: unknown): { url: string | null; public_id: string | null } {
  if (value === null) return { url: null, public_id: null };
  if (typeof value !== 'string') {
    throw new ValidationError('avatar_url must be a string or null');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return { url: null, public_id: null };
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ValidationError('avatar_url must start with http:// or https://');
  }
  return { url: trimmed, public_id: publicIdFromUrl(trimmed) };
}

/** The caller's own profile. */
export async function getProfile(userId: number): Promise<PublicUser> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('Account no longer exists');
  return user;
}

/**
 * When a user was last online, for the presence line in chat. Throws if there
 * is no such user. Whether they are online *right now* is a live fact the hub
 * holds, not the database — the controller combines the two.
 */
export async function getUserLastSeen(userId: number): Promise<Date | null> {
  validateId(userId);
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  return user.last_seen_at;
}

/**
 * Updates the caller's profile, one field at a time or all at once.
 *
 * PATCH semantics: a key the client omitted is untouched. For the nullable
 * columns, an explicit `null` — or an empty string, which is what an emptied
 * text box actually sends — clears the field. `display_name` is the exception:
 * it is NOT NULL in the schema and every listing and message shows it, so
 * clearing it is rejected rather than quietly writing "".
 *
 * When the avatar changes, the old Cloudinary asset is destroyed after the row
 * is written. The ordering matters and is the same reasoning as in
 * listingService.update: a destroy that runs first and a write that then fails
 * leaves a profile pointing at an image that no longer exists. Doing it second
 * means the worst case is an orphaned file.
 */
export async function updateProfile(
  userId: number,
  input: UpdateProfileInput,
): Promise<PublicUser> {
  const fields: UpdateProfileFields = {};

  if (input.display_name !== undefined) {
    fields.display_name = requiredText(input.display_name, 'display_name', MAX_DISPLAY_NAME_LENGTH);
  }
  if (input.city !== undefined) {
    fields.city = optionalText(input.city, 'city', MAX_CITY_LENGTH);
  }
  if (input.phone !== undefined) {
    const phone = optionalText(input.phone, 'phone', MAX_PHONE_LENGTH);
    if (phone !== null && !PHONE_PATTERN.test(phone)) {
      throw new ValidationError('phone may only contain digits, spaces and + ( ) . / -');
    }
    fields.phone = phone;
  }

  /**
   * The avatar the user is replacing, captured *before* the write. Read it now
   * or lose it: the UPDATE overwrites the column that names it, and the file
   * would then sit in Cloudinary with nothing pointing at it.
   */
  let previousAvatarId: string | null = null;

  if (input.avatar_url !== undefined) {
    const avatar = describeAvatar(input.avatar_url);
    previousAvatarId = await userRepository.findAvatarPublicId(userId);

    fields.avatar_url = avatar.url;
    fields.avatar_public_id = avatar.public_id;

    // Re-saving the same avatar must not delete it. This happens whenever a
    // form PATCHes every field back, avatar included, after editing only a city.
    if (previousAvatarId !== null && previousAvatarId === avatar.public_id) {
      previousAvatarId = null;
    }
  }

  const updated = await userRepository.updateProfile(userId, fields);

  // Best-effort, and only for assets we uploaded — publicIdFromUrl returns null
  // for anything outside our own cloud, so a pasted external avatar survives.
  if (previousAvatarId !== null) {
    await destroyAsset(previousAvatarId);
  }

  return updated;
}

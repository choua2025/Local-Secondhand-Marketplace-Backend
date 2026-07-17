/**
 * Everything that knows Cloudinary exists.
 *
 * The shape of the integration, and why:
 *
 * The browser uploads image bytes straight to Cloudinary. They never pass
 * through this server. What this server does instead is *sign* the upload —
 * it takes the parameters the browser wants to use, hashes them together with
 * the API secret, and hands back the signature. Cloudinary then accepts that
 * one upload and no other.
 *
 * CLOUDINARY_API_SECRET therefore never leaves this process. The alternative
 * — an unsigned "upload preset" — would mean anyone who read the page source
 * could upload anything to the account, forever.
 */
import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';
import { ValidationError } from '../errors';

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

/**
 * Uploads are configured lazily rather than at boot, unlike JWT_SECRET.
 *
 * A missing JWT secret is fatal — nobody can log in, and a server that pretends
 * otherwise is worse than one that refuses to start. A missing Cloudinary
 * config only means uploads are unavailable; browse, search, orders and
 * messages all still work. So the app boots, and only the upload endpoint 503s.
 */
export function isCloudinaryConfigured(): boolean {
  return Boolean(CLOUD_NAME && API_KEY && API_SECRET);
}

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: CLOUD_NAME as string,
    api_key: API_KEY as string,
    api_secret: API_SECRET as string,
    // Always https. A Cloudinary URL served over http on an https page is a
    // mixed-content warning at best and a stripped image at worst.
    secure: true,
  });
}

/**
 * The only folders a signature will ever be issued for.
 *
 * The folder is part of what gets signed, so a client cannot ask for one
 * signature and then upload somewhere else. But it *chooses* the folder from
 * this list, and an unchecked folder string would let it write to any path in
 * the account — including over the top of somebody else's tree.
 */
export const UPLOAD_FOLDERS = ['listings', 'avatars'] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export function isUploadFolder(value: unknown): value is UploadFolder {
  return typeof value === 'string' && (UPLOAD_FOLDERS as readonly string[]).includes(value);
}

/** How long a signature is good for. Cloudinary rejects a stale timestamp itself. */
export const SIGNATURE_TTL_SECONDS = 60 * 10;

export interface UploadSignature {
  signature: string;
  /** Unix seconds. Must be sent back to Cloudinary verbatim or the hash won't match. */
  timestamp: number;
  api_key: string;
  cloud_name: string;
  folder: UploadFolder;
}

/**
 * Signs one upload into one folder.
 *
 * Only `folder` and `timestamp` are signed. Everything Cloudinary lets the
 * client set that we care about is in there; anything else it sends (the file
 * itself, its filename) cannot be constrained by a signature anyway, which is
 * why the size and type limits are enforced in the browser *and* re-checked
 * against the URL we get back.
 */
export function signUpload(folder: UploadFolder): UploadSignature {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured. See CLOUDINARY_* in server/.env.example.');
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // The SDK sorts the params, joins them, appends the secret and takes a SHA-1
  // — the exact recipe Cloudinary verifies against. Hand-rolling it is a
  // reliable way to spend an afternoon on an "Invalid Signature" error.
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    API_SECRET as string,
  );

  return {
    signature,
    timestamp,
    api_key: API_KEY as string,
    cloud_name: CLOUD_NAME as string,
    folder,
  };
}

/**
 * Recovers the public_id from a delivery URL, or null if the URL is not an
 * image we uploaded to our own cloud.
 *
 * This function is a security boundary, not a convenience.
 *
 * The obvious design is for the browser to upload, receive a public_id, and
 * send it to us to store. But then the public_id is client-controlled, and a
 * malicious client could hand us somebody else's — at which point our own
 * cleanup code cheerfully deletes a stranger's image. Deriving it from the URL
 * means the only ids we ever act on are ones we can prove point into our cloud.
 *
 * A URL looks like:
 *   https://res.cloudinary.com/<cloud>/image/upload/<transforms…>/v<version>/<public_id>.<ext>
 * where the transforms and the version are both optional. `public_id` may
 * itself contain slashes ("listings/abc123"), which is why it is reassembled
 * from every remaining segment rather than just the last one.
 */
export function publicIdFromUrl(url: string): string | null {
  if (!isCloudinaryConfigured()) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Our cloud, over https, on Cloudinary's delivery host. Anything else is an
  // image we do not own and must never destroy.
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments[0] !== CLOUD_NAME) return null;
  if (segments[1] !== 'image' || segments[2] !== 'upload') return null;

  let rest = segments.slice(3);
  if (rest.length === 0) return null;

  // Drop transformation segments, which sit between `upload` and the version.
  // The version marks where the public_id begins: v followed by digits.
  const versionAt = rest.findIndex((segment) => /^v\d+$/.test(segment));
  if (versionAt !== -1) rest = rest.slice(versionAt + 1);

  if (rest.length === 0) return null;

  const path = rest.join('/');

  // Strip the extension from the final segment only — a folder name may contain
  // a dot, and "my.photos/cat.jpg" must yield "my.photos/cat".
  const lastDot = path.lastIndexOf('.');
  const lastSlash = path.lastIndexOf('/');
  const publicId = lastDot > lastSlash ? path.slice(0, lastDot) : path;

  return publicId.length > 0 ? publicId : null;
}

/**
 * Deletes an asset, best-effort.
 *
 * Never throws. A failed destroy leaves one orphaned file in Cloudinary — a
 * cost, and an annoyance. Letting it throw would fail the user's request *after*
 * their database change already committed, telling them their edit did not save
 * when it did. The database is the source of truth; the storage bucket catches
 * up, or it does not.
 */
export async function destroyAsset(publicId: string): Promise<void> {
  if (!isCloudinaryConfigured()) return;

  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (error: unknown) {
    console.error(`[cloudinary] Failed to destroy ${publicId}:`, error);
  }
}

/** Destroys many assets concurrently, skipping the ones that are not ours. */
export async function destroyAssets(publicIds: ReadonlyArray<string | null>): Promise<void> {
  const ours = publicIds.filter((id): id is string => id !== null && id.length > 0);
  await Promise.all(ours.map(destroyAsset));
}

/**
 * Validates an image URL that is about to be stored, and pairs it with the
 * public_id we will need to delete it later (null when it is not ours).
 *
 * The http(s) check is the stored-XSS guard that has always been here: a
 * `javascript:` or `data:` URL rendered into an <img src> executes.
 */
export function describeImageUrl(url: unknown): { url: string; public_id: string | null } {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new ValidationError('Each image URL must be a non-empty string');
  }
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ValidationError('Image URLs must start with http:// or https://');
  }
  return { url: trimmed, public_id: publicIdFromUrl(trimmed) };
}

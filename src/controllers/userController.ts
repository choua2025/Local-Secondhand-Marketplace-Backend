import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { requireUserId } from '../middleware/auth';
import { isOnline } from '../realtime/hub';
import * as userService from '../services/userService';
import { UpdateProfileInput } from '../types/dto';

/** The fields a profile PATCH may carry. Anything else in the body is ignored. */
const PATCHABLE = ['display_name', 'city', 'phone', 'avatar_url'] as const;

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export async function getMe(req: Request, res: Response): Promise<void> {
  res.json(await userService.getProfile(requireUserId(req)));
}

/**
 * GET /api/users/:id/presence — is this person online, and when were they last?
 *
 * Public, like the reviews on the same router: it powers the "Active now / Last
 * seen" line in a conversation, and a buyer can open a thread with a seller
 * before either has logged the other in. `online` is the hub's live in-memory
 * truth; `last_seen_at` is the database's record of the last disconnect.
 */
export async function presence(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    throw new ValidationError('user id must be an integer');
  }
  const lastSeenAt = await userService.getUserLastSeen(id);
  res.json({ online: isOnline(id), last_seen_at: lastSeenAt });
}

/**
 * Copies across only the keys the client actually sent.
 *
 * `'city' in body` rather than `body.city !== undefined`, because the two mean
 * different things to a PATCH: an absent key leaves the city alone, while
 * `{"city": null}` clears it. Reading with `!==  undefined` would collapse them
 * and make "clear my city" impossible to express.
 *
 * The values themselves go through untouched — the service validates. The
 * controller's only job is to say which fields were present.
 */
export async function updateMe(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);

  const input: UpdateProfileInput = {};
  for (const key of PATCHABLE) {
    if (key in body) {
      (input as Record<string, unknown>)[key] = body[key];
    }
  }

  res.json(await userService.updateProfile(requireUserId(req), input));
}

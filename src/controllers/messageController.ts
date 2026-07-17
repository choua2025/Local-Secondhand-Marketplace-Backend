import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { requireUserId } from '../middleware/auth';
import { notifyMessagesRead, notifyNewMessage } from '../realtime/hub';
import * as messageService from '../services/messageService';

function readNumericQuery(value: unknown, name: string): number {
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} is required`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`${name} must be an integer`);
  }
  return parsed;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** GET /api/messages?listingId=&otherUserId= */
export async function thread(req: Request, res: Response): Promise<void> {
  const listingId = readNumericQuery(req.query.listingId, 'listingId');
  const otherUserId = readNumericQuery(req.query.otherUserId, 'otherUserId');
  res.json(await messageService.thread(requireUserId(req), listingId, otherUserId));
}

/** GET /api/messages/threads */
export async function listThreads(req: Request, res: Response): Promise<void> {
  res.json(await messageService.listThreads(requireUserId(req)));
}

/** GET /api/messages/unread-count */
export async function unreadCount(req: Request, res: Response): Promise<void> {
  res.json({ count: await messageService.unreadCount(requireUserId(req)) });
}

/** POST /api/messages */
export async function send(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);
  const message = await messageService.send(requireUserId(req), {
    recipient_id: Number(body['recipient_id']),
    listing_id: Number(body['listing_id']),
    body: typeof body['body'] === 'string' ? body['body'] : '',
  });

  // Realtime delivery lives here, in the HTTP adapter, not in messageService —
  // the service is transport-agnostic by design and must not know a socket
  // exists. Only after the message is safely persisted do we push it to any
  // connected sockets for the two participants. A no-op when nobody is online,
  // and never in the test suite, which runs the app without a socket server.
  notifyNewMessage(message);

  res.status(201).json(message);
}

/** POST /api/messages/read */
export async function markRead(req: Request, res: Response): Promise<void> {
  const readerId = requireUserId(req);
  const body = asObject(req.body);
  const listingId = Number(body['listing_id']);
  const otherUserId = Number(body['other_user_id']);

  const updated = await messageService.markRead(readerId, listingId, otherUserId);

  // Only tell the sender if something actually changed. otherUserId is exactly
  // whose messages were marked read — they are the sender, and the one whose
  // read receipts turn blue. A no-op when they are offline.
  if (updated > 0) {
    notifyMessagesRead(readerId, listingId, otherUserId);
  }

  res.json({ marked_read: updated });
}

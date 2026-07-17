/**
 * HTTP concerns only: read params/query, call the service, shape the response.
 * No SQL, no business rules. Errors thrown by the service propagate to the
 * error middleware — Express 5 forwards async rejections automatically.
 */
import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { requireUserId } from '../middleware/auth';
import * as listingService from '../services/listingService';
import { BrowseQuery, CreateListingInput, UpdateListingInput } from '../types/dto';

/**
 * Express types a query value as `string | string[] | ParsedQs | ParsedQs[]`,
 * because `?city=a&city=b` is legal. We accept only a single string and treat
 * a repeated or nested param as a bad request rather than silently using the
 * first one.
 */
function readSingleString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a single value`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPage(value: unknown): number {
  const raw = readSingleString(value, 'page');
  if (raw === undefined) return 1;

  // Number() rather than parseInt(): parseInt('2abc') is 2, which would let a
  // malformed page number through instead of rejecting it.
  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError('page must be a positive integer');
  }
  return page;
}

export async function browse(req: Request, res: Response): Promise<void> {
  const city = readSingleString(req.query.city, 'city');
  const category = readSingleString(req.query.category, 'category');
  const q = readSingleString(req.query.q, 'q');

  // Built by spreading rather than assigning `undefined`, because
  // exactOptionalPropertyTypes distinguishes "absent" from "present and undefined".
  const query: BrowseQuery = {
    page: readPage(req.query.page),
    ...(city !== undefined && { city }),
    ...(category !== undefined && { category }),
    ...(q !== undefined && { q }),
  };

  res.json(await listingService.browse(query));
}

export async function cities(_req: Request, res: Response): Promise<void> {
  res.json(await listingService.cities());
}

export async function getById(req: Request, res: Response): Promise<void> {
  res.json(await listingService.getById(readId(req)));
}

/** Shared by the three routes that address one listing by id. */
function readId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    throw new ValidationError('listing id must be an integer');
  }
  return id;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export async function listMine(req: Request, res: Response): Promise<void> {
  res.json(await listingService.listMine(requireUserId(req)));
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);

  // Pass the raw values through; the service is what validates them. The
  // controller's only job is to say "this is the shape of the input I found".
  const input = {
    title: body['title'],
    description: body['description'] ?? null,
    price: body['price'],
    condition: body['condition'],
    category_id: body['category_id'] ?? null,
    image_urls: body['image_urls'] ?? [],
  } as CreateListingInput;

  const created = await listingService.create(requireUserId(req), input);
  res.status(201).json(created);
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = asObject(req.body);

  // Only copy keys the client actually sent. Spreading `undefined` in would
  // make the service think a field was cleared rather than left alone.
  //
  // `image_urls` included: sending it replaces the gallery in order, and the
  // photos it drops are deleted from Cloudinary. Omitting it leaves them be.
  const fields: UpdateListingInput = {};
  const patchable = ['title', 'description', 'price', 'condition', 'category_id', 'image_urls'] as const;
  for (const key of patchable) {
    if (key in body) {
      (fields as Record<string, unknown>)[key] = body[key];
    }
  }

  res.json(await listingService.update(requireUserId(req), readId(req), fields));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await listingService.remove(requireUserId(req), readId(req));
  // 204: succeeded, and there is deliberately no body to send back.
  res.status(204).end();
}

/**
 * POST /api/listings/:id/view — records that this page was opened.
 *
 * Mounted with `attachUser`, not `requireAuth`: a logged-out visitor's view
 * counts too, so a token is optional here. `req.userId` is whoever the token
 * named, or undefined; the service uses it only to skip the owner's own views.
 */
export async function registerView(req: Request, res: Response): Promise<void> {
  const viewCount = await listingService.registerView(readId(req), req.userId ?? null);
  res.json({ view_count: viewCount });
}

import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { requireUserId } from '../middleware/auth';
import * as reviewService from '../services/reviewService';

export async function create(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const fields = body as Record<string, unknown>;

  // Note there is no reviewee_id here, and no way to supply one. The service
  // derives it from the order.
  const review = await reviewService.create(requireUserId(req), {
    order_id: Number(fields['order_id']),
    rating: Number(fields['rating']),
    body: typeof fields['body'] === 'string' ? fields['body'] : null,
  });

  res.status(201).json(review);
}

/** Public: GET /api/users/:id/reviews */
export async function listForUser(req: Request, res: Response): Promise<void> {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    throw new ValidationError('user id must be an integer');
  }
  res.json(await reviewService.listForUser(userId));
}

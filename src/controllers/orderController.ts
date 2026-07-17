import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { requireUserId } from '../middleware/auth';
import * as orderService from '../services/orderService';

export async function place(req: Request, res: Response): Promise<void> {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const listingId = Number((body as Record<string, unknown>)['listing_id']);
  if (!Number.isInteger(listingId)) {
    throw new ValidationError('listing_id is required and must be an integer');
  }

  const order = await orderService.place(requireUserId(req), listingId);
  res.status(201).json(order);
}

export async function listForUser(req: Request, res: Response): Promise<void> {
  res.json(await orderService.listForUser(requireUserId(req)));
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId)) {
    throw new ValidationError('order id must be an integer');
  }

  const body: unknown = req.body;
  const status = (body as Record<string, unknown> | null)?.['status'];
  if (typeof status !== 'string') {
    throw new ValidationError('status is required');
  }

  res.json(await orderService.updateStatus(requireUserId(req), orderId, status));
}

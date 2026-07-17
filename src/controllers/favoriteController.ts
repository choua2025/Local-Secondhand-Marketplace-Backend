import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { requireUserId } from '../middleware/auth';
import * as favoriteService from '../services/favoriteService';

function readListingId(req: Request): number {
  const listingId = Number(req.params.listingId);
  if (!Number.isInteger(listingId)) {
    throw new ValidationError('listing id must be an integer');
  }
  return listingId;
}

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await favoriteService.list(requireUserId(req)));
}

export async function add(req: Request, res: Response): Promise<void> {
  await favoriteService.add(requireUserId(req), readListingId(req));
  res.status(204).end();
}

export async function remove(req: Request, res: Response): Promise<void> {
  await favoriteService.remove(requireUserId(req), readListingId(req));
  res.status(204).end();
}

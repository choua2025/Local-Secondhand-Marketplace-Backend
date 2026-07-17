import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { requireUserId } from '../middleware/auth';
import * as authService from '../services/authService';

/**
 * `req.body` is `any` — it is whatever JSON the client sent. Coercing each
 * field to a string here means the service can trust its input types, and a
 * client sending `{ password: 12345678 }` gets a 400 rather than a 500 from
 * `password.length` on a number.
 */
function readString(body: unknown, field: string): string {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} is required`);
  }
  return value;
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register({
    email: readString(req.body, 'email'),
    password: readString(req.body, 'password'),
    display_name: readString(req.body, 'display_name'),
    city: readString(req.body, 'city'),
  });

  // 201: a new resource exists as a result of this request.
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login({
    email: readString(req.body, 'email'),
    password: readString(req.body, 'password'),
  });
  res.json(result);
}

/** Turns a stored token back into a user, so a reload can restore the session. */
export async function me(req: Request, res: Response): Promise<void> {
  res.json(await authService.currentUser(requireUserId(req)));
}

/**
 * 202 Accepted, always — "we have taken your request; we are not telling you
 * what came of it". A 200 would suggest we found the account and a 404 would
 * confirm we did not. The service is equally silent; see requestPasswordReset.
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  await authService.requestPasswordReset({ email: readString(req.body, 'email') });
  res.status(202).json({
    message: 'If an account exists for that address, a reset link is on its way.',
  });
}

/** 204: the password changed, and there is nothing to hand back. */
export async function resetPassword(req: Request, res: Response): Promise<void> {
  await authService.resetPassword({
    token: readString(req.body, 'token'),
    password: readString(req.body, 'password'),
  });
  res.status(204).end();
}

import { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors';

/**
 * The one and only error middleware. Express identifies it by its four-argument
 * signature, so `next` must stay in the parameter list even though it is unused.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * which is why there is no `asyncHandler` wrapper anywhere in this codebase.
 * (Under Express 4 you would have needed one: an async controller that rejected
 * would have hung the request instead of reaching this function.)
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Anything unrecognised is a bug on our side. Log the real thing for us,
  // return something opaque to the client — stack traces and driver messages
  // are an information leak.
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
};

/** 404 for URLs no router claimed. Mounted after all routers, before errorHandler. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

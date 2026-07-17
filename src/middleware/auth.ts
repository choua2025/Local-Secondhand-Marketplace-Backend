import { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthorizedError } from '../errors';
import { verifyToken } from '../lib/token';

/**
 * Pulls the bearer token out of `Authorization: Bearer <token>` and sets
 * req.userId. Rejects with 401 when the header is missing, malformed, or the
 * token does not verify.
 *
 * Note this only proves *who* the caller is (authentication). Whether they may
 * touch a particular listing or order is a question for the service layer
 * (authorization), which is the only place that knows who owns what.
 */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authentication required');
  }

  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    throw new UnauthorizedError('Authentication required');
  }

  // verifyToken throws UnauthorizedError itself; letting it propagate keeps the
  // "one place decides what a bad token means" rule.
  req.userId = verifyToken(token);
  next();
};

/**
 * Sets req.userId IF a valid token is present, and otherwise does nothing.
 *
 * For routes that are public but behave differently for a known caller — here,
 * counting a listing view but not the owner's own. A missing token is the normal
 * case, not an error, so it never rejects; and a malformed or expired token is
 * treated as "anonymous" rather than a 401, because a stale token in someone's
 * tab should not stop a page from counting its view.
 */
export const attachUser: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token.length > 0) {
      try {
        req.userId = verifyToken(token);
      } catch {
        // Ignore: an unverifiable token just means we treat this as anonymous.
      }
    }
  }
  next();
};

/**
 * A controller on a `requireAuth` route knows userId is set, but the type says
 * `number | undefined`. This narrows it in one place instead of every handler
 * writing a non-null assertion, which would silently lie if the route were ever
 * mounted without the middleware.
 */
export function requireUserId(req: Request): number {
  const { userId } = req;
  if (userId === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return userId;
}

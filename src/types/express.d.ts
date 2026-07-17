/**
 * Teaches TypeScript that our auth middleware puts a userId on the request.
 *
 * It is optional (`?`) on purpose: on a public route nothing has set it, and a
 * required field would let a controller read `req.userId` on an unguarded route
 * and get `undefined` while the types insisted it was a number.
 */
declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export {};

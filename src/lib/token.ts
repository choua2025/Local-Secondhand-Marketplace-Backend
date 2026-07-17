import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../errors';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail at boot, not at the first login. A server running with an unset secret
  // would either crash on sign or — worse, if we defaulted one — issue tokens
  // that anyone who read the source could forge.
  throw new Error('JWT_SECRET is not set. See server/.env.example.');
}

const EXPIRES_IN = '7d';

/**
 * `sub` (subject) is the registered JWT claim for "who this token is about".
 * It is a string by spec, so the user id round-trips through String/Number.
 */
export function signToken(userId: number): string {
  return jwt.sign({}, JWT_SECRET as string, {
    subject: String(userId),
    expiresIn: EXPIRES_IN,
  });
}

/**
 * Returns the user id, or throws UnauthorizedError for anything wrong —
 * expired, wrong signature, malformed, missing subject. The caller never has to
 * distinguish; all of them mean "not authenticated".
 */
export function verifyToken(token: string): number {
  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(token, JWT_SECRET as string);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  if (typeof payload === 'string' || payload.sub === undefined) {
    throw new UnauthorizedError('Invalid token payload');
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId < 1) {
    throw new UnauthorizedError('Invalid token subject');
  }
  return userId;
}

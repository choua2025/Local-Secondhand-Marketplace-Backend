import { compare, hash } from 'bcryptjs';

/**
 * Cost 10 means 2^10 key-derivation rounds. It is the standard default: high
 * enough that a leaked hash is expensive to crack, low enough that a login
 * costs a few tens of milliseconds rather than a second.
 */
const BCRYPT_COST = 10;

/**
 * A valid bcrypt hash of a value nobody will ever submit. Used to burn the same
 * ~50ms of CPU when an email does not exist as when it does — otherwise a fast
 * "no such user" response is an oracle that tells an attacker which addresses
 * are registered. See verifyPassword's use in authService.login.
 */
export const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, BCRYPT_COST);
}

export function verifyPassword(plaintext: string, passwordHash: string): Promise<boolean> {
  return compare(plaintext, passwordHash);
}

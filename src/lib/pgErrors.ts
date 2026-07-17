/**
 * Postgres reports constraint failures with SQLSTATE codes. Letting the
 * database enforce a rule and translating its complaint is race-free; checking
 * first and writing second leaves a window where another transaction changes
 * the answer in between.
 *
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** A UNIQUE index rejected the row (duplicate email, second review on an order). */
export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === UNIQUE_VIOLATION;
}

/** A REFERENCES column pointed at a row that does not exist. */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === FOREIGN_KEY_VIOLATION;
}

/** A CHECK constraint rejected the row (rating out of range, negative price). */
export function isCheckViolation(error: unknown): boolean {
  return errorCode(error) === CHECK_VIOLATION;
}

/**
 * Typed errors that services throw. Each one carries the HTTP status it should
 * become, but nothing here imports Express — a service must be usable from a
 * script, a test, or a queue worker with no request in sight. The single error
 * middleware is what translates these into responses.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400 — the request was understood but the data is not acceptable. */
export class ValidationError extends AppError {
  readonly status = 400;
}

/** 401 — no valid credentials. Also used for a wrong password. */
export class UnauthorizedError extends AppError {
  readonly status = 401;
}

/** 403 — authenticated, but not allowed to touch this particular resource. */
export class ForbiddenError extends AppError {
  readonly status = 403;
}

/** 404 — no such resource (or one the caller must not know exists). */
export class NotFoundError extends AppError {
  readonly status = 404;
}

/** 409 — the request conflicts with current state (duplicate email, item already sold). */
export class ConflictError extends AppError {
  readonly status = 409;
}

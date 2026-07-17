"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictError = exports.NotFoundError = exports.ForbiddenError = exports.UnauthorizedError = exports.ValidationError = exports.AppError = void 0;
/**
 * Typed errors that services throw. Each one carries the HTTP status it should
 * become, but nothing here imports Express — a service must be usable from a
 * script, a test, or a queue worker with no request in sight. The single error
 * middleware is what translates these into responses.
 */
class AppError extends Error {
    constructor(message) {
        super(message);
        this.name = new.target.name;
    }
}
exports.AppError = AppError;
/** 400 — the request was understood but the data is not acceptable. */
class ValidationError extends AppError {
    status = 400;
}
exports.ValidationError = ValidationError;
/** 401 — no valid credentials. Also used for a wrong password. */
class UnauthorizedError extends AppError {
    status = 401;
}
exports.UnauthorizedError = UnauthorizedError;
/** 403 — authenticated, but not allowed to touch this particular resource. */
class ForbiddenError extends AppError {
    status = 403;
}
exports.ForbiddenError = ForbiddenError;
/** 404 — no such resource (or one the caller must not know exists). */
class NotFoundError extends AppError {
    status = 404;
}
exports.NotFoundError = NotFoundError;
/** 409 — the request conflicts with current state (duplicate email, item already sold). */
class ConflictError extends AppError {
    status = 409;
}
exports.ConflictError = ConflictError;
//# sourceMappingURL=errors.js.map
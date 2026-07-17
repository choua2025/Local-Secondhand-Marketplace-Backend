"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachUser = exports.requireAuth = void 0;
exports.requireUserId = requireUserId;
const errors_1 = require("../errors");
const token_1 = require("../lib/token");
/**
 * Pulls the bearer token out of `Authorization: Bearer <token>` and sets
 * req.userId. Rejects with 401 when the header is missing, malformed, or the
 * token does not verify.
 *
 * Note this only proves *who* the caller is (authentication). Whether they may
 * touch a particular listing or order is a question for the service layer
 * (authorization), which is the only place that knows who owns what.
 */
const requireAuth = (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        throw new errors_1.UnauthorizedError('Authentication required');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
        throw new errors_1.UnauthorizedError('Authentication required');
    }
    // verifyToken throws UnauthorizedError itself; letting it propagate keeps the
    // "one place decides what a bad token means" rule.
    req.userId = (0, token_1.verifyToken)(token);
    next();
};
exports.requireAuth = requireAuth;
/**
 * Sets req.userId IF a valid token is present, and otherwise does nothing.
 *
 * For routes that are public but behave differently for a known caller — here,
 * counting a listing view but not the owner's own. A missing token is the normal
 * case, not an error, so it never rejects; and a malformed or expired token is
 * treated as "anonymous" rather than a 401, because a stale token in someone's
 * tab should not stop a page from counting its view.
 */
const attachUser = (req, _res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
        const token = header.slice('Bearer '.length).trim();
        if (token.length > 0) {
            try {
                req.userId = (0, token_1.verifyToken)(token);
            }
            catch {
                // Ignore: an unverifiable token just means we treat this as anonymous.
            }
        }
    }
    next();
};
exports.attachUser = attachUser;
/**
 * A controller on a `requireAuth` route knows userId is set, but the type says
 * `number | undefined`. This narrows it in one place instead of every handler
 * writing a non-null assertion, which would silently lie if the route were ever
 * mounted without the middleware.
 */
function requireUserId(req) {
    const { userId } = req;
    if (userId === undefined) {
        throw new errors_1.UnauthorizedError('Authentication required');
    }
    return userId;
}
//# sourceMappingURL=auth.js.map
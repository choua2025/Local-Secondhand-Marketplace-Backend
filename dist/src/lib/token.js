"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signToken = signToken;
exports.verifyToken = verifyToken;
require("dotenv/config");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const errors_1 = require("../errors");
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
function signToken(userId) {
    return jsonwebtoken_1.default.sign({}, JWT_SECRET, {
        subject: String(userId),
        expiresIn: EXPIRES_IN,
    });
}
/**
 * Returns the user id, or throws UnauthorizedError for anything wrong —
 * expired, wrong signature, malformed, missing subject. The caller never has to
 * distinguish; all of them mean "not authenticated".
 */
function verifyToken(token) {
    let payload;
    try {
        payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch {
        throw new errors_1.UnauthorizedError('Invalid or expired token');
    }
    if (typeof payload === 'string' || payload.sub === undefined) {
        throw new errors_1.UnauthorizedError('Invalid token payload');
    }
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId < 1) {
        throw new errors_1.UnauthorizedError('Invalid token subject');
    }
    return userId;
}
//# sourceMappingURL=token.js.map
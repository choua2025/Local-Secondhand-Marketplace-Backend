"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESET_TOKEN_TTL_MS = void 0;
exports.createResetToken = createResetToken;
exports.hashResetToken = hashResetToken;
exports.resetTokenExpiry = resetTokenExpiry;
/**
 * Minting and hashing the opaque token that travels in a password-reset link.
 *
 * The token exists in plaintext exactly twice: in the email we send, and in the
 * request that redeems it. The database only ever sees `hashResetToken(token)`.
 * See migrations/002 for why SHA-256 is the right hash here and bcrypt is not.
 */
const node_crypto_1 = require("node:crypto");
/** 32 bytes = 256 bits. Guessing one is not a threat model, it is a fantasy. */
const TOKEN_BYTES = 32;
/**
 * An hour. Long enough to walk away from the computer and come back, short
 * enough that a link sitting in a mailbox someone else later reads is usually
 * already dead.
 */
exports.RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
/**
 * base64url, not hex: the token goes in a URL query string, and base64url is
 * defined to contain no characters that need percent-encoding. It is also ~30%
 * shorter than hex for the same entropy, which keeps the link from wrapping in
 * mail clients.
 */
function createResetToken() {
    return (0, node_crypto_1.randomBytes)(TOKEN_BYTES).toString('base64url');
}
function hashResetToken(token) {
    return (0, node_crypto_1.createHash)('sha256').update(token).digest('hex');
}
function resetTokenExpiry(now = new Date()) {
    return new Date(now.getTime() + exports.RESET_TOKEN_TTL_MS);
}
//# sourceMappingURL=resetToken.js.map
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.login = login;
exports.currentUser = currentUser;
exports.requestPasswordReset = requestPasswordReset;
exports.resetPassword = resetPassword;
/**
 * Registration, login, and password reset. Validation, hashing and token
 * issuing live here; nothing in this file knows what an HTTP request is.
 */
const db_1 = require("../db");
const errors_1 = require("../errors");
const mailer_1 = require("../lib/mailer");
const password_1 = require("../lib/password");
const pgErrors_1 = require("../lib/pgErrors");
const resetToken_1 = require("../lib/resetToken");
const token_1 = require("../lib/token");
const passwordResetRepository = __importStar(require("../repositories/passwordResetRepository"));
const userRepository = __importStar(require("../repositories/userRepository"));
const MIN_PASSWORD_LENGTH = 8;
/**
 * Deliberately permissive. Email syntax is far too baroque to validate properly
 * with a regex (RFC 5322 allows quoted strings, comments, and more), and the
 * only real proof an address works is sending mail to it. This rejects obvious
 * typos and nothing else.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(email) {
    // Addresses are case-insensitive in practice; storing them lowercased means
    // the UNIQUE index actually prevents Alice@ and alice@ both registering.
    return email.trim().toLowerCase();
}
async function register(input) {
    const email = normalizeEmail(input.email ?? '');
    const displayName = (input.display_name ?? '').trim();
    const city = (input.city ?? '').trim();
    const password = input.password ?? '';
    if (!EMAIL_PATTERN.test(email)) {
        throw new errors_1.ValidationError('Please enter a valid email address');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new errors_1.ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (displayName.length === 0) {
        throw new errors_1.ValidationError('Display name is required');
    }
    if (city.length === 0) {
        throw new errors_1.ValidationError('City is required');
    }
    const password_hash = await (0, password_1.hashPassword)(password);
    let user;
    try {
        user = await userRepository.insert({ email, password_hash, display_name: displayName, city });
    }
    catch (error) {
        // We let the database decide, rather than checking first and inserting
        // second — that gap is a race two concurrent signups could slip through.
        if ((0, pgErrors_1.isUniqueViolation)(error)) {
            throw new errors_1.ConflictError('An account with that email already exists');
        }
        throw error;
    }
    return { user, token: (0, token_1.signToken)(user.id) };
}
async function login(input) {
    const email = normalizeEmail(input.email ?? '');
    const password = input.password ?? '';
    const user = await userRepository.findByEmail(email);
    /**
     * Two properties matter here, and both are easy to get wrong:
     *
     * 1. The SAME error for "no such email" and "wrong password". Distinguishing
     *    them tells an attacker which addresses hold accounts.
     *
     * 2. The same *timing*. Returning early on a missing user would make that
     *    case measurably faster than the bcrypt comparison, which leaks exactly
     *    the fact we just hid. So we compare against a dummy hash instead.
     */
    const passwordMatches = await (0, password_1.verifyPassword)(password, user?.password_hash ?? password_1.DUMMY_HASH);
    if (!user || !passwordMatches) {
        throw new errors_1.UnauthorizedError('Incorrect email or password');
    }
    if (!user.is_active) {
        throw new errors_1.UnauthorizedError('This account has been deactivated');
    }
    // Strip the hash before the row goes anywhere near a response.
    const { password_hash: _password_hash, ...publicUser } = user;
    return { user: publicUser, token: (0, token_1.signToken)(user.id) };
}
/** Used by GET /api/auth/me so a client with a stored token can rehydrate. */
async function currentUser(userId) {
    const user = await userRepository.findById(userId);
    if (!user)
        throw new errors_1.UnauthorizedError('Account no longer exists');
    return user;
}
/**
 * Step one of a reset: mint a link and mail it.
 *
 * Returns void — successfully, identically — whether or not the address belongs
 * to an account. The same reasoning as `login`: an endpoint that 404s on an
 * unknown email is a free tool for discovering which addresses are registered.
 * The caller answers "if that address has an account, we've sent a link" and
 * genuinely cannot tell which happened.
 *
 * A malformed address is a different matter and does throw. That is a statement
 * about syntax, not about who exists, so it leaks nothing — and silently
 * accepting "alice@" would leave a user staring at an inbox forever.
 */
async function requestPasswordReset(input) {
    const email = normalizeEmail(input.email ?? '');
    if (!EMAIL_PATTERN.test(email)) {
        throw new errors_1.ValidationError('Please enter a valid email address');
    }
    const user = await userRepository.findByEmail(email);
    // A deactivated account gets no link: resetting the password would not let
    // them log in anyway, and mailing one implies the account is usable.
    if (!user || !user.is_active)
        return;
    const token = (0, resetToken_1.createResetToken)();
    await (0, db_1.withTransaction)(async (client) => {
        // Requesting a second link retires the first. Users who click "send again"
        // reach for the newest mail, and leaving the old one live widens the window
        // in which any of them works.
        await passwordResetRepository.invalidateAllForUser(user.id, client);
        await passwordResetRepository.insert({ user_id: user.id, token_hash: (0, resetToken_1.hashResetToken)(token), expires_at: (0, resetToken_1.resetTokenExpiry)() }, client);
    });
    // Deliberately after the commit. Mail is the side effect a rollback cannot
    // undo, so it must not happen until the row it refers to is durable.
    await (0, mailer_1.sendPasswordResetEmail)(user.email, token);
}
/**
 * Step two: redeem the token and set the new password.
 *
 * Every failure — unknown token, expired token, already-spent token, deleted
 * user — is the same ValidationError. The person on this page has a link that
 * either works or does not, and telling them *why* it does not would let a
 * stranger probe the token space for near-misses.
 */
async function resetPassword(input) {
    const token = (input.token ?? '').trim();
    const password = input.password ?? '';
    if (token.length === 0) {
        throw new errors_1.ValidationError('This reset link is invalid or has expired');
    }
    // Checked before the token lookup so a user who typed a four-character
    // password is told so, rather than being sent back to request a fresh link.
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new errors_1.ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const password_hash = await (0, password_1.hashPassword)(password);
    await (0, db_1.withTransaction)(async (client) => {
        const row = await passwordResetRepository.findRedeemable((0, resetToken_1.hashResetToken)(token), client);
        if (!row) {
            throw new errors_1.ValidationError('This reset link is invalid or has expired');
        }
        // `markUsed` only matches a row whose used_at is still NULL. Two tabs
        // submitting the same link race here, and exactly one of them wins; the
        // loser's transaction rolls back rather than writing a second password.
        const spent = await passwordResetRepository.markUsed(row.id, client);
        if (!spent) {
            throw new errors_1.ValidationError('This reset link is invalid or has expired');
        }
        await userRepository.updatePassword(row.user_id, password_hash, client);
        // Any other link that was in flight is now void. Changing a password is how
        // someone reacts to a compromised mailbox, and a second live link sitting in
        // that mailbox would hand the account straight back.
        await passwordResetRepository.invalidateAllForUser(row.user_id, client);
    });
}
//# sourceMappingURL=authService.js.map
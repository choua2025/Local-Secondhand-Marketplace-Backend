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
exports.me = me;
exports.forgotPassword = forgotPassword;
exports.resetPassword = resetPassword;
const errors_1 = require("../errors");
const auth_1 = require("../middleware/auth");
const authService = __importStar(require("../services/authService"));
/**
 * `req.body` is `any` — it is whatever JSON the client sent. Coercing each
 * field to a string here means the service can trust its input types, and a
 * client sending `{ password: 12345678 }` gets a 400 rather than a 500 from
 * `password.length` on a number.
 */
function readString(body, field) {
    if (typeof body !== 'object' || body === null) {
        throw new errors_1.ValidationError('Request body must be a JSON object');
    }
    const value = body[field];
    if (typeof value !== 'string') {
        throw new errors_1.ValidationError(`${field} is required`);
    }
    return value;
}
async function register(req, res) {
    const result = await authService.register({
        email: readString(req.body, 'email'),
        password: readString(req.body, 'password'),
        display_name: readString(req.body, 'display_name'),
        city: readString(req.body, 'city'),
    });
    // 201: a new resource exists as a result of this request.
    res.status(201).json(result);
}
async function login(req, res) {
    const result = await authService.login({
        email: readString(req.body, 'email'),
        password: readString(req.body, 'password'),
    });
    res.json(result);
}
/** Turns a stored token back into a user, so a reload can restore the session. */
async function me(req, res) {
    res.json(await authService.currentUser((0, auth_1.requireUserId)(req)));
}
/**
 * 202 Accepted, always — "we have taken your request; we are not telling you
 * what came of it". A 200 would suggest we found the account and a 404 would
 * confirm we did not. The service is equally silent; see requestPasswordReset.
 */
async function forgotPassword(req, res) {
    await authService.requestPasswordReset({ email: readString(req.body, 'email') });
    res.status(202).json({
        message: 'If an account exists for that address, a reset link is on its way.',
    });
}
/** 204: the password changed, and there is nothing to hand back. */
async function resetPassword(req, res) {
    await authService.resetPassword({
        token: readString(req.body, 'token'),
        password: readString(req.body, 'password'),
    });
    res.status(204).end();
}
//# sourceMappingURL=authController.js.map
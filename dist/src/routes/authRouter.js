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
exports.authRouter = void 0;
const express_1 = require("express");
const authController = __importStar(require("../controllers/authController"));
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
exports.authRouter = (0, express_1.Router)();
// Public, and strictly rate limited: these are the credential endpoints an
// attacker hammers — password brute-force, mass signups, reset-email bombing.
exports.authRouter.post('/register', rateLimit_1.authLimiter, authController.register);
exports.authRouter.post('/login', rateLimit_1.authLimiter, authController.login);
// Also public — a user who has forgotten their password cannot present a token.
// The emailed link is the credential, and /reset-password verifies it itself.
exports.authRouter.post('/forgot-password', rateLimit_1.authLimiter, authController.forgotPassword);
exports.authRouter.post('/reset-password', rateLimit_1.authLimiter, authController.resetPassword);
// Protected: needs a valid token to tell you whose token it is. NOT strictly
// limited — a legitimate client calls this on every load to rehydrate.
exports.authRouter.get('/me', auth_1.requireAuth, authController.me);
//# sourceMappingURL=authRouter.js.map
import { Router } from 'express';
import * as authController from '../controllers/authController';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';

export const authRouter = Router();

// Public, and strictly rate limited: these are the credential endpoints an
// attacker hammers — password brute-force, mass signups, reset-email bombing.
authRouter.post('/register', authLimiter, authController.register);
authRouter.post('/login', authLimiter, authController.login);

// Also public — a user who has forgotten their password cannot present a token.
// The emailed link is the credential, and /reset-password verifies it itself.
authRouter.post('/forgot-password', authLimiter, authController.forgotPassword);
authRouter.post('/reset-password', authLimiter, authController.resetPassword);

// Protected: needs a valid token to tell you whose token it is. NOT strictly
// limited — a legitimate client calls this on every load to rehydrate.
authRouter.get('/me', requireAuth, authController.me);

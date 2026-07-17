import { Router } from 'express';
import * as reviewController from '../controllers/reviewController';
import * as userController from '../controllers/userController';
import { requireAuth } from '../middleware/auth';

export const userRouter = Router();

// Mounted at /api/users.
//
// '/me', not '/:id'. The user being edited is always the one the token names, so
// there is no id for a client to tamper with and no ownership check to forget.
userRouter.get('/me', requireAuth, userController.getMe);
userRouter.patch('/me', requireAuth, userController.updateMe);

// Public — a buyer must be able to read a seller's reputation before deciding
// to trust them, which means before logging in.
userRouter.get('/:id/reviews', reviewController.listForUser);

// Public too: the presence line in a conversation. See userController.presence.
userRouter.get('/:id/presence', userController.presence);

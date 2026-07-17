import { Router } from 'express';
import * as reviewController from '../controllers/reviewController';
import { requireAuth } from '../middleware/auth';

export const reviewRouter = Router();

// Mounted at /api/reviews. Writing a review requires a session; the service
// then checks you were actually party to the order.
reviewRouter.post('/', requireAuth, reviewController.create);

import { Router } from 'express';
import * as favoriteController from '../controllers/favoriteController';
import { requireAuth } from '../middleware/auth';

export const favoriteRouter = Router();

// Every favorites route is personal, so the whole router sits behind auth.
// The user is always req.userId — there is no way to read someone else's saves.
favoriteRouter.use(requireAuth);

favoriteRouter.get('/', favoriteController.list);
favoriteRouter.post('/:listingId', favoriteController.add);
favoriteRouter.delete('/:listingId', favoriteController.remove);

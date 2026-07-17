import { Router } from 'express';
import * as listingController from '../controllers/listingController';
import { attachUser, requireAuth } from '../middleware/auth';

export const listingRouter = Router();

// Public reads. Mounted at /api/listings.
listingRouter.get('/', listingController.browse);

// These MUST precede '/:id'. Express matches routes in declaration order, so in
// the reverse order these URLs would bind id="cities" / id="mine" and 400.
listingRouter.get('/cities', listingController.cities);
listingRouter.get('/mine', requireAuth, listingController.listMine);

listingRouter.get('/:id', listingController.getById);

// Public, but attachUser sets req.userId when a token is present so the service
// can skip the owner's own views. Not requireAuth: logged-out views count too.
listingRouter.post('/:id/view', attachUser, listingController.registerView);

// Protected writes. requireAuth sets req.userId; the SERVICE decides whether
// that user owns the row — authentication here, authorization there.
listingRouter.post('/', requireAuth, listingController.create);
listingRouter.patch('/:id', requireAuth, listingController.update);
listingRouter.delete('/:id', requireAuth, listingController.remove);

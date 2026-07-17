import { Router } from 'express';
import * as orderController from '../controllers/orderController';
import { requireAuth } from '../middleware/auth';

export const orderRouter = Router();

// Buying and selling are both personal; the whole router requires a session.
orderRouter.use(requireAuth);

orderRouter.post('/', orderController.place);
orderRouter.get('/', orderController.listForUser);
orderRouter.patch('/:id', orderController.updateStatus);

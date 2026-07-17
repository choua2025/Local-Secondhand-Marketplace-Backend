import { Router } from 'express';
import * as categoryController from '../controllers/categoryController';

export const categoryRouter = Router();

// Mounted at /api/categories. Public — the search bar needs it before login.
categoryRouter.get('/', categoryController.list);

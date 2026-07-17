import { Router } from 'express';
import * as uploadController from '../controllers/uploadController';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';

export const uploadRouter = Router();

// Mounted at /api/uploads. Signing an upload spends our Cloudinary quota, so it
// is never anonymous — and it is strictly rate limited so a stolen session
// cannot mint thousands of upload authorizations.
uploadRouter.get('/signature', authLimiter, requireAuth, uploadController.signature);

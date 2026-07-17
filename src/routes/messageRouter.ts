import { Router } from 'express';
import * as messageController from '../controllers/messageController';
import { requireAuth } from '../middleware/auth';

export const messageRouter = Router();

// Messaging is entirely personal; the whole router requires a session.
messageRouter.use(requireAuth);

// Static paths first — there is no '/:id' here today, but adding one later
// would silently swallow '/threads' if these came after it.
messageRouter.get('/threads', messageController.listThreads);
messageRouter.get('/unread-count', messageController.unreadCount);

messageRouter.get('/', messageController.thread);
messageRouter.post('/', messageController.send);
messageRouter.post('/read', messageController.markRead);

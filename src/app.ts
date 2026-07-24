import 'dotenv/config';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pool } from './db';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimit';
import { authRouter } from './routes/authRouter';
import { categoryRouter } from './routes/categoryRouter';
import { favoriteRouter } from './routes/favoriteRouter';
import { listingRouter } from './routes/listingRouter';
import { messageRouter } from './routes/messageRouter';
import { orderRouter } from './routes/orderRouter';
import { reviewRouter } from './routes/reviewRouter';
import { uploadRouter } from './routes/uploadRouter';
import { userRouter } from './routes/userRouter';

/**
 * Builds the Express app without binding a port.
 *
 * Separating this from index.ts is what lets the test suite drive the real
 * routers, middleware and error handling in-process — supertest starts the app
 * on an ephemeral port per request. A module that called listen() at import
 * time would fight the tests for :4000.
 */
export function createApp(): Express {
  const app = express();

  /**
   * Behind a load balancer or reverse proxy, the real client IP is in the
   * X-Forwarded-For header; req.ip is the proxy otherwise. Rate limiting keys on
   * req.ip, so without this every request would look like it came from the proxy
   * and share one bucket. Set TRUST_PROXY to the number of proxy hops in front
   * of the app (e.g. 1). Left unset in local dev, where there is no proxy.
   */
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  // Security headers: HSTS, X-Content-Type-Options: nosniff, frameguard against
  // clickjacking, and more. This is a JSON API rather than an HTML server, so
  // helmet's defaults apply cleanly; cross-origin access is governed by the CORS
  // middleware just below, not by these headers.
  app.use(helmet());

  // The Vite dev server runs on a different origin, so the browser needs
  // permission to call us. In production the two would be served from one origin
  // and this could go away.
  //
  // A list, not a single value: Vite silently falls back to 5174, 5175, ... when
  // its preferred port is taken, and a mismatched origin here shows up as an
  // opaque CORS failure in the browser rather than anything that names the port.
  const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());

  /**
   * Health check. Touches the database so a green response means the whole
   * chain — process, pool, credentials, Postgres — is actually up, not just
   * that Express is listening.
   */
  app.get('/api/health', async (_req: Request, res: Response) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  });

  app.get('/api/healthz', async (_req: Request, res: Response) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', message: 'Health check passed' });
  });

  // Everything past the health check is rate limited. Health is exempt on
  // purpose — load balancers poll it constantly and must never be throttled.
  // The stricter per-endpoint limits (auth, uploads) are layered on inside
  // their routers, on top of this global cap.
  app.use(globalLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/listings', listingRouter);
  app.use('/api/categories', categoryRouter);
  app.use('/api/favorites', favoriteRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/messages', messageRouter);
  app.use('/api/reviews', reviewRouter);
  app.use('/api/uploads', uploadRouter);
  app.use('/api/users', userRouter);

  // Order matters. Unclaimed URLs 404, then every thrown error — including ones
  // from async handlers, which Express 5 forwards for us — lands in errorHandler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

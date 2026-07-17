"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const db_1 = require("./db");
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimit_1 = require("./middleware/rateLimit");
const authRouter_1 = require("./routes/authRouter");
const categoryRouter_1 = require("./routes/categoryRouter");
const favoriteRouter_1 = require("./routes/favoriteRouter");
const listingRouter_1 = require("./routes/listingRouter");
const messageRouter_1 = require("./routes/messageRouter");
const orderRouter_1 = require("./routes/orderRouter");
const reviewRouter_1 = require("./routes/reviewRouter");
const uploadRouter_1 = require("./routes/uploadRouter");
const userRouter_1 = require("./routes/userRouter");
/**
 * Builds the Express app without binding a port.
 *
 * Separating this from index.ts is what lets the test suite drive the real
 * routers, middleware and error handling in-process — supertest starts the app
 * on an ephemeral port per request. A module that called listen() at import
 * time would fight the tests for :4000.
 */
function createApp() {
    const app = (0, express_1.default)();
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
    app.use((0, helmet_1.default)());
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
    app.use((0, cors_1.default)({ origin: allowedOrigins }));
    app.use(express_1.default.json());
    /**
     * Health check. Touches the database so a green response means the whole
     * chain — process, pool, credentials, Postgres — is actually up, not just
     * that Express is listening.
     */
    app.get('/api/health', async (_req, res) => {
        await db_1.pool.query('SELECT 1');
        res.json({ ok: true, db: 'up' });
    });
    // Everything past the health check is rate limited. Health is exempt on
    // purpose — load balancers poll it constantly and must never be throttled.
    // The stricter per-endpoint limits (auth, uploads) are layered on inside
    // their routers, on top of this global cap.
    app.use(rateLimit_1.globalLimiter);
    app.use('/api/auth', authRouter_1.authRouter);
    app.use('/api/listings', listingRouter_1.listingRouter);
    app.use('/api/categories', categoryRouter_1.categoryRouter);
    app.use('/api/favorites', favoriteRouter_1.favoriteRouter);
    app.use('/api/orders', orderRouter_1.orderRouter);
    app.use('/api/messages', messageRouter_1.messageRouter);
    app.use('/api/reviews', reviewRouter_1.reviewRouter);
    app.use('/api/uploads', uploadRouter_1.uploadRouter);
    app.use('/api/users', userRouter_1.userRouter);
    // Order matters. Unclaimed URLs 404, then every thrown error — including ones
    // from async handlers, which Express 5 forwards for us — lands in errorHandler.
    app.use(errorHandler_1.notFoundHandler);
    app.use(errorHandler_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map
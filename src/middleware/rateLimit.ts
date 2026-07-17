/**
 * Rate limiting.
 *
 * Two tiers: a generous cap on everything, to blunt scraping and runaway
 * clients, and a strict cap on the handful of endpoints actually worth
 * attacking — login (password brute-force), registration (mass fake accounts),
 * password reset (email bombing), and upload signing (quota abuse).
 *
 * Counting is per-IP and in-memory. That is correct for a single process; a
 * multi-instance deployment behind a load balancer would want a shared store
 * (the `rate-limit-redis` adapter) so the limit is enforced across instances
 * rather than per instance. The seam is the `store` option below.
 *
 * Both limiters are skipped under `NODE_ENV=test`: the suite fires hundreds of
 * requests in seconds and would throttle itself. The env is set in the test
 * setup, so production and development are always limited.
 */
import rateLimit from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes.

const skipInTests = (): boolean => process.env.NODE_ENV === 'test';

/**
 * The wide net. 300 requests / 15 min / IP is far above what a person browsing
 * generates, and well below what a scraper wants.
 */
export const globalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  // The app's error shape is { error }, so a 429 matches every other failure.
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

/**
 * The tight net, for credential and quota endpoints. 20 / 15 min / IP is roomy
 * for a person who fat-fingers a password a few times and hostile to a script
 * trying thousands. Deliberately NOT applied to GET /auth/me, which a legitimate
 * client calls on every load.
 */
export const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

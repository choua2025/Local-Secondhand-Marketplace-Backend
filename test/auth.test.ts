import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, PASSWORD, request } from './helpers/api';
import { resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

describe('POST /api/auth/register', () => {
  it('creates a user and returns a token', async () => {
    const response = await request.post('/api/auth/register').send({
      email: 'new@example.com',
      password: PASSWORD,
      display_name: 'New Person',
      city: 'Portland',
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'new@example.com',
      display_name: 'New Person',
      city: 'Portland',
    });
    expect(typeof response.body.token).toBe('string');
  });

  it('never returns the password hash', async () => {
    const response = await request.post('/api/auth/register').send({
      email: 'hash@example.com',
      password: PASSWORD,
      display_name: 'H',
      city: 'Portland',
    });
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('rejects a duplicate email with 409', async () => {
    await createUser({ email: 'taken@example.com' });
    const response = await request
      .post('/api/auth/register')
      .send({ email: 'taken@example.com', password: PASSWORD, display_name: 'X', city: 'Y' });

    expect(response.status).toBe(409);
  });

  it('treats email as case-insensitive, so DAVE@ collides with dave@', async () => {
    await createUser({ email: 'dave@example.com' });
    const response = await request
      .post('/api/auth/register')
      .send({ email: 'DAVE@example.com', password: PASSWORD, display_name: 'X', city: 'Y' });

    expect(response.status).toBe(409);
  });

  it.each([
    ['malformed email', { email: 'nope', password: PASSWORD, display_name: 'X', city: 'Y' }],
    ['short password', { email: 'a@b.com', password: 'short', display_name: 'X', city: 'Y' }],
    ['missing city', { email: 'a@b.com', password: PASSWORD, display_name: 'X' }],
    ['missing display_name', { email: 'a@b.com', password: PASSWORD, city: 'Y' }],
    // A number would blow up on `password.length` if the controller did not coerce.
    ['non-string password', { email: 'a@b.com', password: 12345678, display_name: 'X', city: 'Y' }],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await request.post('/api/auth/register').send(body);
    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('round-trips a registered user', async () => {
    const user = await createUser({ email: 'round@example.com' });
    const response = await request
      .post('/api/auth/login')
      .send({ email: 'round@example.com', password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
  });

  /**
   * The account-enumeration guard. A different status, or a different message,
   * for "no such email" versus "wrong password" tells an attacker which
   * addresses hold accounts.
   */
  it('gives an identical response for a wrong password and an unknown email', async () => {
    await createUser({ email: 'real@example.com' });

    const wrongPassword = await request
      .post('/api/auth/login')
      .send({ email: 'real@example.com', password: 'not-the-password' });
    const unknownEmail = await request
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  /**
   * The other half of that guard. Returning early on a missing user would make
   * that path measurably faster than the bcrypt comparison, leaking exactly
   * what the identical message hides. authService compares against DUMMY_HASH.
   *
   * Timing assertions are inherently noisy, so this asserts something weak but
   * meaningful: the unknown-email path is not an order of magnitude faster.
   * A missing bcrypt call shows up as ~0ms against bcrypt's ~50ms.
   */
  it('takes comparable time for a wrong password and an unknown email', async () => {
    await createUser({ email: 'timed@example.com' });

    const time = async (email: string): Promise<number> => {
      const started = performance.now();
      await request.post('/api/auth/login').send({ email, password: 'wrong-password' });
      return performance.now() - started;
    };

    // Warm up: the first bcrypt call in a process is slower.
    await time('timed@example.com');

    const knownEmail = await time('timed@example.com');
    const unknownEmail = await time('ghost@example.com');

    expect(unknownEmail).toBeGreaterThan(knownEmail / 5);
  });

  it('rejects a deactivated account', async () => {
    const user = await createUser({ email: 'gone@example.com' });
    const { pool } = await import('../src/db');
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);

    const response = await request
      .post('/api/auth/login')
      .send({ email: 'gone@example.com', password: PASSWORD });

    expect(response.status).toBe(401);
  });
});

describe('GET /api/auth/me (the auth middleware)', () => {
  it('returns the user for a valid token', async () => {
    const user = await createUser();
    const response = await request.get('/api/auth/me').set(...user.auth);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(user.id);
    expect(response.body).not.toHaveProperty('password_hash');
  });

  it('rejects a request with no Authorization header', async () => {
    expect((await request.get('/api/auth/me')).status).toBe(401);
  });

  it.each([
    ['no Bearer prefix', (t: string) => t],
    ['empty token', () => 'Bearer '],
    ['garbage', () => 'Bearer garbage'],
    ['tampered signature', (t: string) => `Bearer ${t.slice(0, -1)}X`],
  ])('rejects %s with 401', async (_label, makeHeader) => {
    const user = await createUser();
    const response = await request.get('/api/auth/me').set('Authorization', makeHeader(user.token));
    expect(response.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({}, 'not-the-real-secret', { subject: '1', expiresIn: '7d' });
    const response = await request.get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({}, process.env.JWT_SECRET!, { subject: '1', expiresIn: '-1s' });
    const response = await request.get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(response.status).toBe(401);
  });
});

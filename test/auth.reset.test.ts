import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { PasswordResetEmail, resetMailTransport, setMailTransport } from '../src/lib/mailer';
import { createUser, PASSWORD, request } from './helpers/api';
import { countRows, resetDatabase } from './helpers/db';

const NEW_PASSWORD = 'a-brand-new-password';

/**
 * Every email the app tried to send during a test.
 *
 * The token only exists in plaintext inside that email — the database stores a
 * SHA-256 of it — so capturing the transport is the only honest way to get hold
 * of one. A test that read the hash out of the table and "reversed" it would be
 * testing a fiction.
 */
let sent: PasswordResetEmail[] = [];

beforeEach(async () => {
  await resetDatabase();
  sent = [];
  setMailTransport((email) => {
    sent.push(email);
  });
});

afterEach(resetMailTransport);

/** Drives POST /forgot-password and returns the token that was mailed out. */
async function requestReset(email: string): Promise<string> {
  const response = await request.post('/api/auth/forgot-password').send({ email });
  expect(response.status).toBe(202);

  const email_ = sent.at(-1);
  if (!email_) throw new Error(`No reset email was sent to ${email}`);
  return email_.token;
}

function resetWith(token: string, password: string) {
  return request.post('/api/auth/reset-password').send({ token, password });
}

function login(email: string, password: string) {
  return request.post('/api/auth/login').send({ email, password });
}

describe('POST /api/auth/forgot-password', () => {
  it('mails a link containing the token to a registered address', async () => {
    await createUser({ email: 'ada@example.com' });
    const token = await requestReset('ada@example.com');

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ada@example.com');
    expect(sent[0]!.resetUrl).toContain('/reset-password?token=');
    expect(sent[0]!.resetUrl).toContain(encodeURIComponent(token));
  });

  /**
   * The account-enumeration guard, the same property login has. An endpoint that
   * answers differently for a registered and an unregistered address is a free
   * tool for discovering who has an account here.
   */
  it('answers identically for an unknown address, and sends nothing', async () => {
    await createUser({ email: 'real@example.com' });

    const known = await request.post('/api/auth/forgot-password').send({ email: 'real@example.com' });
    const unknown = await request.post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    // One email, for the account that exists. The ghost got nothing.
    expect(sent.map((email) => email.to)).toEqual(['real@example.com']);
  });

  it('sends nothing for a deactivated account', async () => {
    const user = await createUser({ email: 'gone@example.com' });
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);

    const response = await request.post('/api/auth/forgot-password').send({ email: 'gone@example.com' });

    expect(response.status).toBe(202);
    expect(sent).toHaveLength(0);
    expect(await countRows('password_reset_tokens')).toBe(0);
  });

  it('treats the address case-insensitively, as login does', async () => {
    await createUser({ email: 'mixed@example.com' });
    await requestReset('MIXED@example.com');
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['malformed email', { email: 'not-an-email' }],
    ['missing email', {}],
    ['non-string email', { email: 42 }],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await request.post('/api/auth/forgot-password').send(body);
    expect(response.status).toBe(400);
  });

  it('retires the previous link when a second one is requested', async () => {
    await createUser({ email: 'twice@example.com' });
    const first = await requestReset('twice@example.com');
    const second = await requestReset('twice@example.com');

    expect(first).not.toBe(second);
    expect((await resetWith(first, NEW_PASSWORD)).status).toBe(400);
    expect((await resetWith(second, NEW_PASSWORD)).status).toBe(204);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('changes the password, and the old one stops working', async () => {
    await createUser({ email: 'change@example.com' });
    const token = await requestReset('change@example.com');

    expect((await resetWith(token, NEW_PASSWORD)).status).toBe(204);
    expect((await login('change@example.com', NEW_PASSWORD)).status).toBe(200);
    expect((await login('change@example.com', PASSWORD)).status).toBe(401);
  });

  /** Single use. A link that stays live is a credential sitting in a mailbox. */
  it('rejects a token that has already been redeemed', async () => {
    await createUser({ email: 'once@example.com' });
    const token = await requestReset('once@example.com');

    expect((await resetWith(token, NEW_PASSWORD)).status).toBe(204);
    expect((await resetWith(token, 'another-password')).status).toBe(400);

    // And the second attempt did not take effect.
    expect((await login('once@example.com', 'another-password')).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    await createUser({ email: 'stale@example.com' });
    const token = await requestReset('stale@example.com');

    // Reach past the API to age the row: waiting an hour is not a test.
    await pool.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'`);

    expect((await resetWith(token, NEW_PASSWORD)).status).toBe(400);
    expect((await login('stale@example.com', PASSWORD)).status).toBe(200);
  });

  it.each([
    ['an unknown token', 'never-issued-by-anyone'],
    ['an empty token', ''],
  ])('rejects %s with 400', async (_label, token) => {
    expect((await resetWith(token, NEW_PASSWORD)).status).toBe(400);
  });

  it('rejects a non-string token with 400', async () => {
    const response = await request.post('/api/auth/reset-password').send({ token: 7, password: NEW_PASSWORD });
    expect(response.status).toBe(400);
  });

  /**
   * The short-password check runs before the token is spent. Otherwise a typo
   * would burn the link and force the user to request a whole new email.
   */
  it('rejects a too-short password without consuming the token', async () => {
    await createUser({ email: 'short@example.com' });
    const token = await requestReset('short@example.com');

    expect((await resetWith(token, 'tiny')).status).toBe(400);
    expect((await resetWith(token, NEW_PASSWORD)).status).toBe(204);
  });

  /**
   * Two links in flight, the older one already dead. Resetting with the live one
   * must not resurrect anything — a compromised mailbox is exactly why someone
   * resets, and a second working link would hand the account straight back.
   */
  it('leaves no other live token behind after a successful reset', async () => {
    await createUser({ email: 'clean@example.com' });
    await requestReset('clean@example.com');
    const live = await requestReset('clean@example.com');

    expect((await resetWith(live, NEW_PASSWORD)).status).toBe(204);

    const { rows } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM password_reset_tokens WHERE used_at IS NULL`,
    );
    expect(rows[0]!.count).toBe(0);
  });

  it('never lets the response distinguish why a token failed', async () => {
    await createUser({ email: 'opaque@example.com' });
    const spent = await requestReset('opaque@example.com');
    await resetWith(spent, NEW_PASSWORD);

    const used = await resetWith(spent, 'yet-another-password');
    const unknown = await resetWith('never-issued-by-anyone', 'yet-another-password');

    expect(used.status).toBe(unknown.status);
    expect(used.body).toEqual(unknown.body);
  });
});

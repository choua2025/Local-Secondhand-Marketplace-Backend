import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { createUser, request } from './helpers/api';
import { resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

/** An image on someone else's host: never ours, so never destroyed. */
const EXTERNAL_AVATAR = 'https://example.com/me.jpg';

async function avatarColumns(userId: number): Promise<{ url: string | null; id: string | null }> {
  const { rows } = await pool.query<{ avatar_url: string | null; avatar_public_id: string | null }>(
    'SELECT avatar_url, avatar_public_id FROM users WHERE id = $1',
    [userId],
  );
  return { url: rows[0]!.avatar_url, id: rows[0]!.avatar_public_id };
}

describe('GET /api/users/me', () => {
  it('returns the caller, without the hash', async () => {
    const user = await createUser();
    const response = await request.get('/api/users/me').set(...user.auth);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(user.id);
    expect(response.body).not.toHaveProperty('password_hash');
  });

  it('401s without a token', async () => {
    expect((await request.get('/api/users/me')).status).toBe(401);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates the fields it is given', async () => {
    const user = await createUser({ display_name: 'Old Name', city: 'Portland' });
    const response = await request
      .patch('/api/users/me')
      .set(...user.auth)
      .send({ display_name: 'New Name', city: 'Seattle', phone: '+1 (503) 555-0100' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      display_name: 'New Name',
      city: 'Seattle',
      phone: '+1 (503) 555-0100',
    });
  });

  /** PATCH, not PUT. An absent key must leave the column exactly as it was. */
  it('leaves omitted fields alone', async () => {
    const user = await createUser({ display_name: 'Keep Me', city: 'Portland' });
    const response = await request
      .patch('/api/users/me')
      .set(...user.auth)
      .send({ city: 'Seattle' });

    expect(response.body.display_name).toBe('Keep Me');
    expect(response.body.city).toBe('Seattle');
  });

  /**
   * The distinction a PATCH has to make: `{}` means "change nothing" while
   * `{"city": null}` means "clear the city". Reading the body with
   * `!== undefined` instead of `in` would collapse the two.
   */
  it('clears a nullable field when sent null', async () => {
    const user = await createUser({ city: 'Portland' });
    const response = await request.patch('/api/users/me').set(...user.auth).send({ city: null });

    expect(response.status).toBe(200);
    expect(response.body.city).toBeNull();
  });

  it('treats an emptied text box as a clear', async () => {
    const user = await createUser({ city: 'Portland' });
    const response = await request.patch('/api/users/me').set(...user.auth).send({ city: '   ' });

    expect(response.body.city).toBeNull();
  });

  it('accepts an empty patch as a no-op rather than an error', async () => {
    const user = await createUser({ display_name: 'Unchanged' });
    const response = await request.patch('/api/users/me').set(...user.auth).send({});

    expect(response.status).toBe(200);
    expect(response.body.display_name).toBe('Unchanged');
  });

  /** display_name is NOT NULL and shown on every listing. It cannot be blanked. */
  it.each([
    ['a blank display_name', { display_name: '   ' }],
    ['a null display_name', { display_name: null }],
    ['a non-string display_name', { display_name: 42 }],
    ['an over-long display_name', { display_name: 'x'.repeat(81) }],
    ['a phone with letters', { phone: 'call-me-maybe' }],
    ['a javascript: avatar', { avatar_url: 'javascript:alert(1)' }],
    ['a data: avatar', { avatar_url: 'data:image/png;base64,AAA' }],
    ['a non-string avatar', { avatar_url: 7 }],
  ])('rejects %s with 400', async (_label, body) => {
    const user = await createUser();
    const response = await request.patch('/api/users/me').set(...user.auth).send(body);
    expect(response.status).toBe(400);
  });

  it('rejects a non-object body', async () => {
    const user = await createUser();
    const response = await request
      .patch('/api/users/me')
      .set(...user.auth)
      .set('Content-Type', 'application/json')
      .send('[1,2,3]');
    expect(response.status).toBe(400);
  });

  /**
   * The allow-list in the repository, exercised from the outside. A profile form
   * must not be a route to taking over an email address or reactivating a
   * banned account, however the body is shaped.
   */
  it('ignores fields a profile has no business setting', async () => {
    const user = await createUser({ email: 'mine@example.com' });
    const response = await request
      .patch('/api/users/me')
      .set(...user.auth)
      .send({
        display_name: 'Fine',
        email: 'stolen@example.com',
        is_active: false,
        password_hash: 'nope',
        id: 9999,
      });

    expect(response.status).toBe(200);
    expect(response.body.email).toBe('mine@example.com');
    expect(response.body.is_active).toBe(true);
    expect(response.body.id).toBe(user.id);

    // And the login still works, so password_hash survived untouched.
    const login = await request
      .post('/api/auth/login')
      .send({ email: 'mine@example.com', password: 'password123' });
    expect(login.status).toBe(200);
  });

  it('401s without a token', async () => {
    expect((await request.patch('/api/users/me').send({ city: 'X' })).status).toBe(401);
  });

  describe('avatars', () => {
    it('stores an external avatar url with a null public_id, marking it not-ours', async () => {
      const user = await createUser();
      const response = await request
        .patch('/api/users/me')
        .set(...user.auth)
        .send({ avatar_url: EXTERNAL_AVATAR });

      expect(response.status).toBe(200);
      expect(response.body.avatar_url).toBe(EXTERNAL_AVATAR);

      // null public_id is what stops the cleanup code from ever trying to
      // destroy an image hosted on somebody else's server.
      expect(await avatarColumns(user.id)).toEqual({ url: EXTERNAL_AVATAR, id: null });
    });

    it('clears both columns when the avatar is removed', async () => {
      const user = await createUser();
      await request.patch('/api/users/me').set(...user.auth).send({ avatar_url: EXTERNAL_AVATAR });

      const response = await request
        .patch('/api/users/me')
        .set(...user.auth)
        .send({ avatar_url: null });

      expect(response.body.avatar_url).toBeNull();
      expect(await avatarColumns(user.id)).toEqual({ url: null, id: null });
    });

    it('does not touch the avatar when the key is absent', async () => {
      const user = await createUser();
      await request.patch('/api/users/me').set(...user.auth).send({ avatar_url: EXTERNAL_AVATAR });
      await request.patch('/api/users/me').set(...user.auth).send({ city: 'Seattle' });

      expect((await avatarColumns(user.id)).url).toBe(EXTERNAL_AVATAR);
    });
  });
});

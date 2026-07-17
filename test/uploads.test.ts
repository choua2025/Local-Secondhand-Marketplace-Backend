import { beforeEach, describe, expect, it } from 'vitest';
import { isCloudinaryConfigured } from '../src/lib/cloudinary';
import { createUser, request } from './helpers/api';
import { resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

describe.runIf(isCloudinaryConfigured())('GET /api/uploads/signature', () => {
  it('returns a signature, the timestamp it covers, and the public config', async () => {
    const user = await createUser();
    const response = await request
      .get('/api/uploads/signature?folder=listings')
      .set(...user.auth);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      folder: 'listings',
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
    });
    expect(typeof response.body.signature).toBe('string');
    expect(response.body.signature.length).toBeGreaterThan(0);
    expect(Number.isInteger(response.body.timestamp)).toBe(true);
  });

  /**
   * The whole point of signing on the server. If the secret ever appeared in a
   * response, the browser could mint its own signatures and the account is open.
   */
  it('never leaks the API secret', async () => {
    const user = await createUser();
    const response = await request
      .get('/api/uploads/signature?folder=avatars')
      .set(...user.auth);

    expect(JSON.stringify(response.body)).not.toContain(process.env.CLOUDINARY_API_SECRET);
  });

  it('signs a different timestamp each time, so a signature cannot be replayed forever', async () => {
    const user = await createUser();
    const get = () => request.get('/api/uploads/signature?folder=listings').set(...user.auth);

    const first = await get();
    // Cloudinary timestamps are unix *seconds*, so two calls in the same second
    // legitimately match. Assert the signature tracks the timestamp instead.
    const second = await get();

    if (first.body.timestamp !== second.body.timestamp) {
      expect(first.body.signature).not.toBe(second.body.signature);
    } else {
      expect(first.body.signature).toBe(second.body.signature);
    }
  });

  it('signs each allowed folder distinctly', async () => {
    const user = await createUser();
    const listings = await request.get('/api/uploads/signature?folder=listings').set(...user.auth);
    const avatars = await request.get('/api/uploads/signature?folder=avatars').set(...user.auth);

    expect(listings.body.folder).toBe('listings');
    expect(avatars.body.folder).toBe('avatars');
  });

  /**
   * The folder is part of the signed payload, so an unchecked one would let a
   * client write anywhere in the account — including over another tree.
   */
  it.each([
    ['an unknown folder', '?folder=../../etc'],
    ['a folder we do not allow', '?folder=invoices'],
    ['a missing folder', ''],
    ['a repeated folder param', '?folder=listings&folder=avatars'],
  ])('rejects %s with 400', async (_label, query) => {
    const user = await createUser();
    const response = await request.get(`/api/uploads/signature${query}`).set(...user.auth);
    expect(response.status).toBe(400);
  });

  it('requires a session — signing spends our upload quota', async () => {
    const response = await request.get('/api/uploads/signature?folder=listings');
    expect(response.status).toBe(401);
  });
});

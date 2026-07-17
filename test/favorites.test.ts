import { beforeEach, describe, expect, it } from 'vitest';
import { createListing, createUser, request } from './helpers/api';
import { countRows, resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

describe('favorites', () => {
  it('requires authentication on every route', async () => {
    expect((await request.get('/api/favorites')).status).toBe(401);
    expect((await request.post('/api/favorites/1')).status).toBe(401);
    expect((await request.delete('/api/favorites/1')).status).toBe(401);
  });

  /**
   * The composite primary key (user_id, listing_id) plus ON CONFLICT DO NOTHING
   * make `add` idempotent at the storage layer. A double-clicked heart must
   * succeed twice, not 409 — and must not create two rows.
   */
  it('saving twice succeeds and creates one row', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);

    const first = await request.post(`/api/favorites/${listing.id}`).set(...buyer.auth);
    const second = await request.post(`/api/favorites/${listing.id}`).set(...buyer.auth);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await countRows('favorites')).toBe(1);
  });

  it('survives a burst of concurrent saves of the same listing', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request.post(`/api/favorites/${listing.id}`).set(...buyer.auth),
      ),
    );

    expect(results.every((r) => r.status === 204)).toBe(true);
    expect(await countRows('favorites')).toBe(1);
  });

  it('unsaving is idempotent, including for something never saved', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    await request.post(`/api/favorites/${listing.id}`).set(...buyer.auth);

    expect((await request.delete(`/api/favorites/${listing.id}`).set(...buyer.auth)).status).toBe(204);
    expect((await request.delete(`/api/favorites/${listing.id}`).set(...buyer.auth)).status).toBe(204);
    expect((await request.delete('/api/favorites/999999').set(...buyer.auth)).status).toBe(204);
  });

  it('404s when saving a listing that does not exist', async () => {
    const buyer = await createUser();
    expect((await request.post('/api/favorites/999999').set(...buyer.auth)).status).toBe(404);
  });

  it('400s on a non-numeric listing id', async () => {
    const buyer = await createUser();
    expect((await request.post('/api/favorites/abc').set(...buyer.auth)).status).toBe(400);
  });

  it('returns saves newest-first', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const first = await createListing(seller, { title: 'First' });
    const second = await createListing(seller, { title: 'Second' });

    await request.post(`/api/favorites/${first.id}`).set(...buyer.auth);
    await request.post(`/api/favorites/${second.id}`).set(...buyer.auth);

    const response = await request.get('/api/favorites').set(...buyer.auth);
    expect(response.body.map((l: { id: number }) => l.id)).toEqual([second.id, first.id]);
  });

  /**
   * Written to fail if either list is empty. The obvious version of this test —
   * "no id appears in both" — passes vacuously when one user has no favorites,
   * which is exactly how a broken isolation check looks.
   */
  it("keeps one user's favorites invisible to another", async () => {
    const seller = await createUser();
    const alice = await createUser();
    const bob = await createUser();
    const one = await createListing(seller, { title: 'One' });
    const two = await createListing(seller, { title: 'Two' });

    await request.post(`/api/favorites/${one.id}`).set(...alice.auth);
    await request.post(`/api/favorites/${two.id}`).set(...bob.auth);

    const aliceIds = (await request.get('/api/favorites').set(...alice.auth)).body.map(
      (l: { id: number }) => l.id,
    );
    const bobIds = (await request.get('/api/favorites').set(...bob.auth)).body.map(
      (l: { id: number }) => l.id,
    );

    expect(aliceIds).toEqual([one.id]);
    expect(bobIds).toEqual([two.id]);
    expect(aliceIds.some((id: number) => bobIds.includes(id))).toBe(false);
  });

  it('drops a removed listing from the saved list without erroring', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    await request.post(`/api/favorites/${listing.id}`).set(...buyer.auth);

    await request.delete(`/api/listings/${listing.id}`).set(...seller.auth);

    const response = await request.get('/api/favorites').set(...buyer.auth);
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(0);
    // The favorite row itself survives; it is filtered, not deleted.
    expect(await countRows('favorites')).toBe(1);
  });

  it('refuses to save a removed listing but allows unsaving one', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    await request.post(`/api/favorites/${listing.id}`).set(...buyer.auth);
    await request.delete(`/api/listings/${listing.id}`).set(...seller.auth);

    expect((await request.post(`/api/favorites/${listing.id}`).set(...buyer.auth)).status).toBe(404);
    // Cleaning up a stale favorite must not fail.
    expect((await request.delete(`/api/favorites/${listing.id}`).set(...buyer.auth)).status).toBe(204);
  });

  it('keeps sold and pending listings in the saved list', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const watcher = await createUser();
    const listing = await createListing(seller);
    await request.post(`/api/favorites/${listing.id}`).set(...watcher.auth);

    await request.post('/api/orders').set(...buyer.auth).send({ listing_id: listing.id });

    const response = await request.get('/api/favorites').set(...watcher.auth);
    expect(response.body).toHaveLength(1);
  });
});

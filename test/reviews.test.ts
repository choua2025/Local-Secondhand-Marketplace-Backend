import { beforeEach, describe, expect, it } from 'vitest';
import { completeOrder, createListing, createUser, request, type TestUser } from './helpers/api';
import { countRows, resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

async function review(
  reviewer: TestUser,
  orderId: number,
  rating: unknown,
  body?: string | null,
  extra: Record<string, unknown> = {},
) {
  return request
    .post('/api/reviews')
    .set(...reviewer.auth)
    .send({ order_id: orderId, rating, body: body ?? null, ...extra });
}

describe('POST /api/reviews', () => {
  it('requires authentication', async () => {
    expect((await request.post('/api/reviews').send({ order_id: 1, rating: 5 })).status).toBe(401);
  });

  it('lets the buyer review the seller once an order is completed', async () => {
    const seller = await createUser({ display_name: 'Sam Seller' });
    const buyer = await createUser({ display_name: 'Bea Buyer' });
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    const response = await review(buyer, orderId, 5, 'Exactly as described.');

    expect(response.status).toBe(201);
    expect(response.body.rating).toBe(5);
    expect(response.body.reviewer_name).toBe('Bea Buyer');
  });

  it('lets the seller review the buyer on the same order', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    expect((await review(buyer, orderId, 5)).status).toBe(201);
    expect((await review(seller, orderId, 4)).status).toBe(201);
    expect(await countRows('reviews')).toBe(2);
  });

  describe('the order must have concluded', () => {
    it.each(['pending', 'paid'] as const)('rejects a %s order with 400', async (target) => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);
      const placed = await request
        .post('/api/orders')
        .set(...buyer.auth)
        .send({ listing_id: listing.id });
      if (target === 'paid') {
        await request.patch(`/api/orders/${placed.body.id}`).set(...buyer.auth).send({ status: 'paid' });
      }

      const response = await review(buyer, placed.body.id, 5);
      expect(response.status).toBe(400);
    });

    it('rejects a cancelled order', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);
      const placed = await request
        .post('/api/orders')
        .set(...buyer.auth)
        .send({ listing_id: listing.id });
      await request.patch(`/api/orders/${placed.body.id}`).set(...buyer.auth).send({ status: 'cancelled' });

      expect((await review(buyer, placed.body.id, 5)).status).toBe(400);
    });

    /**
     * A refunded order stays reviewable. Excluding it would hand a seller an
     * eraser: refund the buyer, delete the bad review.
     */
    it('allows a refunded order', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);
      const orderId = await completeOrder(buyer, seller, listing.id);
      await request.patch(`/api/orders/${orderId}`).set(...seller.auth).send({ status: 'refunded' });

      expect((await review(buyer, orderId, 2, 'Refunded, but slow about it.')).status).toBe(201);
    });
  });

  it('404s for an order that does not exist', async () => {
    const user = await createUser();
    expect((await review(user, 999999, 5)).status).toBe(404);
  });

  /**
   * The anti-fake-review guarantee. A review hangs off an order, and the
   * reviewee is derived from that order — so reviewing someone you never traded
   * with is not blocked by a check, it is unrepresentable.
   */
  it('403s for someone who was not party to the order', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const stranger = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    expect((await review(stranger, orderId, 1)).status).toBe(403);
  });

  it('ignores a reviewee_id injected into the body', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const stranger = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    // The stranger tries to name themselves as reviewee to sneak in.
    expect((await review(stranger, orderId, 5, null, { reviewee_id: stranger.id })).status).toBe(403);

    // The buyer's review lands on the seller regardless of what they claim.
    await review(buyer, orderId, 5, null, { reviewee_id: stranger.id });
    const strangerProfile = await request.get(`/api/users/${stranger.id}/reviews`);
    const sellerProfile = await request.get(`/api/users/${seller.id}/reviews`);

    expect(strangerProfile.body.count).toBe(0);
    expect(sellerProfile.body.count).toBe(1);
  });

  /** UNIQUE (order_id, reviewer_id) — enforced by the database, translated to 409. */
  it('409s on a second review of the same order by the same person', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    expect((await review(buyer, orderId, 5)).status).toBe(201);
    expect((await review(buyer, orderId, 1)).status).toBe(409);
    expect(await countRows('reviews')).toBe(1);
  });

  it('lets only one of five simultaneous duplicate reviews through', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    const results = await Promise.all(Array.from({ length: 5 }, () => review(buyer, orderId, 5)));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.some((r) => r.status >= 500)).toBe(false);
    expect(await countRows('reviews')).toBe(1);
  });

  it.each([0, 6, 3.5, -1, 'five', null])('rejects rating %s with 400', async (rating) => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    expect((await review(buyer, orderId, rating)).status).toBe(400);
  });

  it('accepts a review with no body', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    const response = await review(buyer, orderId, 3);
    expect(response.status).toBe(201);
    expect(response.body.body).toBeNull();
  });

  it('rejects a body over 1000 characters', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    expect((await review(buyer, orderId, 5, 'x'.repeat(1001))).status).toBe(400);
  });
});

describe('GET /api/users/:id/reviews', () => {
  it('is public — no token required', async () => {
    const seller = await createUser();
    expect((await request.get(`/api/users/${seller.id}/reviews`)).status).toBe(200);
  });

  it('returns null average for a user who has never been reviewed', async () => {
    const user = await createUser();
    const response = await request.get(`/api/users/${user.id}/reviews`);

    // null, not 0 — zero would render as a one-star seller.
    expect(response.body.average).toBeNull();
    expect(response.body.count).toBe(0);
    expect(response.body.reviews).toEqual([]);
  });

  it('returns an empty profile for a nonexistent user rather than 404', async () => {
    const response = await request.get('/api/users/999999/reviews');
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(0);
  });

  it('averages the ratings', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const first = await createListing(seller);
    const second = await createListing(seller);

    await review(buyer, await completeOrder(buyer, seller, first.id), 5);
    await review(buyer, await completeOrder(buyer, seller, second.id), 3);

    const response = await request.get(`/api/users/${seller.id}/reviews`);
    expect(response.body.count).toBe(2);
    expect(response.body.average).toBe(4);
  });

  it('keeps each person\'s rating separate', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    await review(buyer, orderId, 5); // buyer rates seller 5
    await review(seller, orderId, 2); // seller rates buyer 2

    expect((await request.get(`/api/users/${seller.id}/reviews`)).body.average).toBe(5);
    expect((await request.get(`/api/users/${buyer.id}/reviews`)).body.average).toBe(2);
  });

  it('never leaks reviewee_id in the payload', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    await review(buyer, await completeOrder(buyer, seller, listing.id), 5, 'Great');

    const response = await request.get(`/api/users/${seller.id}/reviews`);
    expect(JSON.stringify(response.body)).not.toContain('reviewee');
  });

  it('400s on a non-numeric user id', async () => {
    expect((await request.get('/api/users/abc/reviews')).status).toBe(400);
  });
});

describe('ratings on listings', () => {
  it("surfaces the seller's average on the listing detail and browse card", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const sold = await createListing(seller);
    const stillForSale = await createListing(seller);

    await review(buyer, await completeOrder(buyer, seller, sold.id), 4);

    const detail = await request.get(`/api/listings/${stillForSale.id}`);
    expect(detail.body.seller.rating_average).toBe(4);
    expect(detail.body.seller.rating_count).toBe(1);

    const browse = await request.get('/api/listings');
    expect(browse.body.items[0].seller.rating_average).toBe(4);
  });
});

describe('GET /api/orders — reviewed_by_me', () => {
  it('flags orders the caller has already reviewed', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    const before = (await request.get('/api/orders').set(...buyer.auth)).body[0];
    expect(before.reviewed_by_me).toBe(false);

    await review(buyer, orderId, 5);

    const after = (await request.get('/api/orders').set(...buyer.auth)).body[0];
    const sellerView = (await request.get('/api/orders').set(...seller.auth)).body[0];

    expect(after.reviewed_by_me).toBe(true);
    // The seller has not reviewed yet, so the same order reads false for them.
    expect(sellerView.reviewed_by_me).toBe(false);
  });
});

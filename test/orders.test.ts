import { beforeEach, describe, expect, it } from 'vitest';
import { completeOrder, createListing, createUser, request, type TestUser } from './helpers/api';
import { countRows, listingStatus, resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

async function place(buyer: TestUser, listingId: number) {
  return request.post('/api/orders').set(...buyer.auth).send({ listing_id: listingId });
}

async function move(user: TestUser, orderId: number, status: string) {
  return request.patch(`/api/orders/${orderId}`).set(...user.auth).send({ status });
}

describe('POST /api/orders', () => {
  it('requires authentication', async () => {
    expect((await request.post('/api/orders').send({ listing_id: 1 })).status).toBe(401);
  });

  it('places an order and flips the listing to pending', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller, { price: '180.00' });

    const response = await place(buyer, listing.id);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
    expect(await listingStatus(listing.id)).toBe('pending');
  });

  /** amount is a snapshot; later price edits must not rewrite history. */
  it('snapshots the price at purchase time', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller, { price: '180.00' });

    const order = await place(buyer, listing.id);
    expect(order.body.amount).toBe('180.00');

    await request.patch(`/api/listings/${listing.id}`).set(...seller.auth).send({ price: '999.00' });

    const orders = await request.get('/api/orders').set(...buyer.auth);
    expect(orders.body[0].amount).toBe('180.00');
  });

  it('404s for a missing listing', async () => {
    const buyer = await createUser();
    expect((await place(buyer, 999999)).status).toBe(404);
  });

  it('rejects buying your own listing, and leaves the listing active', async () => {
    const seller = await createUser();
    const listing = await createListing(seller);

    const response = await place(seller, listing.id);

    expect(response.status).toBe(400);
    // The guarded UPDATE fires before the self-purchase check, so this asserts
    // the transaction rolled the claim back.
    expect(await listingStatus(listing.id)).toBe('active');
    expect(await countRows('orders')).toBe(0);
  });

  it('409s when the listing is already pending', async () => {
    const seller = await createUser();
    const first = await createUser();
    const second = await createUser();
    const listing = await createListing(seller);

    expect((await place(first, listing.id)).status).toBe(201);
    expect((await place(second, listing.id)).status).toBe(409);
  });

  /**
   * The race. `place` does not read the status and then write it — it runs
   * `UPDATE listings SET status='pending' WHERE id=$1 AND status='active'` and
   * treats zero matched rows as a conflict. Postgres serializes the twenty
   * transactions on the row lock, so exactly one can match.
   *
   * A check-then-write implementation passes every other test in this file and
   * fails only this one.
   */
  it('lets exactly one of twenty simultaneous buyers win', async () => {
    const seller = await createUser();
    const buyers = await Promise.all(Array.from({ length: 4 }, () => createUser()));
    const listing = await createListing(seller);

    const attempts = Array.from({ length: 20 }, (_, i) => place(buyers[i % buyers.length]!, listing.id));
    const results = await Promise.all(attempts);

    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(19);
    expect(results.some((r) => r.status >= 500)).toBe(false);
    expect(await countRows('orders')).toBe(1);
    expect(await listingStatus(listing.id)).toBe('pending');
  });
});

describe('PATCH /api/orders/:id — the transition table', () => {
  it('403s for someone who is not party to the order', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const stranger = await createUser();
    const listing = await createListing(seller);
    const order = await place(buyer, listing.id);

    expect((await move(stranger, order.body.id, 'paid')).status).toBe(403);
  });

  it('only the buyer may mark an order paid', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const order = await place(buyer, listing.id);

    expect((await move(seller, order.body.id, 'paid')).status).toBe(403);
    expect((await move(buyer, order.body.id, 'paid')).status).toBe(200);
  });

  /**
   * Completing flips the listing to 'sold'. A buyer who could do it alone could
   * close a sale the seller never agreed had happened.
   */
  it('only the seller may mark an order completed', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const order = await place(buyer, listing.id);
    await move(buyer, order.body.id, 'paid');

    expect((await move(buyer, order.body.id, 'completed')).status).toBe(403);

    const completed = await move(seller, order.body.id, 'completed');
    expect(completed.status).toBe(200);
    expect(completed.body.completed_at).not.toBeNull();
    expect(await listingStatus(listing.id)).toBe('sold');
  });

  it('rejects an illegal jump from pending straight to completed', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const order = await place(buyer, listing.id);

    expect((await move(seller, order.body.id, 'completed')).status).toBe(400);
  });

  it('rejects a status that is not in the enum', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const order = await place(buyer, listing.id);

    expect((await move(buyer, order.body.id, 'banana')).status).toBe(400);
  });

  it('404s for a missing order', async () => {
    const user = await createUser();
    expect((await move(user, 999999, 'paid')).status).toBe(404);
  });

  /**
   * The spec never said what happens to the listing when an order is cancelled.
   * Without returning it to 'active' the item is frozen at 'pending' forever,
   * unbuyable by anyone.
   */
  it.each(['pending', 'paid'] as const)(
    'cancelling from %s returns the listing to active and it can be bought again',
    async (from) => {
      const seller = await createUser();
      const buyer = await createUser();
      const other = await createUser();
      const listing = await createListing(seller);
      const order = await place(buyer, listing.id);
      if (from === 'paid') await move(buyer, order.body.id, 'paid');

      expect((await move(buyer, order.body.id, 'cancelled')).status).toBe(200);
      expect(await listingStatus(listing.id)).toBe('active');
      expect((await place(other, listing.id)).status).toBe(201);
    },
  );

  it('lets either party cancel', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const order = await place(buyer, listing.id);

    expect((await move(seller, order.body.id, 'cancelled')).status).toBe(200);
  });

  it('only the seller may refund, and refunding un-sells the listing', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    expect((await move(buyer, orderId, 'refunded')).status).toBe(403);
    expect((await move(seller, orderId, 'refunded')).status).toBe(200);
    expect(await listingStatus(listing.id)).toBe('active');
  });

  it('refuses to replay a transition after the order has moved on', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const orderId = await completeOrder(buyer, seller, listing.id);

    expect((await move(buyer, orderId, 'paid')).status).toBe(400);
  });

  /** Guarded on the status we read, so two concurrent PATCHes cannot both apply. */
  it('applies exactly one of five simultaneous identical transitions', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    const order = await place(buyer, listing.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => move(buyer, order.body.id, 'paid')),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.some((r) => r.status >= 500)).toBe(false);

    const orders = await request.get('/api/orders').set(...buyer.auth);
    expect(orders.body[0].status).toBe('paid');
  });
});

describe('GET /api/orders', () => {
  it('requires authentication', async () => {
    expect((await request.get('/api/orders')).status).toBe(401);
  });

  /**
   * The spec returned only the buyer's orders — but the seller is the only one
   * allowed to mark an order completed, so without this they cannot reach the
   * button they alone may press.
   */
  it('shows both sides of a trade, tagged with the caller\'s role', async () => {
    const seller = await createUser({ display_name: 'Sam Seller' });
    const buyer = await createUser({ display_name: 'Bea Buyer' });
    const listing = await createListing(seller, { title: 'Widget' });
    await place(buyer, listing.id);

    const buyerView = (await request.get('/api/orders').set(...buyer.auth)).body[0];
    const sellerView = (await request.get('/api/orders').set(...seller.auth)).body[0];

    expect(buyerView.role).toBe('buyer');
    expect(buyerView.counterparty_name).toBe('Sam Seller');
    expect(sellerView.role).toBe('seller');
    expect(sellerView.counterparty_name).toBe('Bea Buyer');
    expect(buyerView.listing_title).toBe('Widget');
  });

  it('hides orders from unrelated users', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const stranger = await createUser();
    const listing = await createListing(seller);
    await place(buyer, listing.id);

    expect((await request.get('/api/orders').set(...stranger.auth)).body).toHaveLength(0);
  });
});

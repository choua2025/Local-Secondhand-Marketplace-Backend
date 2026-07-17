import { beforeEach, describe, expect, it } from 'vitest';
import { createListing, createUser, request, type TestUser } from './helpers/api';
import { resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

async function send(from: TestUser, to: TestUser, listingId: number, body: string) {
  return request
    .post('/api/messages')
    .set(...from.auth)
    .send({ recipient_id: to.id, listing_id: listingId, body });
}

async function unread(user: TestUser): Promise<number> {
  return (await request.get('/api/messages/unread-count').set(...user.auth)).body.count;
}

describe('messages', () => {
  it('requires authentication on every route', async () => {
    expect((await request.get('/api/messages?listingId=1&otherUserId=2')).status).toBe(401);
    expect((await request.post('/api/messages').send({})).status).toBe(401);
    expect((await request.get('/api/messages/threads')).status).toBe(401);
    expect((await request.get('/api/messages/unread-count')).status).toBe(401);
  });

  describe('POST /api/messages', () => {
    it('sends a message, unread by default', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      const response = await send(buyer, seller, listing.id, 'Is this available?');

      expect(response.status).toBe(201);
      expect(response.body.is_read).toBe(false);
      expect(response.body.body).toBe('Is this available?');
    });

    it('trims the body and rejects one that is empty after trimming', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      expect((await send(buyer, seller, listing.id, '   ')).status).toBe(400);
      expect((await send(buyer, seller, listing.id, '  hi  ')).body.body).toBe('hi');
    });

    it('rejects a body over 2000 characters', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      expect((await send(buyer, seller, listing.id, 'x'.repeat(2001))).status).toBe(400);
      expect((await send(buyer, seller, listing.id, 'x'.repeat(2000))).status).toBe(201);
    });

    /** The DB's CHECK (sender_id <> recipient_id) would 500; the service says why. */
    it('rejects messaging yourself with 400', async () => {
      const seller = await createUser();
      const listing = await createListing(seller);

      const response = await request
        .post('/api/messages')
        .set(...seller.auth)
        .send({ recipient_id: seller.id, listing_id: listing.id, body: 'hi' });

      expect(response.status).toBe(400);
    });

    it('404s for a missing or removed listing', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      expect((await send(buyer, seller, 999999, 'hi')).status).toBe(404);

      await request.delete(`/api/listings/${listing.id}`).set(...seller.auth);
      expect((await send(buyer, seller, listing.id, 'hi')).status).toBe(404);
    });

    it('requires a listing_id', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const response = await request
        .post('/api/messages')
        .set(...buyer.auth)
        .send({ recipient_id: seller.id, body: 'hi' });
      expect(response.status).toBe(400);
    });

    /**
     * Without this, `listing_id` is just a pretext: any user could message any
     * other by naming a listing neither has anything to do with.
     */
    it('requires one party to be the seller of the listing', async () => {
      const seller = await createUser();
      const alice = await createUser();
      const bob = await createUser();
      const listing = await createListing(seller);

      const response = await send(alice, bob, listing.id, 'hi');
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/seller/i);
    });

    it('lets the seller message a buyer back', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      expect((await send(buyer, seller, listing.id, 'hi')).status).toBe(201);
      expect((await send(seller, buyer, listing.id, 'hello')).status).toBe(201);
    });
  });

  describe('GET /api/messages (one thread)', () => {
    it('is symmetric: both participants see the same messages, oldest first', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      await send(buyer, seller, listing.id, 'first');
      await send(seller, buyer, listing.id, 'second');
      await send(buyer, seller, listing.id, 'third');

      const buyerView = await request
        .get(`/api/messages?listingId=${listing.id}&otherUserId=${seller.id}`)
        .set(...buyer.auth);
      const sellerView = await request
        .get(`/api/messages?listingId=${listing.id}&otherUserId=${buyer.id}`)
        .set(...seller.auth);

      expect(buyerView.body.map((m: { body: string }) => m.body)).toEqual([
        'first',
        'second',
        'third',
      ]);
      expect(sellerView.body.map((m: { id: number }) => m.id)).toEqual(
        buyerView.body.map((m: { id: number }) => m.id),
      );
    });

    /**
     * Every message query has the caller's id in its WHERE clause, so there is
     * no way to phrase "someone else's thread". An outsider gets an empty array
     * rather than a 403 — which would confirm the thread exists.
     */
    it('shows an outsider nothing', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const outsider = await createUser();
      const listing = await createListing(seller);
      await send(buyer, seller, listing.id, 'private');

      const response = await request
        .get(`/api/messages?listingId=${listing.id}&otherUserId=${seller.id}`)
        .set(...outsider.auth);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });

    it('scopes a thread to one listing', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const one = await createListing(seller, { title: 'One' });
      const two = await createListing(seller, { title: 'Two' });

      await send(buyer, seller, one.id, 'about one');
      await send(buyer, seller, two.id, 'about two');

      const response = await request
        .get(`/api/messages?listingId=${one.id}&otherUserId=${seller.id}`)
        .set(...buyer.auth);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].body).toBe('about one');
    });

    it('400s without the required query params', async () => {
      const user = await createUser();
      expect((await request.get('/api/messages').set(...user.auth)).status).toBe(400);
      expect((await request.get('/api/messages?listingId=1').set(...user.auth)).status).toBe(400);
    });
  });

  describe('unread count and mark-as-read', () => {
    it('counts only messages addressed to you', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      await send(buyer, seller, listing.id, 'one');
      await send(buyer, seller, listing.id, 'two');

      expect(await unread(seller)).toBe(2);
      // Your own sent messages are never unread for you.
      expect(await unread(buyer)).toBe(0);
    });

    it('marks the other person\'s messages read, and only those', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);

      await send(buyer, seller, listing.id, 'buyer one');
      await send(buyer, seller, listing.id, 'buyer two');
      await send(seller, buyer, listing.id, 'seller reply');

      const marked = await request
        .post('/api/messages/read')
        .set(...seller.auth)
        .send({ listing_id: listing.id, other_user_id: buyer.id });

      expect(marked.body.marked_read).toBe(2);
      expect(await unread(seller)).toBe(0);
      // The seller's own reply to the buyer is still unread for the buyer.
      expect(await unread(buyer)).toBe(1);
    });

    /**
     * markRead's WHERE has `recipient_id = $caller`. Without it, anyone could
     * clear the other person's unread badge by marking their own sent messages.
     */
    it('cannot mark your own sent messages as read on the recipient\'s behalf', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);
      await send(buyer, seller, listing.id, 'one');
      await send(buyer, seller, listing.id, 'two');

      // The buyer tries to mark the thread read. Nothing in it is addressed to them.
      const marked = await request
        .post('/api/messages/read')
        .set(...buyer.auth)
        .send({ listing_id: listing.id, other_user_id: seller.id });

      expect(marked.body.marked_read).toBe(0);
      expect(await unread(seller)).toBe(2);
    });
  });

  describe('GET /api/messages/threads', () => {
    it('groups by (listing, other user) and shows the latest message', async () => {
      const seller = await createUser({ display_name: 'Sam' });
      const buyer = await createUser({ display_name: 'Bea' });
      const one = await createListing(seller, { title: 'One' });
      const two = await createListing(seller, { title: 'Two' });

      await send(buyer, seller, one.id, 'about one, first');
      await send(buyer, seller, one.id, 'about one, latest');
      await send(buyer, seller, two.id, 'about two');

      const threads = (await request.get('/api/messages/threads').set(...seller.auth)).body;

      expect(threads).toHaveLength(2);
      const first = threads.find((t: { listing_id: number }) => t.listing_id === one.id);
      expect(first.last_message_body).toBe('about one, latest');
      expect(first.other_user_name).toBe('Bea');
      expect(first.listing_title).toBe('One');
      expect(first.unread_count).toBe(2);
      expect(first.last_message_mine).toBe(false);
    });

    it('orders threads by most recent activity', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const one = await createListing(seller, { title: 'One' });
      const two = await createListing(seller, { title: 'Two' });

      await send(buyer, seller, one.id, 'older');
      await send(buyer, seller, two.id, 'newer');

      const threads = (await request.get('/api/messages/threads').set(...seller.auth)).body;
      expect(threads[0].listing_id).toBe(two.id);
    });

    it('flags a thread whose last message is your own', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const listing = await createListing(seller);
      await send(buyer, seller, listing.id, 'question');
      await send(seller, buyer, listing.id, 'answer');

      const threads = (await request.get('/api/messages/threads').set(...seller.auth)).body;
      expect(threads[0].last_message_mine).toBe(true);

      // Replying does not mark the incoming message read — only opening the
      // thread does. The seller answered without ever clearing the question.
      expect(threads[0].unread_count).toBe(1);

      await request
        .post('/api/messages/read')
        .set(...seller.auth)
        .send({ listing_id: listing.id, other_user_id: buyer.id });

      const afterReading = (await request.get('/api/messages/threads').set(...seller.auth)).body;
      expect(afterReading[0].unread_count).toBe(0);
    });

    it('shows an uninvolved user no threads', async () => {
      const seller = await createUser();
      const buyer = await createUser();
      const outsider = await createUser();
      const listing = await createListing(seller);
      await send(buyer, seller, listing.id, 'hi');

      expect((await request.get('/api/messages/threads').set(...outsider.auth)).body).toHaveLength(0);
    });
  });
});

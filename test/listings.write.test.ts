import { beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createListing, createUser, request } from './helpers/api';
import { countRows, listingStatus, resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

describe('POST /api/listings', () => {
  it('requires authentication', async () => {
    const response = await request
      .post('/api/listings')
      .send({ title: 'x', price: '1.00', condition: 'good' });
    expect(response.status).toBe(401);
  });

  it("copies the seller's city onto the listing", async () => {
    const seller = await createUser({ city: 'Seattle' });
    const { body } = await createListing(seller);
    expect(body.city).toBe('Seattle');
  });

  it('stores images with incrementing positions, cover first', async () => {
    const seller = await createUser();
    const { body } = await createListing(seller, {
      image_urls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    });
    expect((body.images as { position: number; url: string }[]).map((i) => i.position)).toEqual([0, 1]);
  });

  it('starts a listing as active', async () => {
    const seller = await createUser();
    const { body } = await createListing(seller);
    expect(body.status).toBe('active');
  });

  describe('price validation', () => {
    /**
     * The whole point of NUMERIC(10,2): money never becomes a binary float.
     * The string is validated by regex and handed to Postgres unparsed.
     */
    it.each([
      ['19.99', '19.99'],
      ['0.1', '0.10'],
      ['0', '0.00'],
      ['99999999.99', '99999999.99'],
    ])('accepts %s and stores it as %s', async (input, stored) => {
      const seller = await createUser();
      const { body } = await createListing(seller, { price: input });
      expect(body.price).toBe(stored);
    });

    it.each([
      '19.999', // too many decimals
      '-5', // negative
      '1e3', // scientific notation
      'abc',
      '', //
      '999999999.00', // 9 integer digits; NUMERIC(10,2) allows 8
    ])('rejects price %s with 400', async (price) => {
      const seller = await createUser();
      const response = await request
        .post('/api/listings')
        .set(...seller.auth)
        .send({ title: 't', price, condition: 'good', image_urls: [] });
      expect(response.status).toBe(400);
    });
  });

  it.each([
    ['empty title', { title: '   ', price: '1.00', condition: 'good' }],
    ['bad condition', { title: 't', price: '1.00', condition: 'mint' }],
    ['nine images', { title: 't', price: '1.00', condition: 'good', image_urls: Array(9).fill('https://x.com/a.png') }],
  ])('rejects %s with 400', async (_label, body) => {
    const seller = await createUser();
    const response = await request.post('/api/listings').set(...seller.auth).send(body);
    expect(response.status).toBe(400);
  });

  /** A `javascript:` URL rendered into an <img src> is a stored-XSS vector. */
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://x/a.png'])(
    'rejects image URL %s',
    async (url) => {
      const seller = await createUser();
      const response = await request
        .post('/api/listings')
        .set(...seller.auth)
        .send({ title: 't', price: '1.00', condition: 'good', image_urls: [url] });
      expect(response.status).toBe(400);
    },
  );

  /**
   * A nonexistent category_id used to surface as a 500: the foreign key raised
   * SQLSTATE 23503 and nothing translated it.
   */
  it('rejects a nonexistent category with 400, not 500', async () => {
    const seller = await createUser();
    const response = await request
      .post('/api/listings')
      .set(...seller.auth)
      .send({ title: 't', price: '1.00', condition: 'good', category_id: 99999, image_urls: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/category/i);
  });

  /**
   * create() inserts the listing and every image inside one transaction. When
   * the listing insert fails on the FK, nothing may survive.
   */
  it('rolls back completely when the insert fails, leaving no orphan', async () => {
    const seller = await createUser();
    const before = await countRows('listings');

    await request
      .post('/api/listings')
      .set(...seller.auth)
      .send({
        title: 'ghost',
        price: '1.00',
        condition: 'good',
        category_id: 99999,
        image_urls: ['https://example.com/a.jpg'],
      });

    expect(await countRows('listings')).toBe(before);
    expect(await countRows('listing_images')).toBe(0);
  });
});

describe('PATCH /api/listings/:id', () => {
  it('updates only the fields that were sent', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { title: 'Original', price: '10.00' });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ price: '12.50' });

    expect(response.status).toBe(200);
    expect(response.body.price).toBe('12.50');
    expect(response.body.title).toBe('Original');
  });

  /**
   * seller_id and status are not in the repository's allow-list, so they are
   * unreachable from this code path by construction rather than convention.
   */
  it('ignores seller_id and status in the body', async () => {
    const seller = await createUser();
    const other = await createUser();
    const listing = await createListing(seller);

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ seller_id: other.id, status: 'sold', title: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body.seller.id).toBe(seller.id);
    expect(response.body.status).toBe('active');
    expect(response.body.title).toBe('Renamed');
  });

  it("403s when someone else's listing", async () => {
    const seller = await createUser();
    const stranger = await createUser();
    const listing = await createListing(seller);

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...stranger.auth)
      .send({ price: '1.00' });

    expect(response.status).toBe(403);
  });

  it('404s for a missing listing', async () => {
    const seller = await createUser();
    const response = await request
      .patch('/api/listings/999999')
      .set(...seller.auth)
      .send({ price: '1.00' });
    expect(response.status).toBe(404);
  });

  it('validates the new price', async () => {
    const seller = await createUser();
    const listing = await createListing(seller);
    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ price: '1.999' });
    expect(response.status).toBe(400);
  });

  it('rejects a nonexistent category with 400', async () => {
    const seller = await createUser();
    const listing = await createListing(seller);
    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ category_id: 99999 });
    expect(response.status).toBe(400);
  });

  it('accepts a real category', async () => {
    const seller = await createUser();
    const listing = await createListing(seller);
    const bikes = await createCategory('Bikes', 'bikes');

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ category_id: bikes });

    expect(response.status).toBe(200);
    expect(response.body.category.slug).toBe('bikes');
  });
});

describe('DELETE /api/listings/:id', () => {
  it('403s for a non-owner', async () => {
    const seller = await createUser();
    const stranger = await createUser();
    const listing = await createListing(seller);

    expect((await request.delete(`/api/listings/${listing.id}`).set(...stranger.auth)).status).toBe(403);
  });

  /**
   * Soft delete, never a DELETE: orders and reviews hold foreign keys into the
   * row, and a sale that happened stays a fact.
   */
  it('soft-deletes, leaving the row and its images in the database', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, {
      image_urls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    });

    const response = await request.delete(`/api/listings/${listing.id}`).set(...seller.auth);

    expect(response.status).toBe(204);
    expect(await listingStatus(listing.id)).toBe('removed');
    expect(await countRows('listings')).toBe(1);
    expect(await countRows('listing_images')).toBe(2);
  });
});

describe('GET /api/listings/mine', () => {
  it('is not swallowed by the /:id route', async () => {
    const seller = await createUser();
    const response = await request.get('/api/listings/mine').set(...seller.auth);
    expect(response.status).toBe(200);
  });

  it('requires authentication', async () => {
    expect((await request.get('/api/listings/mine')).status).toBe(401);
  });

  it('shows the seller their own non-active listings, which browse hides', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    await request.post('/api/orders').set(...buyer.auth).send({ listing_id: listing.id });

    const browse = await request.get('/api/listings');
    const mine = await request.get('/api/listings/mine').set(...seller.auth);

    expect(browse.body.items).toHaveLength(0);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].status).toBe('pending');
  });

  it("never shows another seller's listings", async () => {
    const seller = await createUser();
    const stranger = await createUser();
    await createListing(seller);

    expect((await request.get('/api/listings/mine').set(...stranger.auth)).body).toHaveLength(0);
  });

  it('excludes removed listings', async () => {
    const seller = await createUser();
    const listing = await createListing(seller);
    await request.delete(`/api/listings/${listing.id}`).set(...seller.auth);

    expect((await request.get('/api/listings/mine').set(...seller.auth)).body).toHaveLength(0);
  });
});

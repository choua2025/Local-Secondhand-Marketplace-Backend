import { beforeEach, describe, expect, it } from 'vitest';
import {
  backdateListing,
  createCategory,
  createListing,
  createUser,
  request,
  type TestUser,
} from './helpers/api';
import { resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

describe('GET /api/listings', () => {
  it('returns only active listings, newest first', async () => {
    const seller = await createUser();
    const older = await createListing(seller, { title: 'Older' });
    const newer = await createListing(seller, { title: 'Newer' });
    await backdateListing(older.id, 2);

    const response = await request.get('/api/listings');

    expect(response.status).toBe(200);
    expect(response.body.items.map((i: { id: number }) => i.id)).toEqual([newer.id, older.id]);
  });

  it('hides removed listings', async () => {
    const seller = await createUser();
    const listing = await createListing(seller);
    await request.delete(`/api/listings/${listing.id}`).set(...seller.auth);

    const response = await request.get('/api/listings');
    expect(response.body.items).toHaveLength(0);
  });

  it('hides pending and sold listings', async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const listing = await createListing(seller);
    await request.post('/api/orders').set(...buyer.auth).send({ listing_id: listing.id });

    const response = await request.get('/api/listings');
    expect(response.body.items).toHaveLength(0);
  });

  it('includes the cover image and the seller', async () => {
    const seller = await createUser({ display_name: 'Sam Seller' });
    await createListing(seller, {
      image_urls: ['https://example.com/cover.jpg', 'https://example.com/second.jpg'],
    });

    const [item] = (await request.get('/api/listings')).body.items;
    expect(item.cover_image_url).toBe('https://example.com/cover.jpg');
    expect(item.seller.display_name).toBe('Sam Seller');
    expect(item.seller.rating_average).toBeNull();
    expect(item.seller.rating_count).toBe(0);
  });

  it('returns price as a string, never a float', async () => {
    const seller = await createUser();
    await createListing(seller, { price: '19.99' });

    const [item] = (await request.get('/api/listings')).body.items;
    expect(item.price).toBe('19.99');
    expect(typeof item.price).toBe('string');
  });

  describe('filters', () => {
    async function seedTree(): Promise<TestUser> {
      const portland = await createUser({ city: 'Portland' });
      const seattle = await createUser({ city: 'Seattle' });

      const electronics = await createCategory('Electronics', 'electronics');
      const phones = await createCategory('Phones', 'phones', electronics);
      const iphone = await createCategory('iPhone', 'iphone', phones);
      const bikes = await createCategory('Bikes', 'bikes');

      await createListing(portland, { title: 'iPhone 12', category_id: iphone });
      await createListing(portland, { title: 'Pixel 7', category_id: phones });
      await createListing(seattle, { title: 'Surly bike', category_id: bikes });
      return portland;
    }

    it('filters by exact city', async () => {
      await seedTree();
      const response = await request.get('/api/listings?city=Seattle');
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].title).toBe('Surly bike');
    });

    /** The recursive CTE: "electronics" must reach its grandchildren. */
    it('filters by category slug including descendants', async () => {
      await seedTree();

      const electronics = await request.get('/api/listings?category=electronics');
      expect(electronics.body.items).toHaveLength(2);

      const leaf = await request.get('/api/listings?category=iphone');
      expect(leaf.body.items).toHaveLength(1);
      expect(leaf.body.items[0].title).toBe('iPhone 12');
    });

    it('matches the title case-insensitively', async () => {
      await seedTree();
      const response = await request.get('/api/listings?q=IPHONE');
      expect(response.body.items).toHaveLength(1);
    });

    /**
     * `%` and `_` are LIKE wildcards. Unescaped, a search for "%" matches every
     * listing instead of none — the classic version of this bug.
     */
    it.each(['%', '_', '%%'])('treats %s as a literal, not a wildcard', async (query) => {
      await seedTree();
      const response = await request.get(`/api/listings?q=${encodeURIComponent(query)}`);
      expect(response.body.items).toHaveLength(0);
    });

    it('returns an empty page for an unknown category rather than erroring', async () => {
      await seedTree();
      const response = await request.get('/api/listings?category=does-not-exist');
      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(0);
    });

    it.each(['0', 'abc', '2abc', '-1'])('rejects page=%s with 400', async (page) => {
      const response = await request.get(`/api/listings?page=${page}`);
      expect(response.status).toBe(400);
    });

    it('rejects a repeated query parameter rather than silently picking one', async () => {
      const response = await request.get('/api/listings?city=a&city=b');
      expect(response.status).toBe(400);
    });
  });

  describe('pagination', () => {
    /**
     * The bug this guards: created_at is not unique, and every row inserted in
     * one transaction shares a timestamp. Ties make ORDER BY non-deterministic,
     * so rows can repeat or vanish between pages. (created_at DESC, id DESC) is
     * a total order.
     */
    it('never repeats or drops a row across pages, even with identical timestamps', async () => {
      const seller = await createUser();
      const created: number[] = [];
      for (let i = 0; i < 25; i += 1) {
        created.push((await createListing(seller, { title: `Item ${i}` })).id);
      }

      // Force every listing to share one created_at — the pathological case.
      const { pool } = await import('../src/db');
      await pool.query(`UPDATE listings SET created_at = now()`);

      const page1 = await request.get('/api/listings?page=1');
      const page2 = await request.get('/api/listings?page=2');

      expect(page1.body.items).toHaveLength(20);
      expect(page1.body.hasMore).toBe(true);
      expect(page2.body.items).toHaveLength(5);
      expect(page2.body.hasMore).toBe(false);

      const ids = (response: { body: { items: { id: number }[] } }): number[] =>
        response.body.items.map((item) => item.id);

      /**
       * The exact sequence matters, not just the set.
       *
       * With every created_at equal, the only thing imposing an order is the
       * `id DESC` tiebreaker, so page 1 must be ids 25..6 and page 2 must be
       * 5..1. Assert on the set alone and this test passes even with the
       * tiebreaker removed — Postgres happens to return heap order for both
       * pages, and the union still covers all 25 rows. That is precisely the
       * bug hiding from a weak assertion: the sort is arbitrary, and nothing
       * promises the two pages were sorted the same way.
       */
      const descending = [...created].sort((a, b) => b - a);
      expect(ids(page1)).toEqual(descending.slice(0, 20));
      expect(ids(page2)).toEqual(descending.slice(20));

      const seen = [...ids(page1), ...ids(page2)];
      expect(new Set(seen).size).toBe(25);
    });

    it('returns an empty page past the end', async () => {
      const response = await request.get('/api/listings?page=99');
      expect(response.body.items).toEqual([]);
      expect(response.body.hasMore).toBe(false);
    });
  });
});

describe('GET /api/listings/:id', () => {
  it('returns all images in cover-first order, plus seller and category', async () => {
    const seller = await createUser({ display_name: 'Cat Owner' });
    const category = await createCategory('Bikes', 'bikes');
    const listing = await createListing(seller, {
      category_id: category,
      image_urls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
    });

    const response = await request.get(`/api/listings/${listing.id}`);

    expect(response.status).toBe(200);
    expect(response.body.images.map((i: { position: number }) => i.position)).toEqual([0, 1]);
    expect(response.body.seller.display_name).toBe('Cat Owner');
    expect(response.body.category.slug).toBe('bikes');
  });

  it('404s for a missing listing', async () => {
    expect((await request.get('/api/listings/999999')).status).toBe(404);
  });

  it('404s for a removed listing', async () => {
    const seller = await createUser();
    const listing = await createListing(seller);
    await request.delete(`/api/listings/${listing.id}`).set(...seller.auth);

    expect((await request.get(`/api/listings/${listing.id}`)).status).toBe(404);
  });

  it('400s for a non-numeric id', async () => {
    expect((await request.get('/api/listings/abc')).status).toBe(400);
  });
});

describe('GET /api/listings/cities', () => {
  /** Declared before '/:id' in the router; otherwise it binds id="cities". */
  it('is not swallowed by the /:id route', async () => {
    const seller = await createUser({ city: 'Portland' });
    await createListing(seller);

    const response = await request.get('/api/listings/cities');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(['Portland']);
  });

  it('lists only cities with an active listing', async () => {
    const portland = await createUser({ city: 'Portland' });
    const seattle = await createUser({ city: 'Seattle' });
    await createListing(portland);
    const doomed = await createListing(seattle);
    await request.delete(`/api/listings/${doomed.id}`).set(...seattle.auth);

    expect((await request.get('/api/listings/cities')).body).toEqual(['Portland']);
  });
});

describe('GET /api/categories', () => {
  it('returns the flat tree with parent_id', async () => {
    const electronics = await createCategory('Electronics', 'electronics');
    await createCategory('Phones', 'phones', electronics);

    const response = await request.get('/api/categories');
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.find((c: { slug: string }) => c.slug === 'phones').parent_id).toBe(
      electronics,
    );
  });
});

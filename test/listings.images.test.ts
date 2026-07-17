import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { createListing, createUser, request } from './helpers/api';
import { resetDatabase } from './helpers/db';

beforeEach(resetDatabase);

/**
 * External hosts throughout. Every URL here yields a null public_id, so nothing
 * in these tests can reach out to Cloudinary and delete a real asset — the
 * orphan cleanup skips assets it does not own. The parsing that decides
 * "ours" versus "not ours" is covered separately, without a database, in
 * cloudinary.test.ts.
 */
const A = 'https://example.com/a.jpg';
const B = 'https://example.com/b.jpg';
const C = 'https://example.com/c.jpg';

async function galleryUrls(listingId: number): Promise<string[]> {
  const { rows } = await pool.query<{ url: string }>(
    'SELECT url FROM listing_images WHERE listing_id = $1 ORDER BY "position", id',
    [listingId],
  );
  return rows.map((row) => row.url);
}

describe('PATCH /api/listings/:id — images', () => {
  it('replaces the whole gallery, in the order given', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A, B] });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ image_urls: [C, A] });

    expect(response.status).toBe(200);
    expect(response.body.images.map((image: { url: string }) => image.url)).toEqual([C, A]);
    expect(await galleryUrls(listing.id)).toEqual([C, A]);
  });

  /** position 0 is the cover, and browse reads it. Reordering must move it. */
  it('makes the first url the new cover', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A, B] });

    await request.patch(`/api/listings/${listing.id}`).set(...seller.auth).send({ image_urls: [B, A] });

    const browse = await request.get('/api/listings');
    expect(browse.body.items[0].cover_image_url).toBe(B);
  });

  it('leaves the gallery untouched when image_urls is absent', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A, B] });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ title: 'A new title' });

    expect(response.body.title).toBe('A new title');
    expect(await galleryUrls(listing.id)).toEqual([A, B]);
  });

  /** Absent means "leave alone"; an empty array means "remove them all". */
  it('removes every image when sent an empty array', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A, B] });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ image_urls: [] });

    expect(response.body.images).toEqual([]);
    expect(await galleryUrls(listing.id)).toEqual([]);
  });

  it('drops duplicate urls rather than storing the same photo twice', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A] });

    await request.patch(`/api/listings/${listing.id}`).set(...seller.auth).send({ image_urls: [B, A, B] });

    expect(await galleryUrls(listing.id)).toEqual([B, A]);
  });

  it('renumbers positions contiguously from zero', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A, B, C] });

    await request.patch(`/api/listings/${listing.id}`).set(...seller.auth).send({ image_urls: [C] });

    const { rows } = await pool.query<{ position: number }>(
      'SELECT "position" FROM listing_images WHERE listing_id = $1',
      [listing.id],
    );
    expect(rows.map((row) => row.position)).toEqual([0]);
  });

  it('stores a null public_id for an image hosted elsewhere', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A] });

    const { rows } = await pool.query<{ public_id: string | null }>(
      'SELECT public_id FROM listing_images WHERE listing_id = $1',
      [listing.id],
    );
    expect(rows[0]!.public_id).toBeNull();
  });

  /**
   * Validation runs before the transaction opens, so a bad URL costs a 400 and
   * no database work. The important half of that: the old gallery is still there.
   */
  it.each([
    ['a javascript: url', ['javascript:alert(1)']],
    ['a data: url', ['data:image/png;base64,AAA']],
    ['a protocol-relative url', ['//example.com/a.jpg']],
    ['an empty string', ['']],
    ['a non-string entry', [42]],
    ['not an array', 'https://example.com/a.jpg'],
    ['too many images', Array.from({ length: 9 }, (_, i) => `https://example.com/${i}.jpg`)],
  ])('rejects %s with 400 and keeps the existing gallery', async (_label, image_urls) => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A, B] });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ image_urls });

    expect(response.status).toBe(400);
    expect(await galleryUrls(listing.id)).toEqual([A, B]);
  });

  it('lets only the owner change the gallery', async () => {
    const seller = await createUser();
    const stranger = await createUser();
    const listing = await createListing(seller, { image_urls: [A] });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...stranger.auth)
      .send({ image_urls: [B] });

    expect(response.status).toBe(403);
    expect(await galleryUrls(listing.id)).toEqual([A]);
  });

  /**
   * The title and the gallery move together or not at all. An invalid price
   * rolls the whole PATCH back, so nobody sees new photos on an old price.
   */
  it('rolls the gallery back when another field in the same patch is invalid', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A] });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ price: '1e5', image_urls: [B, C] });

    expect(response.status).toBe(400);
    expect(await galleryUrls(listing.id)).toEqual([A]);
  });

  it('rolls the gallery back when the category does not exist', async () => {
    const seller = await createUser();
    const listing = await createListing(seller, { image_urls: [A] });

    const response = await request
      .patch(`/api/listings/${listing.id}`)
      .set(...seller.auth)
      .send({ category_id: 999999, image_urls: [B] });

    expect(response.status).toBe(400);
    expect(await galleryUrls(listing.id)).toEqual([A]);
  });
});

/**
 * Test fixtures that drive the real HTTP surface.
 *
 * Everything here goes through supertest and the actual Express app — routers,
 * middleware, services, repositories, Postgres. Nothing is mocked. When a test
 * says "the buyer cannot mark an order completed", it is the same code path a
 * browser would take.
 */
import supertest from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db';
import type { ListingCondition } from '../../src/types/domain';

export const app = createApp();
export const request = supertest(app);

export const PASSWORD = 'password123';

export interface TestUser {
  id: number;
  email: string;
  display_name: string;
  city: string;
  token: string;
  /** `Authorization: Bearer …`, ready to hand to supertest's .set(). */
  auth: [string, string];
}

let userCounter = 0;

/** Registers a user through POST /api/auth/register and returns their token. */
export async function createUser(overrides: Partial<{ email: string; display_name: string; city: string }> = {}): Promise<TestUser> {
  userCounter += 1;
  const email = overrides.email ?? `user${userCounter}@example.com`;
  const display_name = overrides.display_name ?? `User ${userCounter}`;
  const city = overrides.city ?? 'Portland';

  const response = await request
    .post('/api/auth/register')
    .send({ email, password: PASSWORD, display_name, city });

  if (response.status !== 201) {
    throw new Error(`createUser failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const token: string = response.body.token;
  return {
    id: response.body.user.id,
    email,
    display_name,
    city,
    token,
    auth: ['Authorization', `Bearer ${token}`],
  };
}

/** Inserts a category directly — there is no POST /api/categories to go through. */
export async function createCategory(
  name: string,
  slug: string,
  parentId: number | null = null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id',
    [name, slug, parentId],
  );
  return rows[0]!.id;
}

export interface CreateListingOptions {
  title?: string;
  price?: string;
  condition?: ListingCondition;
  description?: string | null;
  category_id?: number | null;
  image_urls?: string[];
}

/** Publishes a listing as `seller` through POST /api/listings. */
export async function createListing(
  seller: TestUser,
  options: CreateListingOptions = {},
): Promise<{ id: number; price: string; body: Record<string, unknown> }> {
  const response = await request
    .post('/api/listings')
    .set(...seller.auth)
    .send({
      title: options.title ?? 'A thing for sale',
      price: options.price ?? '25.00',
      condition: options.condition ?? 'good',
      description: options.description ?? null,
      category_id: options.category_id ?? null,
      image_urls: options.image_urls ?? ['https://example.com/a.jpg'],
    });

  if (response.status !== 201) {
    throw new Error(`createListing failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { id: response.body.id, price: response.body.price, body: response.body };
}

/**
 * Drives a listing all the way to a completed order: buyer places it, buyer
 * pays, seller completes. Returns the order id.
 *
 * Deliberately goes through the real transition rules rather than writing
 * `status = 'completed'` into the table — a test that fabricates state can pass
 * against code that could never reach that state.
 */
export async function completeOrder(
  buyer: TestUser,
  seller: TestUser,
  listingId: number,
): Promise<number> {
  const placed = await request.post('/api/orders').set(...buyer.auth).send({ listing_id: listingId });
  if (placed.status !== 201) {
    throw new Error(`place failed: ${placed.status} ${JSON.stringify(placed.body)}`);
  }
  const orderId: number = placed.body.id;

  await request.patch(`/api/orders/${orderId}`).set(...buyer.auth).send({ status: 'paid' });
  await request.patch(`/api/orders/${orderId}`).set(...seller.auth).send({ status: 'completed' });
  return orderId;
}

/** Backdates a listing so ordering tests are not at the mercy of clock resolution. */
export async function backdateListing(id: number, hoursAgo: number): Promise<void> {
  await pool.query(
    `UPDATE listings SET created_at = now() - make_interval(hours => $2) WHERE id = $1`,
    [id, hoursAgo],
  );
}

/**
 * Wipes and repopulates the database with sample data.
 *
 * Destructive by design — this is a development convenience, never run it
 * against anything you care about. Run with: npm run seed
 *
 * Every seeded user has the password `password123`, so you can log in as any
 * of them once Slice 2 exists.
 */
import { hash } from 'bcryptjs';
import { PoolClient } from 'pg';
import { pool, withTransaction } from '../src/db';
import { ListingCondition } from '../src/types/domain';

const SEED_PASSWORD = 'password123';
const BCRYPT_COST = 10;

/** TRUNCATE ... CASCADE resets every table at once; schema_migrations is spared. */
const TABLES = [
  'reviews',
  'messages',
  'orders',
  'favorites',
  'listing_images',
  'listings',
  'categories',
  'users',
] as const;

async function insertUser(
  client: PoolClient,
  input: { email: string; display_name: string; city: string; password_hash: string },
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO users (email, password_hash, display_name, city, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.email,
      input.password_hash,
      input.display_name,
      input.city,
      `https://i.pravatar.cc/150?u=${input.email}`,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error(`Failed to insert user ${input.email}`);
  return row.id;
}

async function insertCategory(
  client: PoolClient,
  name: string,
  slug: string,
  parentId: number | null,
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id`,
    [name, slug, parentId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Failed to insert category ${slug}`);
  return row.id;
}

/**
 * Every row in one transaction would otherwise share a created_at, because
 * now() returns the *transaction start* time, not the wall clock. Identical
 * timestamps make `ORDER BY created_at DESC` non-deterministic, which breaks
 * keyset pagination in a way that only shows up under load. We stagger the
 * seeded listings an hour apart so the browse order is stable and looks real.
 */
let ageHours = 0;

async function insertListing(
  client: PoolClient,
  input: {
    seller_id: number;
    category_id: number;
    title: string;
    description: string;
    price: string;
    condition: ListingCondition;
    city: string;
    images: readonly string[];
  },
): Promise<number> {
  ageHours += 1;
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO listings (seller_id, category_id, title, description, price, condition, city,
                           created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             clock_timestamp() - make_interval(hours => $8),
             clock_timestamp() - make_interval(hours => $8))
     RETURNING id`,
    [
      input.seller_id,
      input.category_id,
      input.title,
      input.description,
      input.price,
      input.condition,
      input.city,
      ageHours,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error(`Failed to insert listing ${input.title}`);
  const listingId = row.id;

  // position 0 is the cover image; the rest follow in array order.
  for (const [position, url] of input.images.entries()) {
    await client.query(
      `INSERT INTO listing_images (listing_id, url, "position") VALUES ($1, $2, $3)`,
      [listingId, url, position],
    );
  }
  return listingId;
}

/** picsum.photos serves a stable image per `seed` value, so the grid looks real. */
const img = (seed: string): string => `https://picsum.photos/seed/${seed}/800/600`;

async function main(): Promise<void> {
  const passwordHash = await hash(SEED_PASSWORD, BCRYPT_COST);

  await withTransaction(async (client) => {
    await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

    const alice = await insertUser(client, {
      email: 'alice@example.com',
      display_name: 'Alice Nguyen',
      city: 'Portland',
      password_hash: passwordHash,
    });
    const bob = await insertUser(client, {
      email: 'bob@example.com',
      display_name: 'Bob Ellis',
      city: 'Seattle',
      password_hash: passwordHash,
    });
    const carol = await insertUser(client, {
      email: 'carol@example.com',
      display_name: 'Carol Mbeki',
      city: 'Portland',
      password_hash: passwordHash,
    });

    // A three-level tree so the browse-by-category query has real descendants
    // to walk: Electronics -> Phones -> iPhone.
    const electronics = await insertCategory(client, 'Electronics', 'electronics', null);
    const phones = await insertCategory(client, 'Phones', 'phones', electronics);
    const iphone = await insertCategory(client, 'iPhone', 'iphone', phones);
    const laptops = await insertCategory(client, 'Laptops', 'laptops', electronics);
    const furniture = await insertCategory(client, 'Furniture', 'furniture', null);
    const chairs = await insertCategory(client, 'Chairs', 'chairs', furniture);
    const bikes = await insertCategory(client, 'Bikes', 'bikes', null);

    await insertListing(client, {
      seller_id: alice,
      category_id: iphone,
      title: 'iPhone 12 Mini, 128GB, unlocked',
      description:
        'Battery health 87%. Always in a case, screen has no scratches. Comes with the original box and a USB-C cable.',
      price: '299.00',
      condition: 'good',
      city: 'Portland',
      images: [img('iphone12a'), img('iphone12b'), img('iphone12c')],
    });

    await insertListing(client, {
      seller_id: alice,
      category_id: laptops,
      title: 'ThinkPad X1 Carbon Gen 9, 16GB RAM',
      description:
        'i7-1165G7, 512GB SSD. Bought for a job that went remote-first; barely opened. Linux and Windows both boot fine.',
      price: '640.00',
      condition: 'like_new',
      city: 'Portland',
      images: [img('thinkpad1'), img('thinkpad2')],
    });

    await insertListing(client, {
      seller_id: alice,
      category_id: bikes,
      title: 'Surly Cross-Check, 56cm, steel frame',
      description:
        'Classic steel commuter. New tyres and chain last spring. Some paint chips on the top tube, everything else is solid.',
      price: '700.00',
      condition: 'like_new',
      city: 'Portland',
      images: [img('surly1'), img('surly2')],
    });

    await insertListing(client, {
      seller_id: bob,
      category_id: phones,
      title: 'Pixel 7 Pro — cracked back glass',
      description:
        'Screen is perfect, back glass is spidered in one corner. Everything works. Priced to move.',
      price: '180.00',
      condition: 'fair',
      city: 'Seattle',
      images: [img('pixel7a'), img('pixel7b')],
    });

    await insertListing(client, {
      seller_id: bob,
      category_id: laptops,
      title: '2019 MacBook Pro 16", 512GB',
      description:
        'The good keyboard generation. AppleCare expired last year. Minor wear on the palm rest, battery cycle count 340.',
      price: '750.00',
      condition: 'good',
      city: 'Seattle',
      images: [img('mbp16a'), img('mbp16b'), img('mbp16c')],
    });

    await insertListing(client, {
      seller_id: bob,
      category_id: iphone,
      title: 'iPhone SE 2020 — for parts, does not boot',
      description:
        'Took a swim. Screen and camera module are almost certainly fine. Sold as-is, no returns.',
      price: '45.00',
      condition: 'for_parts',
      city: 'Seattle',
      images: [img('iphonese1')],
    });

    await insertListing(client, {
      seller_id: carol,
      category_id: chairs,
      title: 'Herman Miller Aeron, size B, fully loaded',
      description:
        'Posture-fit lumbar, adjustable arms, the works. Bought at an office liquidation. Mesh is taut, no sagging.',
      price: '480.00',
      condition: 'good',
      city: 'Portland',
      images: [img('aeron1'), img('aeron2')],
    });

    await insertListing(client, {
      seller_id: carol,
      category_id: furniture,
      title: 'Solid oak dining table, seats six',
      description:
        'Heavy. You will need two people and a van. Water rings on one end, which is why it is cheap.',
      price: '220.00',
      condition: 'fair',
      city: 'Portland',
      images: [img('oaktable1')],
    });
  });

  const { rows } = await pool.query<{ listings: string; users: string; categories: string }>(
    `SELECT (SELECT count(*) FROM listings)   AS listings,
            (SELECT count(*) FROM users)      AS users,
            (SELECT count(*) FROM categories) AS categories`,
  );
  const counts = rows[0];
  console.log('Seeded:', counts);
  console.log(`\nAll seeded users have the password "${SEED_PASSWORD}".`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

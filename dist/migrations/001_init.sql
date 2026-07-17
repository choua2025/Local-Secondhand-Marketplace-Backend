-- 001_init.sql — the complete schema for the marketplace.
--
-- Conventions used throughout:
--   * BIGINT identity primary keys (GENERATED ALWAYS AS IDENTITY, the SQL-standard
--     replacement for the older `bigserial` + sequence pattern).
--   * snake_case names, timestamptz for every timestamp.
--   * Money is NUMERIC(10,2). Never float — binary floating point cannot represent
--     0.10 exactly, so cents drift under arithmetic.

-------------------------------------------------------------------------------
-- Enums
-------------------------------------------------------------------------------
CREATE TYPE listing_condition AS ENUM ('new', 'like_new', 'good', 'fair', 'for_parts');
CREATE TYPE listing_status    AS ENUM ('active', 'pending', 'sold', 'removed');
CREATE TYPE order_status      AS ENUM ('pending', 'paid', 'completed', 'cancelled', 'refunded');

-------------------------------------------------------------------------------
-- users — the single identity for buyers and sellers alike.
-------------------------------------------------------------------------------
CREATE TABLE users (
    id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    display_name  TEXT        NOT NULL,
    phone         TEXT,
    city          TEXT,
    avatar_url    TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-------------------------------------------------------------------------------
-- categories — a self-referencing tree: Electronics -> Phones -> iPhone.
-- parent_id IS NULL marks a top-level category.
-------------------------------------------------------------------------------
CREATE TABLE categories (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT        NOT NULL,
    slug       TEXT        NOT NULL UNIQUE,
    parent_id  BIGINT      REFERENCES categories (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-------------------------------------------------------------------------------
-- listings
--
-- `city` is copied from the seller at creation time. This is a deliberate
-- redundancy: a listing records where the *item* was when it was posted, so it
-- does not silently relocate if the seller later moves cities.
-------------------------------------------------------------------------------
CREATE TABLE listings (
    id          BIGINT            GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    seller_id   BIGINT            NOT NULL REFERENCES users (id),
    category_id BIGINT            REFERENCES categories (id) ON DELETE SET NULL,
    title       TEXT              NOT NULL,
    description TEXT,
    price       NUMERIC(10, 2)    NOT NULL CHECK (price >= 0),
    condition   listing_condition NOT NULL,
    status      listing_status    NOT NULL DEFAULT 'active',
    city        TEXT,
    created_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-------------------------------------------------------------------------------
-- listing_images — position 0 is the cover image.
-- "position" is a reserved word in SQL, so it is double-quoted everywhere.
-------------------------------------------------------------------------------
CREATE TABLE listing_images (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id BIGINT      NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    url        TEXT        NOT NULL,
    "position" SMALLINT    NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-------------------------------------------------------------------------------
-- favorites — the composite primary key is what makes a duplicate save
-- impossible at the storage layer, so `add` can be a plain
-- INSERT ... ON CONFLICT DO NOTHING and is therefore idempotent for free.
-------------------------------------------------------------------------------
CREATE TABLE favorites (
    user_id    BIGINT      NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
    listing_id BIGINT      NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, listing_id)
);

-------------------------------------------------------------------------------
-- orders
--
-- `amount` is a SNAPSHOT of listings.price taken when the order is created.
-- Later edits to the listing price must not rewrite the history of past sales.
-------------------------------------------------------------------------------
CREATE TABLE orders (
    id           BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id   BIGINT         NOT NULL REFERENCES listings (id),
    buyer_id     BIGINT         NOT NULL REFERENCES users (id),
    amount       NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    status       order_status   NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-------------------------------------------------------------------------------
-- reviews
--
-- A review hangs off an order, so you can only review someone you actually
-- transacted with. UNIQUE (order_id, reviewer_id) means one review per person
-- per order. Both rules are enforced by the schema, not by application code —
-- that is the anti-fake-review guarantee.
-------------------------------------------------------------------------------
CREATE TABLE reviews (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    reviewer_id BIGINT      NOT NULL REFERENCES users (id),
    reviewee_id BIGINT      NOT NULL REFERENCES users (id),
    rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, reviewer_id),
    CHECK (reviewer_id <> reviewee_id)
);

-------------------------------------------------------------------------------
-- messages
-------------------------------------------------------------------------------
CREATE TABLE messages (
    id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id   BIGINT      REFERENCES listings (id) ON DELETE CASCADE,
    sender_id    BIGINT      NOT NULL REFERENCES users (id),
    recipient_id BIGINT      NOT NULL REFERENCES users (id),
    body         TEXT        NOT NULL,
    is_read      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sender_id <> recipient_id)
);

-------------------------------------------------------------------------------
-- Indexes — each one exists because a specific query in the spec needs it.
-------------------------------------------------------------------------------

-- The browse query: WHERE status='active' AND city=$1 ORDER BY created_at DESC.
-- NOTE: created_at is not unique — two listings posted in the same instant tie,
-- and a tie makes ORDER BY non-deterministic, so a paginated browse can skip or
-- repeat rows between pages. Always sort by (created_at DESC, id DESC).
CREATE INDEX listings_browse_idx        ON listings (status, city, created_at DESC);
CREATE INDEX listings_category_idx      ON listings (category_id, status);

-- Fetching a listing's gallery in cover-first order.
CREATE INDEX listing_images_listing_idx ON listing_images (listing_id, "position");

-- "How many people saved this listing?" (the user_id direction is already
-- covered by the composite primary key's leading column.)
CREATE INDEX favorites_listing_idx      ON favorites (listing_id);

CREATE INDEX orders_buyer_idx           ON orders (buyer_id, created_at DESC);
CREATE INDEX orders_listing_idx         ON orders (listing_id);

-- Averaging a seller's rating.
CREATE INDEX reviews_reviewee_idx       ON reviews (reviewee_id);

-- Loading one conversation thread, oldest first.
CREATE INDEX messages_thread_idx        ON messages (listing_id, sender_id, recipient_id, created_at);
-- The navbar's unread badge.
CREATE INDEX messages_unread_idx        ON messages (recipient_id, is_read);

-- Walking the category tree downward from a parent.
CREATE INDEX categories_parent_idx      ON categories (parent_id);

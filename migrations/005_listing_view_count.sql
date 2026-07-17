-- 005_listing_view_count.sql — how many times a listing's page has been opened.
--
-- A plain counter on the row, not a per-view log. The product question is "how
-- many views does this have", and a single integer answers it in the same read
-- that already loads the listing — no join, no aggregate. The price is that it
-- cannot answer "who" or "when", and a refresh counts again; both are fine for
-- a total-opens number (the way a video view count works).
--
-- NOT NULL DEFAULT 0 so every existing listing starts at a real zero rather than
-- a NULL the UI would have to translate. The seller's own opens are excluded at
-- the service layer, not here — the column just holds whatever it is told to.

ALTER TABLE listings ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

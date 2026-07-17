-- 003_cloudinary_public_ids.sql — remember which Cloudinary asset each URL names.
--
-- A Cloudinary URL like
--     https://res.cloudinary.com/demo/image/upload/v1699/listings/abc123.jpg
-- identifies an asset for *reading*. To delete one you need its public_id
-- ("listings/abc123") instead. Without it, every photo a seller ever replaced
-- stays in the account forever, paid for and unreachable.
--
-- Both columns are NULLABLE, and that is the interesting part. Images predating
-- this migration are external URLs somebody pasted in — we did not upload them,
-- we do not own them, and we must never try to destroy them. NULL is what says
-- "this asset is not ours to delete". The cleanup code skips those rows rather
-- than guessing.

ALTER TABLE listing_images ADD COLUMN public_id TEXT;
ALTER TABLE users          ADD COLUMN avatar_public_id TEXT;

-- Cleanup looks assets up by public_id when deciding what to destroy. Partial,
-- because the NULL rows are exactly the ones it never touches — no reason to
-- carry them in the index.
CREATE INDEX listing_images_public_id_idx
    ON listing_images (public_id)
    WHERE public_id IS NOT NULL;

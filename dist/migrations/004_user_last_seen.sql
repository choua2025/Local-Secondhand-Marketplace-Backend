-- 004_user_last_seen.sql — "last online" for the presence indicator in chat.
--
-- One nullable column. NULL means "has never connected a socket since this
-- column existed" — every user predating this migration, and any user who has
-- only ever used the REST API. The UI reads NULL as "no last-seen to show"
-- rather than inventing a time, which is why it is nullable rather than
-- defaulting to now() (that would claim everyone was just online).
--
-- It is written on socket connect and disconnect, and read by
-- GET /api/users/:id/presence. It is deliberately NOT wired into ordinary REST
-- activity: "last seen" here means "last had the app open and listening", which
-- is what a chat presence line promises, not "last made any request".

ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;

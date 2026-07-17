/**
 * All message SQL.
 *
 * Note that every query is scoped to the calling user by construction: the
 * user's id appears in the WHERE clause of each one. There is no way to phrase
 * "give me someone else's thread" through this interface, which is a stronger
 * guarantee than checking permission after fetching.
 */
import { pool, Queryable } from '../db';
import { MessageDto, ThreadSummary } from '../types/dto';

/**
 * One conversation, oldest first.
 *
 * The `(sender=me AND recipient=them) OR (sender=them AND recipient=me)` pair is
 * what makes a thread symmetric — a conversation is the union of both directions.
 */
export async function thread(
  userId: number,
  listingId: number,
  otherUserId: number,
  db: Queryable = pool,
): Promise<MessageDto[]> {
  const { rows } = await db.query<MessageDto>(
    `SELECT id, listing_id, sender_id, recipient_id, body, is_read, created_at
     FROM messages
     WHERE listing_id = $2
       AND ((sender_id = $1 AND recipient_id = $3)
         OR (sender_id = $3 AND recipient_id = $1))
     ORDER BY created_at, id`,
    [userId, listingId, otherUserId],
  );
  return rows.map((row) => ({
    id: row.id,
    listing_id: row.listing_id,
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    body: row.body,
    is_read: row.is_read,
    created_at: row.created_at,
  }));
}

export async function insert(
  senderId: number,
  recipientId: number,
  listingId: number,
  body: string,
  db: Queryable = pool,
): Promise<MessageDto> {
  const { rows } = await db.query<MessageDto>(
    `INSERT INTO messages (listing_id, sender_id, recipient_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, listing_id, sender_id, recipient_id, body, is_read, created_at`,
    [listingId, senderId, recipientId, body],
  );
  const row = rows[0];
  if (!row) throw new Error('Message insert returned no row');
  return row;
}

/**
 * Every conversation the user is part of, most recent first.
 *
 * DISTINCT ON (listing_id, other_user_id) keeps the first row of each group
 * after the ORDER BY — so ordering by created_at DESC inside the group picks
 * the latest message per conversation. It is a Postgres extension, and it does
 * in one pass what a window function plus an outer filter would do in two.
 */
export async function listThreads(userId: number, db: Queryable = pool): Promise<ThreadSummary[]> {
  const { rows } = await db.query<ThreadSummary>(
    `WITH conversations AS (
       SELECT m.*,
              CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
                AS other_user_id
       FROM messages m
       WHERE (m.sender_id = $1 OR m.recipient_id = $1)
         AND m.listing_id IS NOT NULL
     ),
     latest AS (
       SELECT DISTINCT ON (listing_id, other_user_id) *
       FROM conversations
       ORDER BY listing_id, other_user_id, created_at DESC, id DESC
     )
     SELECT latest.listing_id,
            l.title        AS listing_title,
            img.url        AS listing_cover_url,
            latest.other_user_id,
            u.display_name AS other_user_name,
            u.avatar_url   AS other_user_avatar_url,
            latest.body    AS last_message_body,
            latest.created_at AS last_message_at,
            (latest.sender_id = $1) AS last_message_mine,
            (SELECT count(*)::int
               FROM messages unread
              WHERE unread.listing_id  = latest.listing_id
                AND unread.sender_id   = latest.other_user_id
                AND unread.recipient_id = $1
                AND unread.is_read = FALSE) AS unread_count
     FROM latest
     JOIN users u    ON u.id = latest.other_user_id
     JOIN listings l ON l.id = latest.listing_id
     LEFT JOIN LATERAL (
       SELECT i.url FROM listing_images i
       WHERE i.listing_id = l.id
       ORDER BY i."position", i.id
       LIMIT 1
     ) img ON TRUE
     ORDER BY latest.created_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    listing_id: row.listing_id,
    listing_title: row.listing_title,
    listing_cover_url: row.listing_cover_url,
    other_user_id: row.other_user_id,
    other_user_name: row.other_user_name,
    other_user_avatar_url: row.other_user_avatar_url,
    last_message_body: row.last_message_body,
    last_message_at: row.last_message_at,
    last_message_mine: row.last_message_mine,
    unread_count: row.unread_count,
  }));
}

/**
 * Marks the other person's messages in this thread as read.
 *
 * `recipient_id = $1` is the security-relevant clause: you can only ever mark
 * messages addressed to YOU. Nobody can mark their own sent messages read on
 * the recipient's behalf, which would otherwise be a way to clear someone
 * else's unread badge.
 */
export async function markRead(
  userId: number,
  listingId: number,
  otherUserId: number,
  db: Queryable = pool,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE messages
        SET is_read = TRUE
      WHERE listing_id = $2
        AND recipient_id = $1
        AND sender_id = $3
        AND is_read = FALSE`,
    [userId, listingId, otherUserId],
  );
  return rowCount ?? 0;
}

/**
 * The distinct ids of everyone this user has a conversation with.
 *
 * Used to decide who to tell when the user comes online or goes offline: a
 * presence change is only interesting to the people who might be looking at a
 * thread with them, not the whole site.
 */
export async function counterpartyIds(userId: number, db: Queryable = pool): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT DISTINCT
            CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS id
       FROM messages
      WHERE sender_id = $1 OR recipient_id = $1`,
    [userId],
  );
  return rows.map((row) => row.id);
}

/** Total unread messages addressed to this user, across every thread. */
export async function unreadCount(userId: number, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM messages
     WHERE recipient_id = $1 AND is_read = FALSE`,
    [userId],
  );
  return rows[0]?.count ?? 0;
}

/**
 * The registry of who is connected, and the one function the rest of the app
 * uses to push something at them.
 *
 * This is a module-level singleton with in-memory state, and that is a
 * deliberate scope decision. It works perfectly for a single server process,
 * which is what this project runs. The moment there are two processes behind a
 * load balancer, a user's socket lives on one and the message that should reach
 * it is created on the other — at which point this map needs to become a
 * Redis pub/sub (or similar) so a publish on one process fans out to sockets on
 * all of them. The seam is `publishToUser`: swap its body, nothing else moves.
 *
 * Nothing here imports `ws`. The hub knows only an interface — "a thing you can
 * send a string to and ask whether it is open" — so a test can register a fake
 * socket and assert what it received without a real connection.
 */
import type { MessageDto } from '../types/dto';

/** The slice of a WebSocket the hub actually uses. Keeps `ws` out of this file. */
export interface Connection {
  send(data: string): void;
  readonly isOpen: boolean;
}

/**
 * Every server->client event, as a discriminated union. `type` is the tag the
 * client switches on; adding a new event means adding a member here and the
 * client's mirror of it, and the compiler finds every place that must handle it.
 *
 *   message:new  — a message was just sent in a conversation you are part of.
 *   message:read — someone read the messages you sent them (drives read receipts).
 *   presence     — a person you have a thread with came online or went offline.
 */
export type RealtimeEvent =
  | { type: 'message:new'; payload: MessageDto }
  | { type: 'message:read'; payload: { listing_id: number; reader_id: number } }
  | {
      type: 'presence';
      payload: { user_id: number; online: boolean; last_seen_at: Date | null };
    };

/**
 * userId -> the set of that user's open sockets.
 *
 * A Set, not a single socket, because one person legitimately has several: two
 * browser tabs, a phone and a laptop. A message must reach all of them, and a
 * closing tab must not evict the others.
 */
const connections = new Map<number, Set<Connection>>();

/**
 * Adds a socket. Returns true when this is the user's FIRST socket — the
 * offline->online transition — so the caller can announce presence exactly once
 * rather than on every tab they open.
 */
export function register(userId: number, connection: Connection): boolean {
  let userConnections = connections.get(userId);
  const wasOffline = userConnections === undefined || userConnections.size === 0;
  if (!userConnections) {
    userConnections = new Set();
    connections.set(userId, userConnections);
  }
  userConnections.add(connection);
  return wasOffline;
}

/**
 * Drops one socket. Returns true when it was the user's LAST — the
 * online->offline transition. The last one leaving takes the user's entry with
 * it, so the map does not grow a dead key for everyone who has ever connected.
 */
export function unregister(userId: number, connection: Connection): boolean {
  const userConnections = connections.get(userId);
  if (!userConnections) return false;
  userConnections.delete(connection);
  if (userConnections.size === 0) {
    connections.delete(userId);
    return true;
  }
  return false;
}

/** Whether the user has at least one socket open right now. */
export function isOnline(userId: number): boolean {
  const userConnections = connections.get(userId);
  return userConnections !== undefined && userConnections.size > 0;
}

/**
 * Sends one event to every socket a user has open. A no-op if they have none —
 * which is the common case (the recipient is offline) and is exactly right: the
 * message is already in the database, and they will load it on their next visit.
 *
 * This is the seam a multi-process deployment would replace with a publish to a
 * shared broker. Today it delivers in-process.
 */
export function publishToUser(userId: number, event: RealtimeEvent): void {
  const userConnections = connections.get(userId);
  if (!userConnections || userConnections.size === 0) return;

  const data = JSON.stringify(event);
  for (const connection of userConnections) {
    // Guard rather than trust: a socket can be mid-close when we iterate, and
    // sending to a closed one throws. One dead peer must not stop the others.
    if (connection.isOpen) {
      try {
        connection.send(data);
      } catch {
        // The close handler will unregister it; nothing useful to do here.
      }
    }
  }
}

/**
 * Delivers a freshly-created message to both people in the conversation.
 *
 * Both, not just the recipient, so a user's *other* devices stay in sync: send
 * from your laptop and the thread updates on your phone too. The sending tab
 * also receives its own message back and must dedupe by id — it already has it
 * from the POST response. That the client owns; the server's job is only to
 * make sure every interested socket hears about it.
 */
export function notifyNewMessage(message: MessageDto): void {
  const event: RealtimeEvent = { type: 'message:new', payload: message };
  publishToUser(message.recipient_id, event);
  publishToUser(message.sender_id, event);
}

/**
 * Tells the SENDER that the person they wrote to has read their messages in a
 * thread — the "turned blue" read receipt.
 *
 * Goes only to `senderId`. The reader already knows they read it; it is the
 * sender's UI that needs updating. Scoped to a listing because a read is
 * per-conversation, not global.
 */
export function notifyMessagesRead(readerId: number, listingId: number, senderId: number): void {
  publishToUser(senderId, {
    type: 'message:read',
    payload: { listing_id: listingId, reader_id: readerId },
  });
}

/** For tests: how many sockets a user has open right now. */
export function connectionCount(userId: number): number {
  return connections.get(userId)?.size ?? 0;
}

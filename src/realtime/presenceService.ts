/**
 * Turns a socket connecting or disconnecting into a "last seen" write and a
 * presence broadcast.
 *
 * This is the one realtime file that touches the database and the repositories,
 * which is why it is separate from the hub (a pure in-memory registry) and from
 * socketServer (which only knows about `ws`). socketServer calls in here on the
 * transitions the hub reports; everything database- and fan-out-shaped lives
 * here.
 *
 * Both handlers swallow their own errors. A failed presence write must never
 * take down a socket connection or crash the process — presence is a nicety,
 * the conversation itself is not.
 */
import * as messageRepository from '../repositories/messageRepository';
import * as userRepository from '../repositories/userRepository';
import { publishToUser } from './hub';

/**
 * Announce a presence change to everyone who has a conversation with this user.
 * Not to the whole site: a stranger has no thread open with them and no reason
 * to hear it.
 */
async function broadcast(userId: number, online: boolean, lastSeenAt: Date | null): Promise<void> {
  const counterparties = await messageRepository.counterpartyIds(userId);
  for (const otherId of counterparties) {
    publishToUser(otherId, {
      type: 'presence',
      payload: { user_id: userId, online, last_seen_at: lastSeenAt },
    });
  }
}

/** First socket opened: stamp last-seen and tell their contacts they are online. */
export async function handleConnect(userId: number): Promise<void> {
  try {
    const lastSeenAt = await userRepository.touchLastSeen(userId);
    await broadcast(userId, true, lastSeenAt);
  } catch (error: unknown) {
    console.error(`[presence] connect for user ${userId} failed:`, error);
  }
}

/** Last socket closed: stamp last-seen and tell their contacts they went offline. */
export async function handleDisconnect(userId: number): Promise<void> {
  try {
    const lastSeenAt = await userRepository.touchLastSeen(userId);
    await broadcast(userId, false, lastSeenAt);
  } catch (error: unknown) {
    console.error(`[presence] disconnect for user ${userId} failed:`, error);
  }
}

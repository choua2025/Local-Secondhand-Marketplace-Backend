"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.unregister = unregister;
exports.isOnline = isOnline;
exports.publishToUser = publishToUser;
exports.notifyNewMessage = notifyNewMessage;
exports.notifyMessagesRead = notifyMessagesRead;
exports.connectionCount = connectionCount;
/**
 * userId -> the set of that user's open sockets.
 *
 * A Set, not a single socket, because one person legitimately has several: two
 * browser tabs, a phone and a laptop. A message must reach all of them, and a
 * closing tab must not evict the others.
 */
const connections = new Map();
/**
 * Adds a socket. Returns true when this is the user's FIRST socket — the
 * offline->online transition — so the caller can announce presence exactly once
 * rather than on every tab they open.
 */
function register(userId, connection) {
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
function unregister(userId, connection) {
    const userConnections = connections.get(userId);
    if (!userConnections)
        return false;
    userConnections.delete(connection);
    if (userConnections.size === 0) {
        connections.delete(userId);
        return true;
    }
    return false;
}
/** Whether the user has at least one socket open right now. */
function isOnline(userId) {
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
function publishToUser(userId, event) {
    const userConnections = connections.get(userId);
    if (!userConnections || userConnections.size === 0)
        return;
    const data = JSON.stringify(event);
    for (const connection of userConnections) {
        // Guard rather than trust: a socket can be mid-close when we iterate, and
        // sending to a closed one throws. One dead peer must not stop the others.
        if (connection.isOpen) {
            try {
                connection.send(data);
            }
            catch {
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
function notifyNewMessage(message) {
    const event = { type: 'message:new', payload: message };
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
function notifyMessagesRead(readerId, listingId, senderId) {
    publishToUser(senderId, {
        type: 'message:read',
        payload: { listing_id: listingId, reader_id: readerId },
    });
}
/** For tests: how many sockets a user has open right now. */
function connectionCount(userId) {
    return connections.get(userId)?.size ?? 0;
}
//# sourceMappingURL=hub.js.map
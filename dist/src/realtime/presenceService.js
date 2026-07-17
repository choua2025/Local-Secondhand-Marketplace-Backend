"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleConnect = handleConnect;
exports.handleDisconnect = handleDisconnect;
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
const messageRepository = __importStar(require("../repositories/messageRepository"));
const userRepository = __importStar(require("../repositories/userRepository"));
const hub_1 = require("./hub");
/**
 * Announce a presence change to everyone who has a conversation with this user.
 * Not to the whole site: a stranger has no thread open with them and no reason
 * to hear it.
 */
async function broadcast(userId, online, lastSeenAt) {
    const counterparties = await messageRepository.counterpartyIds(userId);
    for (const otherId of counterparties) {
        (0, hub_1.publishToUser)(otherId, {
            type: 'presence',
            payload: { user_id: userId, online, last_seen_at: lastSeenAt },
        });
    }
}
/** First socket opened: stamp last-seen and tell their contacts they are online. */
async function handleConnect(userId) {
    try {
        const lastSeenAt = await userRepository.touchLastSeen(userId);
        await broadcast(userId, true, lastSeenAt);
    }
    catch (error) {
        console.error(`[presence] connect for user ${userId} failed:`, error);
    }
}
/** Last socket closed: stamp last-seen and tell their contacts they went offline. */
async function handleDisconnect(userId) {
    try {
        const lastSeenAt = await userRepository.touchLastSeen(userId);
        await broadcast(userId, false, lastSeenAt);
    }
    catch (error) {
        console.error(`[presence] disconnect for user ${userId} failed:`, error);
    }
}
//# sourceMappingURL=presenceService.js.map
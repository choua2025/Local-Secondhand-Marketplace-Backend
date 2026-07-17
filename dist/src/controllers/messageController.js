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
exports.thread = thread;
exports.listThreads = listThreads;
exports.unreadCount = unreadCount;
exports.send = send;
exports.markRead = markRead;
const errors_1 = require("../errors");
const auth_1 = require("../middleware/auth");
const hub_1 = require("../realtime/hub");
const messageService = __importStar(require("../services/messageService"));
function readNumericQuery(value, name) {
    if (typeof value !== 'string') {
        throw new errors_1.ValidationError(`${name} is required`);
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new errors_1.ValidationError(`${name} must be an integer`);
    }
    return parsed;
}
function asObject(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new errors_1.ValidationError('Request body must be a JSON object');
    }
    return body;
}
/** GET /api/messages?listingId=&otherUserId= */
async function thread(req, res) {
    const listingId = readNumericQuery(req.query.listingId, 'listingId');
    const otherUserId = readNumericQuery(req.query.otherUserId, 'otherUserId');
    res.json(await messageService.thread((0, auth_1.requireUserId)(req), listingId, otherUserId));
}
/** GET /api/messages/threads */
async function listThreads(req, res) {
    res.json(await messageService.listThreads((0, auth_1.requireUserId)(req)));
}
/** GET /api/messages/unread-count */
async function unreadCount(req, res) {
    res.json({ count: await messageService.unreadCount((0, auth_1.requireUserId)(req)) });
}
/** POST /api/messages */
async function send(req, res) {
    const body = asObject(req.body);
    const message = await messageService.send((0, auth_1.requireUserId)(req), {
        recipient_id: Number(body['recipient_id']),
        listing_id: Number(body['listing_id']),
        body: typeof body['body'] === 'string' ? body['body'] : '',
    });
    // Realtime delivery lives here, in the HTTP adapter, not in messageService —
    // the service is transport-agnostic by design and must not know a socket
    // exists. Only after the message is safely persisted do we push it to any
    // connected sockets for the two participants. A no-op when nobody is online,
    // and never in the test suite, which runs the app without a socket server.
    (0, hub_1.notifyNewMessage)(message);
    res.status(201).json(message);
}
/** POST /api/messages/read */
async function markRead(req, res) {
    const readerId = (0, auth_1.requireUserId)(req);
    const body = asObject(req.body);
    const listingId = Number(body['listing_id']);
    const otherUserId = Number(body['other_user_id']);
    const updated = await messageService.markRead(readerId, listingId, otherUserId);
    // Only tell the sender if something actually changed. otherUserId is exactly
    // whose messages were marked read — they are the sender, and the one whose
    // read receipts turn blue. A no-op when they are offline.
    if (updated > 0) {
        (0, hub_1.notifyMessagesRead)(readerId, listingId, otherUserId);
    }
    res.json({ marked_read: updated });
}
//# sourceMappingURL=messageController.js.map
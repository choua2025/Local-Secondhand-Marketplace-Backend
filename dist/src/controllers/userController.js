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
exports.getMe = getMe;
exports.presence = presence;
exports.updateMe = updateMe;
const errors_1 = require("../errors");
const auth_1 = require("../middleware/auth");
const hub_1 = require("../realtime/hub");
const userService = __importStar(require("../services/userService"));
/** The fields a profile PATCH may carry. Anything else in the body is ignored. */
const PATCHABLE = ['display_name', 'city', 'phone', 'avatar_url'];
function asObject(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new errors_1.ValidationError('Request body must be a JSON object');
    }
    return body;
}
async function getMe(req, res) {
    res.json(await userService.getProfile((0, auth_1.requireUserId)(req)));
}
/**
 * GET /api/users/:id/presence — is this person online, and when were they last?
 *
 * Public, like the reviews on the same router: it powers the "Active now / Last
 * seen" line in a conversation, and a buyer can open a thread with a seller
 * before either has logged the other in. `online` is the hub's live in-memory
 * truth; `last_seen_at` is the database's record of the last disconnect.
 */
async function presence(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        throw new errors_1.ValidationError('user id must be an integer');
    }
    const lastSeenAt = await userService.getUserLastSeen(id);
    res.json({ online: (0, hub_1.isOnline)(id), last_seen_at: lastSeenAt });
}
/**
 * Copies across only the keys the client actually sent.
 *
 * `'city' in body` rather than `body.city !== undefined`, because the two mean
 * different things to a PATCH: an absent key leaves the city alone, while
 * `{"city": null}` clears it. Reading with `!==  undefined` would collapse them
 * and make "clear my city" impossible to express.
 *
 * The values themselves go through untouched — the service validates. The
 * controller's only job is to say which fields were present.
 */
async function updateMe(req, res) {
    const body = asObject(req.body);
    const input = {};
    for (const key of PATCHABLE) {
        if (key in body) {
            input[key] = body[key];
        }
    }
    res.json(await userService.updateProfile((0, auth_1.requireUserId)(req), input));
}
//# sourceMappingURL=userController.js.map
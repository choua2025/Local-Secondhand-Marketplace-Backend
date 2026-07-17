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
exports.browse = browse;
exports.cities = cities;
exports.getById = getById;
exports.listMine = listMine;
exports.create = create;
exports.update = update;
exports.remove = remove;
exports.registerView = registerView;
const errors_1 = require("../errors");
const auth_1 = require("../middleware/auth");
const listingService = __importStar(require("../services/listingService"));
/**
 * Express types a query value as `string | string[] | ParsedQs | ParsedQs[]`,
 * because `?city=a&city=b` is legal. We accept only a single string and treat
 * a repeated or nested param as a bad request rather than silently using the
 * first one.
 */
function readSingleString(value, name) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string') {
        throw new errors_1.ValidationError(`${name} must be a single value`);
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function readPage(value) {
    const raw = readSingleString(value, 'page');
    if (raw === undefined)
        return 1;
    // Number() rather than parseInt(): parseInt('2abc') is 2, which would let a
    // malformed page number through instead of rejecting it.
    const page = Number(raw);
    if (!Number.isInteger(page) || page < 1) {
        throw new errors_1.ValidationError('page must be a positive integer');
    }
    return page;
}
async function browse(req, res) {
    const city = readSingleString(req.query.city, 'city');
    const category = readSingleString(req.query.category, 'category');
    const q = readSingleString(req.query.q, 'q');
    // Built by spreading rather than assigning `undefined`, because
    // exactOptionalPropertyTypes distinguishes "absent" from "present and undefined".
    const query = {
        page: readPage(req.query.page),
        ...(city !== undefined && { city }),
        ...(category !== undefined && { category }),
        ...(q !== undefined && { q }),
    };
    res.json(await listingService.browse(query));
}
async function cities(_req, res) {
    res.json(await listingService.cities());
}
async function getById(req, res) {
    res.json(await listingService.getById(readId(req)));
}
/** Shared by the three routes that address one listing by id. */
function readId(req) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        throw new errors_1.ValidationError('listing id must be an integer');
    }
    return id;
}
function asObject(body) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new errors_1.ValidationError('Request body must be a JSON object');
    }
    return body;
}
async function listMine(req, res) {
    res.json(await listingService.listMine((0, auth_1.requireUserId)(req)));
}
async function create(req, res) {
    const body = asObject(req.body);
    // Pass the raw values through; the service is what validates them. The
    // controller's only job is to say "this is the shape of the input I found".
    const input = {
        title: body['title'],
        description: body['description'] ?? null,
        price: body['price'],
        condition: body['condition'],
        category_id: body['category_id'] ?? null,
        image_urls: body['image_urls'] ?? [],
    };
    const created = await listingService.create((0, auth_1.requireUserId)(req), input);
    res.status(201).json(created);
}
async function update(req, res) {
    const body = asObject(req.body);
    // Only copy keys the client actually sent. Spreading `undefined` in would
    // make the service think a field was cleared rather than left alone.
    //
    // `image_urls` included: sending it replaces the gallery in order, and the
    // photos it drops are deleted from Cloudinary. Omitting it leaves them be.
    const fields = {};
    const patchable = ['title', 'description', 'price', 'condition', 'category_id', 'image_urls'];
    for (const key of patchable) {
        if (key in body) {
            fields[key] = body[key];
        }
    }
    res.json(await listingService.update((0, auth_1.requireUserId)(req), readId(req), fields));
}
async function remove(req, res) {
    await listingService.remove((0, auth_1.requireUserId)(req), readId(req));
    // 204: succeeded, and there is deliberately no body to send back.
    res.status(204).end();
}
/**
 * POST /api/listings/:id/view — records that this page was opened.
 *
 * Mounted with `attachUser`, not `requireAuth`: a logged-out visitor's view
 * counts too, so a token is optional here. `req.userId` is whoever the token
 * named, or undefined; the service uses it only to skip the owner's own views.
 */
async function registerView(req, res) {
    const viewCount = await listingService.registerView(readId(req), req.userId ?? null);
    res.json({ view_count: viewCount });
}
//# sourceMappingURL=listingController.js.map
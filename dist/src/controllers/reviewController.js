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
exports.create = create;
exports.listForUser = listForUser;
const errors_1 = require("../errors");
const auth_1 = require("../middleware/auth");
const reviewService = __importStar(require("../services/reviewService"));
async function create(req, res) {
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new errors_1.ValidationError('Request body must be a JSON object');
    }
    const fields = body;
    // Note there is no reviewee_id here, and no way to supply one. The service
    // derives it from the order.
    const review = await reviewService.create((0, auth_1.requireUserId)(req), {
        order_id: Number(fields['order_id']),
        rating: Number(fields['rating']),
        body: typeof fields['body'] === 'string' ? fields['body'] : null,
    });
    res.status(201).json(review);
}
/** Public: GET /api/users/:id/reviews */
async function listForUser(req, res) {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
        throw new errors_1.ValidationError('user id must be an integer');
    }
    res.json(await reviewService.listForUser(userId));
}
//# sourceMappingURL=reviewController.js.map
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
exports.place = place;
exports.listForUser = listForUser;
exports.updateStatus = updateStatus;
const errors_1 = require("../errors");
const auth_1 = require("../middleware/auth");
const orderService = __importStar(require("../services/orderService"));
async function place(req, res) {
    const body = req.body;
    if (typeof body !== 'object' || body === null) {
        throw new errors_1.ValidationError('Request body must be a JSON object');
    }
    const listingId = Number(body['listing_id']);
    if (!Number.isInteger(listingId)) {
        throw new errors_1.ValidationError('listing_id is required and must be an integer');
    }
    const order = await orderService.place((0, auth_1.requireUserId)(req), listingId);
    res.status(201).json(order);
}
async function listForUser(req, res) {
    res.json(await orderService.listForUser((0, auth_1.requireUserId)(req)));
}
async function updateStatus(req, res) {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) {
        throw new errors_1.ValidationError('order id must be an integer');
    }
    const body = req.body;
    const status = body?.['status'];
    if (typeof status !== 'string') {
        throw new errors_1.ValidationError('status is required');
    }
    res.json(await orderService.updateStatus((0, auth_1.requireUserId)(req), orderId, status));
}
//# sourceMappingURL=orderController.js.map
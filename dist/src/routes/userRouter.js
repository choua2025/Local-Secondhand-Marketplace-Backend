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
exports.userRouter = void 0;
const express_1 = require("express");
const reviewController = __importStar(require("../controllers/reviewController"));
const userController = __importStar(require("../controllers/userController"));
const auth_1 = require("../middleware/auth");
exports.userRouter = (0, express_1.Router)();
// Mounted at /api/users.
//
// '/me', not '/:id'. The user being edited is always the one the token names, so
// there is no id for a client to tamper with and no ownership check to forget.
exports.userRouter.get('/me', auth_1.requireAuth, userController.getMe);
exports.userRouter.patch('/me', auth_1.requireAuth, userController.updateMe);
// Public — a buyer must be able to read a seller's reputation before deciding
// to trust them, which means before logging in.
exports.userRouter.get('/:id/reviews', reviewController.listForUser);
// Public too: the presence line in a conversation. See userController.presence.
exports.userRouter.get('/:id/presence', userController.presence);
//# sourceMappingURL=userRouter.js.map
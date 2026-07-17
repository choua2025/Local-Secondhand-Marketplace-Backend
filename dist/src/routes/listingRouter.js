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
exports.listingRouter = void 0;
const express_1 = require("express");
const listingController = __importStar(require("../controllers/listingController"));
const auth_1 = require("../middleware/auth");
exports.listingRouter = (0, express_1.Router)();
// Public reads. Mounted at /api/listings.
exports.listingRouter.get('/', listingController.browse);
// These MUST precede '/:id'. Express matches routes in declaration order, so in
// the reverse order these URLs would bind id="cities" / id="mine" and 400.
exports.listingRouter.get('/cities', listingController.cities);
exports.listingRouter.get('/mine', auth_1.requireAuth, listingController.listMine);
exports.listingRouter.get('/:id', listingController.getById);
// Public, but attachUser sets req.userId when a token is present so the service
// can skip the owner's own views. Not requireAuth: logged-out views count too.
exports.listingRouter.post('/:id/view', auth_1.attachUser, listingController.registerView);
// Protected writes. requireAuth sets req.userId; the SERVICE decides whether
// that user owns the row — authentication here, authorization there.
exports.listingRouter.post('/', auth_1.requireAuth, listingController.create);
exports.listingRouter.patch('/:id', auth_1.requireAuth, listingController.update);
exports.listingRouter.delete('/:id', auth_1.requireAuth, listingController.remove);
//# sourceMappingURL=listingRouter.js.map
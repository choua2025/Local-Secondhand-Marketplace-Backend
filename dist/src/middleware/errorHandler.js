"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = exports.errorHandler = void 0;
const errors_1 = require("../errors");
/**
 * The one and only error middleware. Express identifies it by its four-argument
 * signature, so `next` must stay in the parameter list even though it is unused.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * which is why there is no `asyncHandler` wrapper anywhere in this codebase.
 * (Under Express 4 you would have needed one: an async controller that rejected
 * would have hung the request instead of reaching this function.)
 */
const errorHandler = (err, _req, res, _next) => {
    if (err instanceof errors_1.AppError) {
        res.status(err.status).json({ error: err.message });
        return;
    }
    // Anything unrecognised is a bug on our side. Log the real thing for us,
    // return something opaque to the client — stack traces and driver messages
    // are an information leak.
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
};
exports.errorHandler = errorHandler;
/** 404 for URLs no router claimed. Mounted after all routers, before errorHandler. */
const notFoundHandler = (_req, res) => {
    res.status(404).json({ error: 'Not found' });
};
exports.notFoundHandler = notFoundHandler;
//# sourceMappingURL=errorHandler.js.map
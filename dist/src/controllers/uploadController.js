"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signature = signature;
const errors_1 = require("../errors");
const cloudinary_1 = require("../lib/cloudinary");
/**
 * Hands a logged-in user a signature good for one upload into one folder.
 *
 * requireAuth guards the route, and that is the whole authorization story:
 * anyone with an account may upload an image. There is nothing finer to check,
 * because at this point no listing exists yet — a seller uploads photos while
 * filling in the form, before the listing they belong to has an id.
 *
 * The response includes `cloud_name` and `api_key` so the client needs no
 * Cloudinary env vars of its own. Both are public values that appear in every
 * delivery URL; only the secret matters, and it stays here.
 */
function signature(req, res) {
    if (!(0, cloudinary_1.isCloudinaryConfigured)()) {
        // 503, not 500: the server is fine, this capability is switched off.
        res.status(503).json({ error: 'Image uploads are not configured on this server.' });
        return;
    }
    const folder = req.query.folder;
    if (!(0, cloudinary_1.isUploadFolder)(folder)) {
        throw new errors_1.ValidationError(`folder must be one of: ${cloudinary_1.UPLOAD_FOLDERS.join(', ')}`);
    }
    res.json((0, cloudinary_1.signUpload)(folder));
}
//# sourceMappingURL=uploadController.js.map
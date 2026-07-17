import { Request, Response } from 'express';
import { ValidationError } from '../errors';
import { isCloudinaryConfigured, isUploadFolder, signUpload, UPLOAD_FOLDERS } from '../lib/cloudinary';

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
export function signature(req: Request, res: Response): void {
  if (!isCloudinaryConfigured()) {
    // 503, not 500: the server is fine, this capability is switched off.
    res.status(503).json({ error: 'Image uploads are not configured on this server.' });
    return;
  }

  const folder = req.query.folder;
  if (!isUploadFolder(folder)) {
    throw new ValidationError(`folder must be one of: ${UPLOAD_FOLDERS.join(', ')}`);
  }

  res.json(signUpload(folder));
}

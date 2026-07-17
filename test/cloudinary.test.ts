import { describe, expect, it } from 'vitest';
import { isCloudinaryConfigured, publicIdFromUrl } from '../src/lib/cloudinary';

/**
 * `publicIdFromUrl` is the security boundary that stops a client from naming an
 * asset it does not own. Everything it accepts, we are willing to delete — so
 * these tests care far more about what it *rejects* than what it parses.
 *
 * No network, no database: the function is pure.
 */
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;

describe.runIf(isCloudinaryConfigured())('publicIdFromUrl', () => {
  const base = `https://res.cloudinary.com/${CLOUD}/image/upload`;

  it.each([
    ['a versioned url', `${base}/v1699887766/listings/abc123.jpg`, 'listings/abc123'],
    ['no version', `${base}/listings/abc123.jpg`, 'listings/abc123'],
    ['transformations before the version', `${base}/w_400,h_300,c_fill/v1/listings/abc.png`, 'listings/abc'],
    ['a nested folder', `${base}/v1/listings/2026/07/abc.webp`, 'listings/2026/07/abc'],
    ['no extension', `${base}/v1/avatars/xyz`, 'avatars/xyz'],
    ['a dot in a folder name', `${base}/v1/my.photos/cat.jpg`, 'my.photos/cat'],
  ])('extracts the public_id from %s', (_label, url, expected) => {
    expect(publicIdFromUrl(url)).toBe(expected);
  });

  /**
   * Every one of these must be null. A non-null answer here is an instruction to
   * delete a file, so a false positive on someone else's URL is a way to destroy
   * their images through our own cleanup code.
   */
  it.each([
    ['another cloud account', 'https://res.cloudinary.com/someone-else/image/upload/v1/a.jpg'],
    ['a lookalike host', `https://res.cloudinary.com.evil.test/${CLOUD}/image/upload/v1/a.jpg`],
    ['a different host entirely', `https://evil.test/${CLOUD}/image/upload/v1/a.jpg`],
    ['plain http', `http://res.cloudinary.com/${CLOUD}/image/upload/v1/a.jpg`],
    ['a video asset', `https://res.cloudinary.com/${CLOUD}/video/upload/v1/a.mp4`],
    ['a fetch/delivery type we do not use', `https://res.cloudinary.com/${CLOUD}/image/fetch/v1/a.jpg`],
    ['an unrelated image host', 'https://example.com/photo.jpg'],
    ['no path after upload', `${'https://res.cloudinary.com/' + CLOUD}/image/upload`],
    ['not a url at all', 'listings/abc123'],
    ['empty', ''],
  ])('returns null for %s', (_label, url) => {
    expect(publicIdFromUrl(url)).toBeNull();
  });
});

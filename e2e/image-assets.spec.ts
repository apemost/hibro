import { expect, test } from '@playwright/test';
import {
  decodeImageBase64,
  normalizeImageMediaType,
} from '../src/shared/imageAssets';
import { validateRemoteImageUrl } from '../src/shared/remoteImages';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('image asset bytes must match their declared supported raster type', () => {
  expect(normalizeImageMediaType('image/png; charset=binary')).toBe(
    'image/png',
  );
  expect(normalizeImageMediaType('image/svg+xml')).toBeNull();
  expect(decodeImageBase64(ONE_PIXEL_PNG_BASE64, 'image/png', 68)).toHaveLength(
    68,
  );
  expect(decodeImageBase64(ONE_PIXEL_PNG_BASE64, 'image/png', 67)).toBeNull();
  expect(decodeImageBase64(ONE_PIXEL_PNG_BASE64, 'image/jpeg')).toBeNull();
  expect(decodeImageBase64('not base64', 'image/png')).toBeNull();
});

test('remote image destinations accept only public-looking credential-free HTTPS hosts', () => {
  expect(
    validateRemoteImageUrl('HTTPS://Images.Example.COM/a.png#tracking'),
  ).toEqual({
    ok: true,
    url: 'https://images.example.com/a.png',
    host: 'images.example.com',
  });

  for (const url of [
    'http://images.example.com/a.png',
    'https://user:secret@images.example.com/a.png',
    'https://localhost./a.png',
    'https://sub.localhost/a.png',
    'https://printer.local/a.png',
    'https://service.internal/a.png',
    'https://home.arpa/a.png',
    'https://asset.test/a.png',
    'https://asset.invalid/a.png',
    'https://asset.example/a.png',
    'https://hidden.onion/a.png',
    'https://intranet/a.png',
    'https://127.1/a.png',
    'https://2130706433/a.png',
    'https://8.8.8.8/a.png',
    'https://[::1]/a.png',
    'https://[fd00::1]/a.png',
  ]) {
    expect(validateRemoteImageUrl(url), url).toEqual({
      ok: false,
      error: 'blocked-url',
    });
  }
});

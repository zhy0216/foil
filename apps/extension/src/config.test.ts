import { expect, it } from 'vitest';
import { resolveShareBaseUrl } from './config';

it('defaults to the public website without needing a window or extension origin', () => {
  expect(resolveShareBaseUrl(undefined)).toBe('https://foil-47v.pages.dev/');
});

it.each([
  ['https://example.github.io/foil/?source=extension#old', 'https://example.github.io/foil/'],
  ['http://127.0.0.1:4173/foil/', 'http://127.0.0.1:4173/foil/'],
  ['HTTPS://EXAMPLE.COM', 'https://example.com/'],
])('preserves a normalized HTTP(S) origin and subpath: %s', (input, expected) => {
  expect(resolveShareBaseUrl(input)).toBe(expected);
});

it.each([
  '', ' ', '/foil/', '//example.com/', 'chrome-extension://id/index.html',
  'file:///tmp/foil.html', 'javascript:alert(1)', 'https://user:secret@example.com/',
  'https://@example.com/', 'https://example.com/with space', 'https://example.com\\evil',
  `https://example.com/${'x'.repeat(2048)}`,
])('rejects explicit invalid configuration without falling back or echoing it: %s', input => {
  expect(() => resolveShareBaseUrl(input)).toThrow('VITE_FOIL_SHARE_BASE_URL must be an absolute HTTP(S) URL without credentials.');
});

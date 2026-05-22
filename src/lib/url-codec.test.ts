// @vitest-environment node
// Node 18+ has Blob, CompressionStream, and Web Crypto as globals; jsdom's Blob
// lacks `.stream()`, so url-codec's gzip path needs the node env to work.
import { describe, it, expect } from 'vitest';
import { encodeUrl, decodeUrl } from './url-codec';
import type { DocState } from '../types';

const sample: DocState = { md: 'top secret', comments: [], title: 'note' };

describe('url-codec #e= password encryption', () => {
  it('round-trips a password-encrypted URL', async () => {
    const url = await encodeUrl(sample, { password: 'correct horse' });
    expect(url.startsWith('#e=')).toBe(true);
    const decoded = await decodeUrl(url, 'correct horse');
    expect(decoded.state?.md).toBe('top secret');
    expect(decoded.state?.title).toBe('note');
  });

  it('reports encrypted when no password is supplied', async () => {
    const url = await encodeUrl(sample, { password: 'pw' });
    const decoded = await decodeUrl(url);
    expect(decoded.encrypted).toBe('password');
    expect(decoded.state).toBeUndefined();
  });

  it('returns an error when the password is wrong', async () => {
    const url = await encodeUrl(sample, { password: 'right' });
    const decoded = await decodeUrl(url, 'wrong');
    expect(decoded.state).toBeUndefined();
    expect(decoded.error).toBeTruthy();
  });
});

describe('url-codec #d= plain encoding', () => {
  it('round-trips an unencrypted document', async () => {
    const url = await encodeUrl(sample, {});
    expect(url.startsWith('#d=')).toBe(true);
    const decoded = await decodeUrl(url);
    expect(decoded.state?.md).toBe('top secret');
  });
});

// @vitest-environment node
// Node 18+ has Blob, CompressionStream, and Web Crypto as globals; jsdom's Blob
// lacks `.stream()`, so url-codec's gzip path needs the node env to work.
import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  encodeUrl, decodeUrl, encodeHtmlPayload, decodeHtmlPayload, validateHtmlPayload,
  openTimeCapsule, SHARE_LIMITS, HTML_PAYLOAD_MAX_CHARS, type TimeCapsuleEnvelope,
} from './url-codec';
import { timelockEncrypt, timelockDecrypt, roundAtUnix, unixMsAtRound, NotYetReadyError, NoEndpointError } from './timecapsule';
import type { DocState } from '../types';

vi.mock('./timecapsule', async (importOriginal) => ({
  ...await importOriginal<typeof import('./timecapsule')>(),
  timelockEncrypt: vi.fn(),
  timelockDecrypt: vi.fn(),
}));

const sample: DocState = { md: 'top secret', comments: [], title: 'note' };
const rich: DocState = {
  title: '标题 👩🏽‍💻', md: '#  中文 🐈\n\t保留空白\u200b与换行\n',
  comments: [
    {
      id: '讨论["甲"]\\', quote: '中文', before: '#  ', after: ' 🐈',
      replies: [
        { id: 'r:1', author: '甲', body: '多行\n回复 💬', ts: 1_700_000_000_000 },
        { id: 'r:2', author: '乙', body: '', ts: 0 },
      ],
    },
    { id: 'c2', quote: '空白', before: '\t保留', after: '\u200b', replies: [] },
  ],
};

const schemes = ['d', 'e', 'td', 'te'] as const;
type Scheme = typeof schemes[number];
const password = 'correct horse 🔑';
const targetMs = 1_893_456_000_000;
const round = roundAtUnix(targetMs);
const seal = vi.mocked(timelockEncrypt);
const unseal = vi.mocked(timelockDecrypt);
const utf8 = new TextEncoder();
const NativeCompressionStream = globalThis.CompressionStream;

async function gzipFixture(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(new NativeCompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const bytes = (value: unknown) => utf8.encode(JSON.stringify(value));
const b64u = (value: Uint8Array) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (value: string) => new Uint8Array(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
const armor = (body: string) => `-----BEGIN AGE ENCRYPTED FILE-----\n${body}\n-----END AGE ENCRYPTED FILE-----\n`;
const options = (scheme: Scheme) => ({
  ...(scheme === 'e' || scheme === 'te' ? { password } : {}),
  ...(scheme === 'td' || scheme === 'te' ? { unlockMs: targetMs } : {}),
});

function envelope(payload: Uint8Array = bytes(sample)): TimeCapsuleEnvelope {
  return { v: 1, age: armor(Buffer.from(payload).toString('base64')), round, unlockMs: unixMsAtRound(round) };
}

// Independent fixture writer for malformed/deep-layer input. Fixed salt/IV
// and a cached test key keep the matrix fast; production encryption uses fresh
// random values and its real 600,000-round KDF is exercised by round trips.
const salt = new Uint8Array(16).fill(7);
const iv = new Uint8Array(12).fill(9);
let fixtureKey: Promise<CryptoKey> | undefined;
async function encryptFixture(plaintext: Uint8Array): Promise<Uint8Array> {
  fixtureKey ??= crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']).then((key) =>
    crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
      key, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    ));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await fixtureKey, plaintext as BufferSource);
  const out = new Uint8Array(salt.length + iv.length + ct.byteLength);
  out.set(salt);
  out.set(iv, salt.length);
  out.set(new Uint8Array(ct), salt.length + iv.length);
  return out;
}

async function wire(scheme: Scheme, payload: Uint8Array): Promise<string> {
  const data = scheme === 'e' || scheme === 'te' ? await encryptFixture(payload) : payload;
  return '#' + scheme + '=' + b64u(data);
}

async function documentLink(scheme: Scheme, json: Uint8Array, raw = false): Promise<string> {
  const payload = raw ? json : await gzipFixture(json);
  if (scheme === 'td' || scheme === 'te') {
    const env = bytes(envelope(payload));
    return wire(scheme, raw ? env : await gzipFixture(env));
  }
  return wire(scheme, payload);
}

async function readDocument(hash: string, pw = password, decode = decodeUrl): Promise<DocState | undefined> {
  const result = await decode(hash, pw);
  if (result.error) throw new Error(result.error);
  return result.timeCapsule ? openTimeCapsule(result.timeCapsule) : result.state;
}

function sizedDocument(size: number): DocState {
  const blank = { ...sample, md: '' };
  return { ...blank, md: 'x'.repeat(size - bytes(blank).length) };
}

function sizedEnvelope(size: number): TimeCapsuleEnvelope & { padding: string } {
  const blank = { ...envelope(), padding: '' };
  return { ...blank, padding: 'x'.repeat(size - bytes(blank).length) };
}

function commented(threads: number, replies: number): DocState {
  return {
    ...sample,
    comments: Array.from({ length: threads }, (_, i) => ({
      id: `c${i}`, quote: '', before: '', after: '',
      replies: Array.from({ length: replies }, (_, j) => ({
        id: `r${i}-${j}`, author: '', body: '', ts: 0,
      })),
    })),
  };
}

function noisyDocument(noiseBytes = 256 * 1024): DocState {
  // Deterministic, poorly compressible data for transport and cumulative limits.
  const noise = new Uint8Array(noiseBytes);
  let seed = 123456789;
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    noise[i] = seed & 255;
  }
  return { ...rich, md: Buffer.from(noise).toString('base64') };
}

beforeEach(() => {
  // These tests must never contact drand, even accidentally.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network access'); }));
  seal.mockReset().mockImplementation(async (payload) =>
    armor(Buffer.from(payload as unknown as ArrayBuffer).toString('base64')));
  unseal.mockReset().mockImplementation(async (age) => {
    const body = age.split('\n').slice(1, -2).join('');
    return new Uint8Array(Buffer.from(body, 'base64'));
  });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

describe('four-scheme compatibility', () => {
  it.each(schemes)('round-trips #%s= with all text, IDs, comments, and replies intact', async (scheme) => {
    const hash = await encodeUrl(rich, options(scheme));
    expect(hash.startsWith(`#${scheme}=`)).toBe(true);
    expect(await readDocument(hash)).toEqual(rich);
    if (scheme === 'td' || scheme === 'te') {
      const result = await decodeUrl(hash, password);
      expect(result.timeCapsule).toMatchObject({ v: 1, round, unlockMs: unixMsAtRound(round) });
      expect(seal).toHaveBeenCalledWith(expect.any(Uint8Array), round);
      expect(unseal).toHaveBeenCalledWith(result.timeCapsule!.age);
    } else {
      expect(seal).not.toHaveBeenCalled();
      expect(unseal).not.toHaveBeenCalled();
    }
  });

  it('opens frozen links produced by the baseline codec (737c7e8)', async () => {
    const plain = '#d=H4sIAAAAAAAAE6tWyk1RslIqyS9QKE5NLkotUdJRSs7PzU3NKylWsoqO1VEqySzJSVWyUsrLL0lVqgUAUzSAhTAAAAA';
    const encrypted = '#e=4nMA6t8CgRKMueWUNc2plNkyUIDpYseB67A22TJpcIlSHZG5NSqBFfUV_V5dLtMSSmWydai1NmdPw-im6ptf7DD2yotr6m3BNYx_WsHTx5JV236L1OKqhw2-eFA4db50mHSx0699tLJds7W6mdebeg';
    expect(await decodeUrl(plain)).toEqual({ state: sample });
    expect(await decodeUrl(encrypted, 'legacy password')).toEqual({ state: sample });
  });

  it.each(schemes)('opens identifiable legacy raw JSON at every #%s= layer without decompression APIs', async (scheme) => {
    const hash = await documentLink(scheme, bytes(rich), true);
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await readDocument(hash)).toEqual(rich);
  });

  it('accepts optional canonical base64 padding and an omitted leading #', async () => {
    const value = bytes(sample);
    const b64 = Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    expect(await decodeUrl('d=' + b64)).toEqual({ state: sample });
  });

  it('retains the empty-fragment result', async () => {
    expect(await decodeUrl('')).toEqual({});
    expect(await decodeUrl('#')).toEqual({});
  });
});

describe('document validation on every receiving layer', () => {
  it.each(schemes)('rejects malformed document shapes and duplicate IDs in #%s=', async (scheme) => {
    const duplicate = commented(2, 1);
    duplicate.comments[1].replies[0].id = duplicate.comments[0].replies[0].id;
    for (const value of [null, [], { ...sample, title: {} }, { ...rich, md: {} }, {
      ...rich, comments: [{ ...rich.comments[0], replies: [{ ...rich.comments[0].replies[0], body: {} }] }],
    }, duplicate]) {
      const hash = await documentLink(scheme, bytes(value));
      await expect(readDocument(hash)).rejects.toThrow('Invalid document data');
    }
  });

  it.each(schemes)('rejects overflow numeric timestamps in #%s= JSON', async (scheme) => {
    const json = JSON.stringify(rich).replace('1700000000000', '1e999');
    await expect(readDocument(await documentLink(scheme, utf8.encode(json)))).rejects.toThrow('Invalid document data');
  });

  it.each(schemes)('rejects malformed JSON and invalid UTF-8 without quoting payloads in #%s=', async (scheme) => {
    const secret = 'PRIVATE BODY AND PASSWORD';
    const invalidUtf8 = new Uint8Array([...utf8.encode('{"md":"'), 0xff, ...utf8.encode('","title":"","comments":[]}')]);
    for (const malformed of [utf8.encode(`{"md":"${secret}", BROKEN`), invalidUtf8]) {
      await expect(readDocument(await documentLink(scheme, malformed))).rejects.toThrow('Invalid share data');
    }
  });

  it.each(schemes)('checks shape and finite timestamps before encoding #%s=', async (scheme) => {
    const bad = { ...rich, comments: [{ ...rich.comments[0], replies: [{ ...rich.comments[0].replies[0], ts: NaN }] }] };
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(encodeUrl(bad, options(scheme))).rejects.toThrow('Invalid document data');
    expect(kdf).not.toHaveBeenCalled();
    expect(seal).not.toHaveBeenCalled();
  });
});

describe('envelope validation and tlock boundary', () => {
  const invalidMetadata = [
    { v: 0 }, { v: 2 }, { v: '1' }, { age: null }, { age: {} }, { age: '' },
    { age: ' ' }, { age: 'not age armor' }, { age: armor('!bad!') },
    { round: -1 }, { round: 0 }, { round: 1.5 }, { round: '1' },
    { round: Number.MAX_SAFE_INTEGER + 1 }, { round: Number.MAX_SAFE_INTEGER },
    { round: NaN }, { round: Infinity }, { unlockMs: null }, { unlockMs: '123' },
    { unlockMs: 8.64e15 + 1 }, { unlockMs: NaN }, { unlockMs: Infinity },
    { unlockMs: unixMsAtRound(round) + 1 },
  ];

  it.each(['td', 'te'] as const)('rejects invalid metadata in #%s= before exposing an envelope', async (scheme) => {
    for (const change of invalidMetadata) {
      const value = { ...envelope(), ...change };
      const result = await decodeUrl(await wire(scheme, await gzipFixture(bytes(value))), password);
      expect(result).toEqual({ error: 'Invalid time-capsule envelope' });
    }
    for (const value of [null, [], {}]) {
      expect(await decodeUrl(await wire(scheme, await gzipFixture(bytes(value))), password)).toEqual({ error: 'Invalid time-capsule envelope' });
    }
    expect(unseal).not.toHaveBeenCalled();
  });

  it('revalidates direct openTimeCapsule calls before tlock', async () => {
    for (const change of invalidMetadata) {
      await expect(openTimeCapsule({ ...envelope(), ...change } as TimeCapsuleEnvelope)).rejects.toThrow('Invalid time-capsule envelope');
    }
    expect(unseal).not.toHaveBeenCalled();
  });

  it('accepts past and future consistent metadata but always requires tlock verification', async () => {
    for (const r of [1, round]) {
      const env = { ...envelope(), round: r, unlockMs: unixMsAtRound(r) };
      unseal.mockRejectedValueOnce(new Error('sensitive ciphertext details'));
      await expect(openTimeCapsule(env)).rejects.toThrow(/^Could not open time capsule$/);
      expect(unseal).toHaveBeenLastCalledWith(env.age);
    }
  });

  it('keeps retryable and offline error types with safe messages', async () => {
    unseal.mockRejectedValueOnce(new NotYetReadyError(0));
    await expect(openTimeCapsule(envelope())).rejects.toThrow(NotYetReadyError);
    const offline = new NoEndpointError();
    offline.message = 'private payload in a dependency error';
    unseal.mockRejectedValueOnce(offline);
    await expect(openTimeCapsule(envelope())).rejects.toThrow(/^All drand endpoints unreachable$/);
  });

  it('rejects corrupt tlock plaintext and sanitizes sealing failures', async () => {
    unseal.mockResolvedValueOnce(utf8.encode('PRIVATE BODY'));
    await expect(openTimeCapsule(envelope())).rejects.toThrow(/^Invalid share data$/);
    seal.mockRejectedValueOnce(new Error('PRIVATE PASSWORD OR PAYLOAD'));
    await expect(encodeUrl(sample, options('te'))).rejects.toThrow(/^Could not seal time capsule$/);
  });
});

describe('cheap wire checks and authenticated password layer', () => {
  it.each(schemes)('rejects malformed base64 in #%s= before PBKDF2', async (scheme) => {
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    for (const data of ['', '!', 'AA A', 'A', 'Zg===', 'Zg=', 'Zh', 'Zm9', 'AA+A', 'AA/A', 'AA%20', '中文']) {
      const result = await decodeUrl(`#${scheme}=${data}`, password);
      expect(result.error).toBe('Invalid share encoding');
      expect(result.state).toBeUndefined();
      expect(result.timeCapsule).toBeUndefined();
    }
    expect(kdf).not.toHaveBeenCalled();
  });

  it.each(['e', 'te'] as const)('checks #%s= salt/IV/tag/minimum plaintext before prompting or deriving', async (scheme) => {
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    for (const size of [1, 15, 16, 27, 28, 43, 44]) {
      const hash = `#${scheme}=` + b64u(Buffer.alloc(size));
      for (const pw of [undefined, password]) {
        expect(await decodeUrl(hash, pw)).toEqual({ error: 'Invalid encrypted share data' });
      }
    }
    expect(kdf).not.toHaveBeenCalled();
  });

  it.each(['e', 'te'] as const)('prompts for #%s= and rejects wrong passwords, tampering, and truncation', async (scheme) => {
    const hash = await encodeUrl(sample, options(scheme));
    expect(await decodeUrl(hash)).toEqual({ encrypted: scheme === 'e' ? 'password' : 'time-password' });
    expect(await decodeUrl(hash, 'wrong password')).toEqual({ error: 'Incorrect password or damaged share link' });
    const payload = fromB64u(hash.slice(hash.indexOf('=') + 1));
    for (const index of [0, 16, 28, payload.length - 1]) {
      const damaged = Buffer.from(payload);
      damaged[index] ^= 1;
      expect(await decodeUrl(`#${scheme}=` + b64u(damaged), password)).toEqual({ error: 'Incorrect password or damaged share link' });
    }
    expect(await decodeUrl(`#${scheme}=` + b64u(payload.subarray(0, -1)), password)).toEqual({ error: 'Incorrect password or damaged share link' });
    expect(unseal).not.toHaveBeenCalled();
  });

  it('keeps AES-GCM-256, PBKDF2-SHA256 600k, 16-byte salt, and 12-byte IV', async () => {
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    const aes = vi.spyOn(crypto.subtle, 'encrypt');
    await encodeUrl(sample, { password });
    expect(kdf).toHaveBeenCalledWith(
      { name: 'PBKDF2', salt: expect.any(Uint8Array), iterations: 600_000, hash: 'SHA-256' },
      expect.anything(), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    expect((kdf.mock.calls[0][0] as Pbkdf2Params).salt.byteLength).toBe(16);
    expect(aes.mock.calls[0][0]).toMatchObject({ name: 'AES-GCM', iv: expect.any(Uint8Array) });
    expect((aes.mock.calls[0][0] as AesGcmParams).iv.byteLength).toBe(12);
  });

  it.each(['#v2=AA', '#unknown=AA', '#d', '#=AA'])('rejects unsupported or malformed schemes: %s', async (hash) => {
    expect(await decodeUrl(hash)).toEqual({ error: 'Unsupported share scheme' });
  });
});

describe('bounded decoding and encoding', () => {
  it.each(schemes)('accepts the largest possible #%s= wire payload and rejects beyond 256 KiB', async (scheme) => {
    const encrypted = scheme === 'e' || scheme === 'te';
    const prefix = `#${scheme}=`;
    const wireSize = Math.floor((SHARE_LIMITS.fragmentChars - prefix.length) * 3 / 4);
    const plaintextSize = wireSize - (encrypted ? 44 : 0);
    const value = scheme === 'td' || scheme === 'te' ? envelope() : sample;
    const json = JSON.stringify(value);
    const hash = await wire(scheme, utf8.encode(json + ' '.repeat(plaintextSize - utf8.encode(json).length)));
    expect(hash.length).toBeLessThanOrEqual(SHARE_LIMITS.fragmentChars);
    expect(SHARE_LIMITS.fragmentChars - hash.length).toBeLessThanOrEqual(1);
    expect(await readDocument(hash)).toEqual(sample);
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    expect(await decodeUrl(hash + 'AA', password)).toEqual({ error: 'Share link exceeds the 256 KiB limit' });
    expect(kdf).not.toHaveBeenCalled();
  });

  it.each(schemes)('round-trips exactly 4 MiB of document JSON in #%s=', async (scheme) => {
    const doc = sizedDocument(SHARE_LIMITS.layerBytes);
    expect(bytes(doc).length).toBe(SHARE_LIMITS.layerBytes);
    const hash = await encodeUrl(doc, options(scheme));
    expect(await readDocument(hash)).toEqual(doc);
  });

  it.each(schemes)('rejects a small gzip expanding beyond 4 MiB of #%s= document data', async (scheme) => {
    const doc = sizedDocument(SHARE_LIMITS.layerBytes + 1);
    const hash = await documentLink(scheme, bytes(doc));
    expect(hash.length).toBeLessThan(16 * 1024);
    await expect(readDocument(hash)).rejects.toThrow('Share data exceeds the 4 MiB limit');
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    seal.mockClear();
    await expect(encodeUrl(doc, options(scheme))).rejects.toThrow('Share data exceeds the 4 MiB limit');
    expect(kdf).not.toHaveBeenCalled();
    expect(seal).not.toHaveBeenCalled();
  });

  it.each(['td', 'te'] as const)('bounds the decompressed #%s= envelope independently', async (scheme) => {
    const valid = sizedEnvelope(SHARE_LIMITS.layerBytes);
    const hash = await wire(scheme, await gzipFixture(bytes(valid)));
    expect(await decodeUrl(hash, password)).toEqual({ timeCapsule: valid });
    expect(await readDocument(hash)).toEqual(sample);
    const oversized = sizedEnvelope(SHARE_LIMITS.layerBytes + 1);
    expect(await decodeUrl(await wire(scheme, await gzipFixture(bytes(oversized))), password)).toEqual({ error: 'Share data exceeds the 4 MiB limit' });
    await expect(openTimeCapsule(oversized)).rejects.toThrow('Share data exceeds the 4 MiB limit');
  });

  it('bounds raw tlock plaintext before parsing or decompression', async () => {
    unseal.mockResolvedValueOnce(new Uint8Array(SHARE_LIMITS.layerBytes + 1));
    await expect(openTimeCapsule(envelope())).rejects.toThrow('Share data exceeds the 4 MiB limit');
  });

  it('allows exactly 8 MiB in a capsule open, and stops when multiple valid layers exceed the total budget', async () => {
    const env = sizedEnvelope(SHARE_LIMITS.layerBytes);
    const doc = sizedDocument(SHARE_LIMITS.layerBytes);
    unseal.mockResolvedValueOnce(bytes(doc));
    expect(await openTimeCapsule(env)).toEqual(doc);
    unseal.mockResolvedValueOnce(await gzipFixture(bytes(doc)));
    await expect(openTimeCapsule(env)).rejects.toThrow('Share data exceeds the total byte budget');
  });

  it.each(['td', 'te'] as const)('applies envelope and total-byte limits before generating #%s=', async (scheme) => {
    seal.mockResolvedValueOnce(armor('A'.repeat(SHARE_LIMITS.layerBytes)));
    await expect(encodeUrl(sample, options(scheme))).rejects.toThrow('Share data exceeds the 4 MiB limit');
    const blank = { ...envelope(), age: armor('') };
    seal.mockResolvedValueOnce(armor('A'.repeat(SHARE_LIMITS.layerBytes - bytes(blank).length)));
    await expect(encodeUrl(sizedDocument(SHARE_LIMITS.layerBytes), options(scheme))).rejects.toThrow('Share data exceeds the total byte budget');
  });

  it.each(schemes)('enforces 1000 threads and 200 replies per thread for both #%s= directions', async (scheme) => {
    for (const doc of [commented(1000, 0), commented(1, 200)]) {
      expect(await readDocument(await encodeUrl(doc, options(scheme)))).toEqual(doc);
    }
    for (const [doc, error] of [
      [commented(1001, 0), 'Too many comment threads'],
      [commented(1, 201), 'Too many replies'],
    ] as const) {
      await expect(encodeUrl(doc, options(scheme))).rejects.toThrow(error);
      await expect(readDocument(await documentLink(scheme, bytes(doc)))).rejects.toThrow(error);
    }
  });

  it.each(schemes)('counts UTF-8 bytes and JSON escaping in #%s= generation', async (scheme) => {
    for (const md of ['文'.repeat(Math.ceil(SHARE_LIMITS.layerBytes / 3)), '\u0000'.repeat(Math.ceil(SHARE_LIMITS.layerBytes / 6))]) {
      expect(md.length).toBeLessThan(SHARE_LIMITS.layerBytes);
      await expect(encodeUrl({ ...sample, md }, options(scheme))).rejects.toThrow('Share data exceeds the 4 MiB limit');
    }
  });

  it.each(schemes)('rejects a generated #%s= fragment beyond its limit before password derivation', async (scheme) => {
    const doc = noisyDocument();
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(encodeUrl(doc, options(scheme))).rejects.toThrow('Share link exceeds the 256 KiB limit');
    expect(kdf).not.toHaveBeenCalled();
  });

  it('cancels an over-limit decompression reader immediately and releases its lock', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const chunk = new Uint8Array(64 * 1024);
    const readable = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(chunk); },
      cancel,
    }, { highWaterMark: 0 });
    const getReader = readable.getReader.bind(readable);
    const release = vi.fn();
    vi.spyOn(readable, 'getReader').mockImplementation(() => {
      const reader = getReader();
      const releaseLock = reader.releaseLock.bind(reader);
      reader.releaseLock = () => { release(); releaseLock(); };
      return reader;
    });
    vi.stubGlobal('DecompressionStream', class {
      readable = readable;
      writable = new WritableStream<Uint8Array>();
    });
    expect(await decodeUrl(await wire('d', await gzipFixture(bytes(sample))))).toEqual({ error: 'Share data exceeds the 4 MiB limit' });
    expect(pulls).toBe(SHARE_LIMITS.layerBytes / chunk.length + 1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(readable.locked).toBe(false);
  });
});

describe('compression compatibility and capabilities', () => {
  it.each(schemes)('never falls back after damaged/truncated gzip in #%s=', async (scheme) => {
    const compressed = await gzipFixture(bytes(sample));
    const damaged = Buffer.from(compressed);
    damaged[damaged.length - 8] ^= 1; // CRC tampering, with intact gzip magic.
    for (const payload of [damaged, compressed.subarray(0, -1), new Uint8Array([0x1f, 0x8b, 0, 0]), new Uint8Array([0x1e, 0x8b, 0, 0])]) {
      const data = scheme === 'td' || scheme === 'te' ? await gzipFixture(bytes(envelope(payload))) : payload;
      await expect(readDocument(await wire(scheme, data))).rejects.toThrow(/Invalid (gzip )?share data/);
    }
  });

  it.each(['td', 'te'] as const)('rejects corrupt gzip around the #%s= envelope', async (scheme) => {
    const compressed = await gzipFixture(bytes(envelope()));
    const result = await decodeUrl(await wire(scheme, compressed.subarray(0, -1)), password);
    expect(result).toEqual({ error: 'Invalid gzip share data' });
  });

  it.each(schemes)('reports a decompression capability error for gzipped #%s=', async (scheme) => {
    const hash = await documentLink(scheme, bytes(sample));
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(readDocument(hash)).rejects.toThrow('Gzip decompression is not supported in this browser');
  });

  it('reports missing decompression support after tlock, even with a raw envelope', async () => {
    const hash = await wire('td', bytes(envelope(await gzipFixture(bytes(sample)))));
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(readDocument(hash)).rejects.toThrow('Gzip decompression is not supported in this browser');
  });

  it.each(schemes)('reports missing compression capability when generating #%s=', async (scheme) => {
    vi.stubGlobal('CompressionStream', undefined);
    await expect(encodeUrl(sample, options(scheme))).rejects.toThrow('Compression is not supported in this browser');
  });

  it('reports missing Web Crypto explicitly', async () => {
    const hash = await wire('e', await gzipFixture(bytes(sample)));
    vi.stubGlobal('crypto', undefined);
    expect(await decodeUrl(hash, password)).toEqual({ error: 'Password sharing is not supported in this browser' });
    await expect(encodeUrl(sample, { password })).rejects.toThrow('Password sharing is not supported in this browser');
  });
});

describe('explicit time-lock options never downgrade protection', () => {
  it.each([undefined, null, NaN, Infinity, -Infinity, 0, -1, 8.64e15 + 1, '1893456000000'])('rejects an explicitly invalid unlockMs: %j', async (unlockMs) => {
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    for (const pw of [undefined, password]) {
      await expect(encodeUrl(sample, { password: pw, unlockMs } as Parameters<typeof encodeUrl>[1])).rejects.toThrow('Unlock time must be a valid future date');
    }
    expect(kdf).not.toHaveBeenCalled();
    expect(seal).not.toHaveBeenCalled();
  });

  it('rejects times at or before now, with or without a password', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(targetMs);
    for (const unlockMs of [targetMs - 1, targetMs]) {
      for (const pw of [undefined, password]) {
        await expect(encodeUrl(sample, { password: pw, unlockMs })).rejects.toThrow('Unlock time must be a valid future date');
      }
    }
  });

  it('rounds a valid future time up to the existing quicknet schedule', async () => {
    const requested = unixMsAtRound(round) + 0.5;
    const hash = await encodeUrl(sample, { unlockMs: requested });
    const result = await decodeUrl(hash);
    expect(result.timeCapsule).toMatchObject({ round: round + 1, unlockMs: unixMsAtRound(round + 1) });
  });

  it.each(['td', 'te'] as const)('rejects #%s= generation if the chosen time expires during async sealing', async (scheme) => {
    vi.useFakeTimers();
    vi.setSystemTime(targetMs - 60_000);
    seal.mockImplementationOnce(async (payload) => {
      vi.setSystemTime(targetMs);
      return armor(Buffer.from(payload as unknown as ArrayBuffer).toString('base64'));
    });
    await expect(encodeUrl(sample, options(scheme))).rejects.toThrow('Unlock time must be a valid future date');
  });
});

describe('HTML payload transport', () => {
  const read = (payload: string, pw = password) => readDocument(payload, pw, decodeHtmlPayload);

  it.each(schemes)('round-trips #%s= files and shares wire compatibility with URLs', async (scheme) => {
    const payload = await encodeHtmlPayload(rich, options(scheme));
    expect(payload.startsWith(`#${scheme}=`)).toBe(true);
    expect(() => validateHtmlPayload(payload)).not.toThrow();
    expect(await read(payload)).toEqual(rich);
    expect(await readDocument(payload)).toEqual(rich);
    expect(await read(await encodeUrl(rich, options(scheme)))).toEqual(rich);
    if (scheme === 'd' || scheme === 'e') {
      expect(seal).not.toHaveBeenCalled();
      expect(unseal).not.toHaveBeenCalled();
    }
  });

  it.each(schemes)('round-trips #%s= files beyond 256 KiB while both URL directions keep rejecting them', async (scheme) => {
    const doc = noisyDocument();
    const payload = await encodeHtmlPayload(doc, options(scheme));
    expect(payload.length).toBeGreaterThan(SHARE_LIMITS.fragmentChars);
    expect(payload.length).toBeLessThan(HTML_PAYLOAD_MAX_CHARS);
    expect(await read(payload)).toEqual(doc);
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    const allocate = vi.spyOn(globalThis, 'atob');
    expect(await decodeUrl(payload, password)).toEqual({ error: 'Share link exceeds the 256 KiB limit' });
    await expect(encodeUrl(doc, options(scheme))).rejects.toThrow('Share link exceeds the 256 KiB limit');
    expect(kdf).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  });

  it.each(['e', 'te'] as const)('keeps the #%s= password outside all other layers and permits retries', async (scheme) => {
    const payload = await encodeHtmlPayload(rich, options(scheme));
    expect(await decodeHtmlPayload(payload)).toEqual({ encrypted: scheme === 'e' ? 'password' : 'time-password' });
    expect(await decodeHtmlPayload(payload, 'wrong')).toEqual({ error: 'Incorrect password or damaged share link' });
    expect(unseal).not.toHaveBeenCalled();
    // Removing the visible encrypted scheme cannot expose JSON or an envelope.
    const withoutPassword = payload.replace(`#${scheme}=`, scheme === 'e' ? '#d=' : '#td=');
    expect(await decodeHtmlPayload(withoutPassword)).toEqual({ error: expect.any(String) });
    const damaged = fromB64u(payload.slice(payload.indexOf('=') + 1));
    damaged[damaged.length - 1] ^= 1;
    expect(await decodeHtmlPayload(`#${scheme}=` + b64u(damaged), password)).toEqual({ error: 'Incorrect password or damaged share link' });
    expect(await read(payload)).toEqual(rich);
    if (scheme === 'te') {
      const compressed = seal.mock.calls[0][0] as Uint8Array;
      expect(Array.from(compressed.subarray(0, 2))).toEqual([0x1f, 0x8b]);
      const plain = await new Response(new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
      expect(plain).toEqual(rich);
    }
  });

  it.each(['td', 'te'] as const)('retains #%s= time/network errors and can retry the same envelope', async (scheme) => {
    const payload = await encodeHtmlPayload(rich, options(scheme));
    const decoded = await decodeHtmlPayload(payload, password);
    expect(decoded.timeCapsule).toMatchObject({ v: 1, round, unlockMs: unixMsAtRound(round) });
    expect(decoded.state).toBeUndefined();
    unseal.mockRejectedValueOnce(new NotYetReadyError(round));
    await expect(openTimeCapsule(decoded.timeCapsule!)).rejects.toThrow(NotYetReadyError);
    unseal.mockRejectedValueOnce(new NoEndpointError());
    await expect(openTimeCapsule(decoded.timeCapsule!)).rejects.toThrow(NoEndpointError);
    await expect(openTimeCapsule(decoded.timeCapsule!)).resolves.toEqual(rich);
  });

  it.each(['td', 'te'] as const)('rejects invalid, past and expired #%s= dates without dropping protection', async (scheme) => {
    vi.useFakeTimers();
    vi.setSystemTime(targetMs);
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    const compress = vi.fn();
    vi.stubGlobal('CompressionStream', class { constructor() { compress(); } });
    for (const unlockMs of [undefined, null, NaN, Infinity, targetMs - 1, targetMs]) {
      await expect(encodeHtmlPayload(rich, { ...options(scheme), unlockMs })).rejects.toThrow('Unlock time must be a valid future date');
    }
    expect(kdf).not.toHaveBeenCalled();
    expect(seal).not.toHaveBeenCalled();
    expect(compress).not.toHaveBeenCalled();
    vi.stubGlobal('CompressionStream', NativeCompressionStream);
    vi.setSystemTime(targetMs - 60_000);
    seal.mockImplementationOnce(async payload => {
      vi.setSystemTime(targetMs);
      return armor(Buffer.from(payload as Uint8Array).toString('base64'));
    });
    await expect(encodeHtmlPayload(rich, options(scheme))).rejects.toThrow('Unlock time must be a valid future date');
  });

  it.each(schemes)('rejects oversized or malformed #%s= strings before byte allocation, KDF or gzip', async (scheme) => {
    expect(HTML_PAYLOAD_MAX_CHARS).toBe(5_592_468);
    const allocate = vi.spyOn(globalThis, 'atob');
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    const decompress = vi.fn();
    vi.stubGlobal('DecompressionStream', class { constructor() { decompress(); } });
    const oversized = `#${scheme}=` + 'A'.repeat(HTML_PAYLOAD_MAX_CHARS);
    for (const pw of [undefined, password]) {
      expect(await decodeHtmlPayload(oversized, pw)).toEqual({ error: 'HTML share payload exceeds the character limit' });
      for (const data of ['', '!', 'A', 'AA A', 'Zg===', 'Zg=', 'Zh', 'Zm9', 'AA+A', 'AA/A', 'AA%20', '中文']) {
        expect(await decodeHtmlPayload(`#${scheme}=${data}`, pw)).toEqual({ error: 'Invalid share encoding' });
      }
      if (scheme === 'e' || scheme === 'te') {
        expect(await decodeHtmlPayload(`#${scheme}=` + 'A'.repeat(59), pw)).toEqual({ error: 'Invalid encrypted share data' });
      }
    }
    expect(allocate).not.toHaveBeenCalled();
    expect(kdf).not.toHaveBeenCalled();
    expect(decompress).not.toHaveBeenCalled();
  });

  it.each(schemes)('accepts the largest raw #%s= layer pair allowed by the file byte budgets', async (scheme) => {
    const encrypted = scheme === 'e' || scheme === 'te';
    // Password decoding counts both wire and plaintext, including 44 bytes
    // of overhead: 2 * plaintext + 44 must fit within the 8 MiB total.
    const size = encrypted ? (SHARE_LIMITS.totalBytes - 44) / 2 : SHARE_LIMITS.layerBytes;
    const value = scheme === 'td' || scheme === 'te' ? envelope() : sample;
    const json = JSON.stringify(value);
    const payload = await wire(scheme, utf8.encode(json + ' '.repeat(size - bytes(value).length)));
    expect(payload.length).toBeLessThanOrEqual(HTML_PAYLOAD_MAX_CHARS);
    expect(await read(payload)).toEqual(sample);

    const oversized = `#${scheme}=` + b64u(new Uint8Array(size + (encrypted ? 44 : 0) + 1));
    expect(oversized.length).toBeLessThanOrEqual(HTML_PAYLOAD_MAX_CHARS);
    const allocate = vi.spyOn(globalThis, 'atob');
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    for (const pw of [undefined, password]) {
      expect(await decodeHtmlPayload(oversized, pw)).toEqual({
        error: encrypted ? 'Share data exceeds the total byte budget' : 'Share data exceeds the 4 MiB limit',
      });
    }
    expect(allocate).not.toHaveBeenCalled();
    expect(kdf).not.toHaveBeenCalled();
  });

  it.each(schemes)('round-trips exactly 4 MiB of JSON in #%s= files', async (scheme) => {
    const doc = sizedDocument(SHARE_LIMITS.layerBytes);
    expect(await read(await encodeHtmlPayload(doc, options(scheme)))).toEqual(doc);
  });

  it.each(schemes)('rejects document byte, schema and comment overflows in #%s= files', async (scheme) => {
    for (const [value, error] of [
      [sizedDocument(SHARE_LIMITS.layerBytes + 1), 'Share data exceeds the 4 MiB limit'],
      [{ ...rich, title: {} }, 'Invalid document data'],
      [commented(1001, 0), 'Too many comment threads to share'],
      [commented(1, 201), 'Too many replies in a thread to share'],
    ] as const) {
      await expect(read(await documentLink(scheme, bytes(value)))).rejects.toThrow(error);
      seal.mockClear();
      const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
      kdf.mockClear();
      await expect(encodeHtmlPayload(value as DocState, options(scheme))).rejects.toThrow(error);
      expect(kdf).not.toHaveBeenCalled();
      expect(seal).not.toHaveBeenCalled();
    }
  });

  it.each(schemes)('accepts exactly 1000 threads or 200 replies in #%s= files', async (scheme) => {
    for (const value of [commented(1000, 0), commented(1, 200)]) {
      expect(await read(await encodeHtmlPayload(value, options(scheme)))).toEqual(value);
    }
  });

  it.each(['td', 'te'] as const)('validates #%s= file envelopes and retains the capsule open budget', async (scheme) => {
    for (const change of [{ v: 2 }, { age: 'not armor' }, { round: round + 1 }, { unlockMs: null }]) {
      expect(await decodeHtmlPayload(await wire(scheme, await gzipFixture(bytes({ ...envelope(), ...change }))), password))
        .toEqual({ error: 'Invalid time-capsule envelope' });
    }
    const oversized = sizedEnvelope(SHARE_LIMITS.layerBytes + 1);
    expect(await decodeHtmlPayload(await wire(scheme, await gzipFixture(bytes(oversized))), password))
      .toEqual({ error: 'Share data exceeds the 4 MiB limit' });
    expect(unseal).not.toHaveBeenCalled();

    const env = sizedEnvelope(SHARE_LIMITS.layerBytes);
    const decoded = await decodeHtmlPayload(await wire(scheme, await gzipFixture(bytes(env))), password);
    expect(decoded.timeCapsule).toEqual(env);
    unseal.mockResolvedValueOnce(await gzipFixture(bytes(sizedDocument(SHARE_LIMITS.layerBytes))));
    await expect(openTimeCapsule(decoded.timeCapsule!)).rejects.toThrow('Share data exceeds the total byte budget');

    const blank = { ...envelope(), age: armor('') };
    seal.mockResolvedValueOnce(armor('A'.repeat(SHARE_LIMITS.layerBytes - bytes(blank).length)));
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(encodeHtmlPayload(sizedDocument(SHARE_LIMITS.layerBytes), options(scheme))).rejects.toThrow('Share data exceeds the total byte budget');
    expect(kdf).not.toHaveBeenCalled();
  });

  it.each(['e', 'te'] as const)('stops #%s= decompression when individually valid layers exceed 8 MiB', async (scheme) => {
    const doc = noisyDocument(2.5 * 1024 * 1024);
    const value = scheme === 'e' ? doc : { ...envelope(), padding: doc.md };
    const json = bytes(value);
    const compressed = await gzipFixture(json);
    expect(json.length).toBeLessThan(SHARE_LIMITS.layerBytes);
    expect(compressed.length * 2 + 44).toBeLessThan(SHARE_LIMITS.totalBytes);
    expect(compressed.length * 2 + 44 + json.length).toBeGreaterThan(SHARE_LIMITS.totalBytes);
    expect(await decodeHtmlPayload(await wire(scheme, compressed), password)).toEqual({ error: 'Share data exceeds the total byte budget' });
    expect(unseal).not.toHaveBeenCalled();
    if (scheme === 'e') {
      const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
      await expect(encodeHtmlPayload(doc, { password })).rejects.toThrow('Share data exceeds the total byte budget');
      expect(kdf).not.toHaveBeenCalled();
    }
  });

  it.each(schemes)('does not fall back on damaged #%s= gzip or missing compression support', async (scheme) => {
    const compressed = await gzipFixture(bytes(sample));
    const damaged = compressed.slice();
    damaged[damaged.length - 8] ^= 1;
    for (const data of [damaged, compressed.subarray(0, -1), new Uint8Array([0x1e, 0x8b, 0, 0])]) {
      const payload = scheme === 'td' || scheme === 'te' ? await gzipFixture(bytes(envelope(data))) : data;
      await expect(read(await wire(scheme, payload))).rejects.toThrow(/Invalid (gzip )?share data/);
    }
    const valid = await documentLink(scheme, bytes(sample));
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(read(valid)).rejects.toThrow('Gzip decompression is not supported in this browser');
    vi.stubGlobal('CompressionStream', undefined);
    await expect(encodeHtmlPayload(sample, options(scheme))).rejects.toThrow('Compression is not supported in this browser');
  });

  it('reports unavailable password protection instead of producing a plaintext file', async () => {
    const payload = await encodeHtmlPayload(sample, { password });
    vi.stubGlobal('crypto', undefined);
    expect(await decodeHtmlPayload(payload, password)).toEqual({ error: 'Password sharing is not supported in this browser' });
    await expect(encodeHtmlPayload(sample, { password })).rejects.toThrow('Password sharing is not supported in this browser');
  });
});

/* URL packing.

   Four schemes:
     #d=  plain         — gzipped DocState JSON, base64url
     #e=  password      — AES-GCM over gzip(DocState JSON)
     #td= time capsule  — tlock-encrypted gzip(DocState JSON), wrapped in an envelope
     #te= time + pass   — AES-GCM over a tlock-encrypted envelope, i.e. the chain
                          is plaintext → tlock → AES-GCM.

   Password layer is always outermost and hides the envelope and unlock round
   from anyone without the password (the scheme itself is visible). That AES layer is
   also what gates the password: peeling it is the only way to reach the tlock
   ciphertext, so opening a #te= capsule needs both the password and the unlock
   time — a second AES layer under tlock (same password) would add nothing.
*/

import {
  timelockEncrypt,
  timelockDecrypt,
  roundAtUnix,
  unixMsAtRound,
  NotYetReadyError,
  NoEndpointError,
} from './timecapsule';
import { DocSchemaError, isFiniteTimestamp, parseDocState } from './doc-schema';
import type { DocState } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const SHARE_LIMITS = {
  fragmentChars: 256 * 1024, // Includes the leading # and scheme.
  layerBytes: 4 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  maxThreads: 1000,
  maxRepliesPerThread: 200,
} as const;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AES_OVERHEAD = SALT_BYTES + IV_BYTES + TAG_BYTES;

class ShareCodecError extends Error {}

function checkLayerSize(size: number) {
  if (size > SHARE_LIMITS.layerBytes) throw new ShareCodecError('Share data exceeds the 4 MiB limit');
}

/** Each async entry has a cumulative budget, in addition to per-layer limits.
 *  Opening a capsule counts its envelope again, so it is bounded even when
 *  called directly or long after decodeUrl has returned. */
class DecodeBudget {
  private used = 0;

  consume(size: number) {
    if (size > SHARE_LIMITS.totalBytes - this.used) {
      throw new ShareCodecError('Share data exceeds the total byte budget');
    }
    this.used += size;
  }
}

function safeError(error: unknown, fallback: string): Error {
  return error instanceof ShareCodecError || error instanceof DocSchemaError
    ? error
    : new ShareCodecError(fallback);
}

function textBytes(text: string): Uint8Array {
  // A UTF-8 encoding is never shorter than the number of UTF-16 code units.
  checkLayerSize(text.length);
  const bytes = enc.encode(text);
  checkLayerSize(bytes.length);
  return bytes;
}

function bytesToB64u(bytes: Uint8Array): string {
  if (typeof btoa !== 'function') throw new ShareCodecError('Base64 encoding is not supported in this browser');
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uToBytes(b64u: string): Uint8Array {
  // Accept canonical URL-safe base64 with optional correct padding (legacy).
  // Do this even before returning a password prompt, and before any KDF work.
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(b64u)) throw new ShareCodecError('Invalid share encoding');
  const unpadded = b64u.replace(/=+$/, '');
  const remainder = unpadded.length % 4;
  const padding = (4 - remainder) % 4;
  if (remainder === 1 || (b64u.length !== unpadded.length && b64u.length - unpadded.length !== padding)) {
    throw new ShareCodecError('Invalid share encoding');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const tail = alphabet.indexOf(unpadded[unpadded.length - 1]);
  if ((remainder === 2 && (tail & 15) !== 0) || (remainder === 3 && (tail & 3) !== 0)) {
    throw new ShareCodecError('Invalid share encoding');
  }
  if (typeof atob !== 'function') throw new ShareCodecError('Base64 decoding is not supported in this browser');
  const s = atob((unpadded + '='.repeat(padding)).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function readBounded(stream: ReadableStream<Uint8Array>, budget?: DecodeBudget): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      checkLayerSize(size + next.value.byteLength);
      budget?.consume(next.value.byteLength);
      size += next.value.byteLength;
      chunks.push(next.value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } finally {
    // Cancellation propagates through pipeThrough to the source. A cancel
    // failure must not replace the original size/format error.
    try {
      if (!done) await reader.cancel();
    } catch { /* the stream may already be errored */ }
    reader.releaseLock();
  }
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  checkLayerSize(bytes.length);
  if (typeof CompressionStream === 'undefined') {
    throw new ShareCodecError('Compression is not supported in this browser');
  }
  try {
    return await readBounded(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip')));
  } catch (error) {
    throw safeError(error, 'Could not compress share data');
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(dec.decode(bytes));
  } catch {
    // Native JSON/UTF-8 errors may quote document text.
    throw new ShareCodecError('Invalid share data');
  }
}

async function readJson(bytes: Uint8Array, budget: DecodeBudget): Promise<unknown> {
  checkLayerSize(bytes.length);
  budget.consume(bytes.length);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new ShareCodecError('Gzip decompression is not supported in this browser');
    }
    try {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
      return parseJson(await readBounded(stream, budget));
    } catch (error) {
      throw safeError(error, 'Invalid gzip share data');
    }
  }

  // Old builds without CompressionStream emitted raw JSON objects. Only this
  // identifiable format is supported; damaged/unknown binary never falls back.
  let start = 0;
  while ([0x20, 0x09, 0x0a, 0x0d].includes(bytes[start])) start++;
  if (bytes[start] !== 0x7b) throw new ShareCodecError('Invalid share data');
  return parseJson(bytes);
}

function requireCrypto() {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new ShareCodecError('Password sharing is not supported in this browser');
  }
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  requireCrypto();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 600_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptBytes(plaintext: Uint8Array, password: string): Promise<Uint8Array> {
  requireCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plaintext as BufferSource
    )
  );
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ct, salt.length + iv.length);
  return out;
}

async function decryptBytes(payload: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = payload.slice(0, SALT_BYTES);
  const iv = payload.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ct = payload.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(password, salt);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        ct as BufferSource
      )
    );
  } catch {
    throw new ShareCodecError('Incorrect password or damaged share link');
  }
}

/** Inner envelope for time-locked URLs (#td= and, after pw-decryption, #te=). */
export interface TimeCapsuleEnvelope {
  v: 1;
  age: string; // age-armored tlock ciphertext of gzip(DocState JSON)
  round: number;
  unlockMs: number;
}

function assertEnvelope(value: unknown): asserts value is TimeCapsuleEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ShareCodecError('Invalid time-capsule envelope');
  }
  const o = value as Record<string, unknown>;
  if (o.v !== 1 || typeof o.age !== 'string' || !isFiniteTimestamp(o.round) || !Number.isSafeInteger(o.round) || o.round <= 0 || !isFiniteTimestamp(o.unlockMs) || !Number.isFinite(new Date(o.unlockMs).getTime()) || o.unlockMs !== unixMsAtRound(o.round)) {
    throw new ShareCodecError('Invalid time-capsule envelope');
  }
  checkLayerSize(o.age.length);
  // Check the armor framing, not the cryptography or the embedded tlock round.
  // tlock must still authenticate the ciphertext using the pinned drand chain.
  const armor = o.age.trimEnd();
  const header = '-----BEGIN AGE ENCRYPTED FILE-----\n';
  const footer = '\n-----END AGE ENCRYPTED FILE-----';
  const body = armor.slice(header.length, -footer.length);
  if (!armor.startsWith(header) || !armor.endsWith(footer) || o.age.length - armor.length > 1024 || !/[A-Za-z0-9+/]/.test(body) || !/^[A-Za-z0-9+/=\r\n]+$/.test(body)) {
    throw new ShareCodecError('Invalid time-capsule envelope');
  }
}

function serializeDocument(state: DocState): Uint8Array {
  parseDocState(state, SHARE_LIMITS);
  // Reject huge in-memory fields before asking JSON.stringify to escape them.
  let chars = 0;
  function count(text: string) {
    chars += text.length;
    checkLayerSize(chars);
  }
  count(state.md);
  count(state.title);
  for (const thread of state.comments) {
    [thread.id, thread.quote, thread.before, thread.after].forEach(count);
    for (const reply of thread.replies) [reply.id, reply.author, reply.body].forEach(count);
  }
  const bytes = textBytes(JSON.stringify(state));
  // Validate the actual serialized snapshot too (e.g. a custom toJSON).
  parseDocState(parseJson(bytes), SHARE_LIMITS);
  return bytes;
}

function serializeEnvelope(value: unknown): Uint8Array {
  assertEnvelope(value);
  return textBytes(JSON.stringify(value));
}

function futureRound(unlockMs: unknown): number {
  if (!isFiniteTimestamp(unlockMs) || !Number.isFinite(new Date(unlockMs).getTime()) || unlockMs <= Date.now()) {
    throw new ShareCodecError('Unlock time must be a valid future date');
  }
  const round = roundAtUnix(unlockMs);
  const actualMs = unixMsAtRound(round);
  if (!Number.isSafeInteger(round) || round <= 0 || !Number.isFinite(new Date(actualMs).getTime()) || actualMs < unlockMs) {
    throw new ShareCodecError('Unlock time must be a valid future date');
  }
  return round;
}

async function pack(scheme: 'd' | 'e' | 'td' | 'te', compressed: Uint8Array, jsonSize: number, password?: string | null): Promise<string> {
  const wireSize = compressed.length + (password ? AES_OVERHEAD : 0);
  const prefix = '#' + scheme + '=';
  if (prefix.length + Math.ceil(wireSize * 4 / 3) > SHARE_LIMITS.fragmentChars) {
    throw new ShareCodecError('Share link exceeds the 256 KiB limit');
  }
  // Mirror the receiving path before paying for PBKDF2.
  const budget = new DecodeBudget();
  if (password) budget.consume(wireSize);
  budget.consume(compressed.length);
  budget.consume(jsonSize);
  const payload = password ? await encryptBytes(compressed, password) : compressed;
  return prefix + bytesToB64u(payload);
}

/** Build a shareable URL hash. */
export async function encodeUrl(
  state: DocState,
  opts: { password?: string | null; unlockMs?: number | null } = {}
): Promise<string> {
  try {
    const { password, unlockMs } = opts;
    // An explicitly supplied null/undefined/invalid time is an error, never a
    // request to silently drop the time lock. Omit the option to disable it.
    const round = Object.hasOwn(opts, 'unlockMs') ? futureRound(unlockMs) : undefined;
    const json = serializeDocument(state);
    const compressed = await gzip(json);
    if (round !== undefined) {
      futureRound(unlockMs);
      let age: string;
      try {
        age = await timelockEncrypt(compressed, round);
      } catch {
        throw new ShareCodecError('Could not seal time capsule');
      }
      const env = { v: 1, age, round, unlockMs: unixMsAtRound(round) };
      const envJson = serializeEnvelope(env);
      const openBudget = new DecodeBudget();
      openBudget.consume(envJson.length);
      openBudget.consume(compressed.length);
      openBudget.consume(json.length);
      const hash = await pack(password ? 'te' : 'td', await gzip(envJson), envJson.length, password);
      futureRound(unlockMs); // The requested date may expire during async work.
      return hash;
    }
    return await pack(password ? 'e' : 'd', compressed, json.length, password);
  } catch (error) {
    throw safeError(error, 'Could not build share link');
  }
}

export interface DecodeResult {
  state?: DocState;
  encrypted?: 'password' | 'time-password';
  timeCapsule?: TimeCapsuleEnvelope;
  error?: string;
}

export async function decodeUrl(hash: string, password?: string): Promise<DecodeResult> {
  if (hash === '' || hash === '#') return {};
  try {
    if (hash.length + (hash.startsWith('#') ? 0 : 1) > SHARE_LIMITS.fragmentChars) {
      throw new ShareCodecError('Share link exceeds the 256 KiB limit');
    }
    const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
    const eq = cleaned.indexOf('=');
    const scheme = cleaned.slice(0, eq);
    if (eq <= 0 || !['d', 'e', 'td', 'te'].includes(scheme)) {
      throw new ShareCodecError('Unsupported share scheme');
    }
    let bytes = b64uToBytes(cleaned.slice(eq + 1));
    const budget = new DecodeBudget();
    if (scheme === 'e' || scheme === 'te') {
      if (bytes.length <= AES_OVERHEAD) throw new ShareCodecError('Invalid encrypted share data');
      if (!password) return { encrypted: scheme === 'e' ? 'password' : 'time-password' };
      budget.consume(bytes.length);
      bytes = await decryptBytes(bytes, password);
    }
    const value = await readJson(bytes, budget);
    if (scheme === 'td' || scheme === 'te') {
      assertEnvelope(value);
      return { timeCapsule: value };
    }
    return { state: parseDocState(value, SHARE_LIMITS) };
  } catch (error) {
    return { error: safeError(error, 'Could not read share link').message };
  }
}

/** Decrypt a time-capsule envelope's payload after the unlock round has published.
 *  For #te= links the outer AES (password) layer is already peeled by `decodeUrl`
 *  before we get here, so the envelope's payload is plain tlock-over-gzip. */
export async function openTimeCapsule(env: TimeCapsuleEnvelope): Promise<DocState> {
  try {
    const budget = new DecodeBudget();
    budget.consume(serializeEnvelope(env).length);
    let payload: Uint8Array;
    try {
      payload = await timelockDecrypt(env.age);
    } catch (error) {
      // Preserve the network retry contract without displaying arbitrary
      // dependency errors, which may contain ciphertext or plaintext.
      if (error instanceof NotYetReadyError) throw new NotYetReadyError(env.round);
      if (error instanceof NoEndpointError) throw new NoEndpointError();
      throw new ShareCodecError('Could not open time capsule');
    }
    return parseDocState(await readJson(payload, budget), SHARE_LIMITS);
  } catch (error) {
    if (error instanceof NotYetReadyError || error instanceof NoEndpointError) throw error;
    throw safeError(error, 'Could not open time capsule');
  }
}

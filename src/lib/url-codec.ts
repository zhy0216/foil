/* URL packing.

   Four schemes:
     #d=  plain         — gzipped DocState JSON, base64url
     #e=  password      — AES-GCM over gzip(DocState JSON)
     #td= time capsule  — tlock-encrypted gzip(DocState JSON), wrapped in an envelope
     #te= time + pass   — AES-GCM over a tlock-encrypted envelope, i.e. the chain
                          is plaintext → tlock → AES-GCM.

   Password layer is always outermost so it can hide whether-it's-a-capsule and
   the unlock round from anyone without the password. That single AES layer is
   also what gates the password: peeling it is the only way to reach the tlock
   ciphertext, so opening a #te= capsule needs both the password and the unlock
   time — a second AES layer under tlock (same password) would add nothing.
*/

import {
  timelockEncrypt,
  timelockDecrypt,
  roundAtUnix,
  unixMsAtRound,
} from './timecapsule';
import type { DocState } from '../types';

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64u(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uToBytes(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const s = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function gzip(strOrBytes: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof strOrBytes === 'string' ? enc.encode(strOrBytes) : strOrBytes;
  if (typeof CompressionStream === 'undefined') return bytes;
  const cs = new CompressionStream('gzip');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') return bytes;
  try {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return bytes;
  }
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
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
  const salt = payload.slice(0, 16);
  const iv = payload.slice(16, 28);
  const ct = payload.slice(28);
  const key = await deriveKey(password, salt);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource
    )
  );
}

/** Inner envelope for time-locked URLs (#td= and, after pw-decryption, #te=). */
export interface TimeCapsuleEnvelope {
  v: 1;
  age: string; // age-armored tlock ciphertext of gzip(DocState JSON)
  round: number;
  unlockMs: number;
}

function isEnvelope(x: unknown): x is TimeCapsuleEnvelope {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.age === 'string' &&
    typeof o.round === 'number' &&
    typeof o.unlockMs === 'number'
  );
}

async function buildEnvelope(state: DocState, unlockMs: number): Promise<TimeCapsuleEnvelope> {
  const round = roundAtUnix(unlockMs);
  const compressed = await gzip(JSON.stringify(state));
  const age = await timelockEncrypt(compressed, round);
  return { v: 1, age, round, unlockMs: unixMsAtRound(round) };
}

/** Build a shareable URL hash. */
export async function encodeUrl(
  state: DocState,
  opts: { password?: string | null; unlockMs?: number | null } = {}
): Promise<string> {
  const { password, unlockMs } = opts;

  if (unlockMs && unlockMs > Date.now()) {
    const env = await buildEnvelope(state, unlockMs);
    const envJson = JSON.stringify(env);
    if (password) {
      const ct = await encryptBytes(await gzip(envJson), password);
      return '#te=' + bytesToB64u(ct);
    }
    return '#td=' + bytesToB64u(await gzip(envJson));
  }

  const compressed = await gzip(JSON.stringify(state));
  if (password) {
    const ct = await encryptBytes(compressed, password);
    return '#e=' + bytesToB64u(ct);
  }
  return '#d=' + bytesToB64u(compressed);
}

export interface DecodeResult {
  state?: DocState;
  encrypted?: 'password' | 'time-password';
  timeCapsule?: TimeCapsuleEnvelope;
  error?: string;
}

export async function decodeUrl(hash: string, password?: string): Promise<DecodeResult> {
  if (!hash || hash.length < 2) return {};
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const eq = cleaned.indexOf('=');
  if (eq <= 0) return {};
  const k = cleaned.slice(0, eq);
  const v = cleaned.slice(eq + 1);
  if (!v) return {};

  try {
    if (k === 'd') {
      const out = await gunzip(b64uToBytes(v));
      return { state: JSON.parse(dec.decode(out)) as DocState };
    }
    if (k === 'e') {
      if (!password) return { encrypted: 'password' };
      const pt = await decryptBytes(b64uToBytes(v), password);
      const out = await gunzip(pt);
      return { state: JSON.parse(dec.decode(out)) as DocState };
    }
    if (k === 'td') {
      const out = await gunzip(b64uToBytes(v));
      const env = JSON.parse(dec.decode(out));
      if (!isEnvelope(env)) return { error: 'Invalid time-capsule envelope' };
      return { timeCapsule: env };
    }
    if (k === 'te') {
      if (!password) return { encrypted: 'time-password' };
      const pt = await decryptBytes(b64uToBytes(v), password);
      const out = await gunzip(pt);
      const env = JSON.parse(dec.decode(out));
      if (!isEnvelope(env)) return { error: 'Invalid time-capsule envelope' };
      return { timeCapsule: env };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return {};
}

/** Decrypt a time-capsule envelope's payload after the unlock round has published.
 *  For #te= links the outer AES (password) layer is already peeled by `decodeUrl`
 *  before we get here, so the envelope's payload is plain tlock-over-gzip. */
export async function openTimeCapsule(env: TimeCapsuleEnvelope): Promise<DocState> {
  const payload = await timelockDecrypt(env.age);
  const out = await gunzip(payload);
  return JSON.parse(dec.decode(out)) as DocState;
}

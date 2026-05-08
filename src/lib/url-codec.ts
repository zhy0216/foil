/* URL packing + optional password encryption.
   PBKDF2(SHA-256, 200000) + AES-GCM-256, gzipped via CompressionStream. */

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
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 200_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptBytes(plaintext: Uint8Array, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource)
  );
  const out = new Uint8Array(salt.length + iv.length + ct.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ct, salt.length + iv.length);
  return bytesToB64u(out);
}

async function decryptBytes(b64u: string, password: string): Promise<Uint8Array> {
  const all = b64uToBytes(b64u);
  const salt = all.slice(0, 16);
  const iv = all.slice(16, 28);
  const ct = all.slice(28);
  const key = await deriveKey(password, salt);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
  );
  return pt;
}

export async function encodeUrl(
  state: DocState,
  password: string | null
): Promise<string> {
  const json = JSON.stringify(state);
  const compressed = await gzip(json);
  if (password) {
    const enc64 = await encryptBytes(compressed, password);
    return '#e=' + enc64;
  }
  return '#d=' + bytesToB64u(compressed);
}

export interface DecodeResult {
  state?: DocState;
  encrypted?: boolean;
  error?: string;
}

export async function decodeUrl(
  hash: string,
  password?: string
): Promise<DecodeResult> {
  if (!hash || hash.length < 2) return {};
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  const [k, v] = cleaned.split('=');
  if (!v) return {};
  try {
    if (k === 'd') {
      const bytes = b64uToBytes(v);
      const out = await gunzip(bytes);
      return { state: JSON.parse(dec.decode(out)) as DocState };
    }
    if (k === 'e') {
      if (!password) return { encrypted: true };
      const bytes = await decryptBytes(v, password);
      const out = await gunzip(bytes);
      return { state: JSON.parse(dec.decode(out)) as DocState };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return {};
}

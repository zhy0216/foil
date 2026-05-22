/* Time-locked encryption against drand "quicknet".

   How it works:
   - drand quicknet publishes a fresh BLS signature every 3 seconds.
   - We pick a future round number and use that round's signature as the
     identity in an identity-based encryption (BLS-IBE). Encryption is offline.
   - Decryption requires the round's signature, which only becomes public at
     the round's published time. Until then, nothing — not even the author —
     can decrypt.

   tlock-js is dynamically imported so it stays out of the main bundle.
*/

import { Buffer } from 'buffer';

// tlock-js / drand-client touch `Buffer` as a global in spots. Browsers don't
// have one; this shim plants it before tlock-js loads.
if (typeof (globalThis as { Buffer?: typeof Buffer }).Buffer === 'undefined') {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

// quicknet chain — public, immutable facts of the network.
export const QUICKNET_CHAIN_HASH =
  '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
const QUICKNET_PUBLIC_KEY =
  '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a';
const QUICKNET_GENESIS_SEC = 1692803367;
const QUICKNET_PERIOD_SEC = 3;

const ENDPOINTS = [
  'https://api.drand.sh',
  'https://drand.cloudflare.com',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
];

export class NotYetReadyError extends Error {
  constructor(round: number) {
    super(`drand round ${round} not yet available`);
    this.name = 'NotYetReadyError';
  }
}

export class NoEndpointError extends Error {
  constructor() {
    super('All drand endpoints unreachable');
    this.name = 'NoEndpointError';
  }
}

/** Smallest drand round whose publish time ≥ `unlockMs`. Pure local math. */
export function roundAtUnix(unlockMs: number): number {
  const deltaSec = (unlockMs - QUICKNET_GENESIS_SEC * 1000) / 1000;
  if (deltaSec <= 0) return 1;
  return Math.ceil(deltaSec / QUICKNET_PERIOD_SEC) + 1;
}

/** Unix-ms at which round `r`'s signature becomes public. */
export function unixMsAtRound(round: number): number {
  return (QUICKNET_GENESIS_SEC + (round - 1) * QUICKNET_PERIOD_SEC) * 1000;
}

type DrandClient = unknown;

// Reuse a single client per session (avoids redundant chain-info fetches).
let cachedClient: Promise<DrandClient> | null = null;

async function makeClient(): Promise<DrandClient> {
  const { HttpChainClient, HttpCachingChain, defaultChainOptions } = await import(
    'drand-client'
  );
  const opts = {
    ...defaultChainOptions,
    chainVerificationParams: {
      chainHash: QUICKNET_CHAIN_HASH,
      publicKey: QUICKNET_PUBLIC_KEY,
    },
  };
  // Try endpoints in order; return the first that answers /info successfully.
  let lastErr: unknown = null;
  for (const base of ENDPOINTS) {
    const url = `${base}/${QUICKNET_CHAIN_HASH}`;
    try {
      const chain = new HttpCachingChain(url, opts);
      await chain.info();
      return new HttpChainClient(chain, opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new NoEndpointError();
}

function getClient(): Promise<DrandClient> {
  if (!cachedClient) {
    cachedClient = makeClient().catch((err) => {
      cachedClient = null;
      throw err;
    });
  }
  return cachedClient;
}

/** Encrypt a payload so it can only be decrypted at-or-after `round`. */
export async function timelockEncrypt(
  plaintext: Uint8Array | string,
  round: number
): Promise<string> {
  const { timelockEncrypt: tle } = await import('tlock-js');
  const client = await getClient();
  const buf =
    typeof plaintext === 'string'
      ? Buffer.from(plaintext, 'utf8')
      : Buffer.from(plaintext);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await tle(round, buf, client as any);
}

/** Decrypt an age-armored time-locked ciphertext. Throws NotYetReadyError if
 *  the round's signature hasn't published yet. */
export async function timelockDecrypt(ciphertextArmor: string): Promise<Uint8Array> {
  const { timelockDecrypt: tld } = await import('tlock-js');
  const client = await getClient();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await tld(ciphertextArmor, client as any);
    return new Uint8Array(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // drand returns 404 for rounds that haven't published yet.
    if (/404|not.*found|too.*early|future/i.test(msg)) {
      throw new NotYetReadyError(0);
    }
    throw err;
  }
}

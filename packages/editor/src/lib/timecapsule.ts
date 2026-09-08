/* Time-locked encryption against drand quicknet. Round selection is local;
   sealing verifies chain information, and opening also needs a verified beacon.
   Buffer and the crypto implementation load only when sealing/opening. */

import type { ChainInfo } from 'drand-client';

// Public, immutable quicknet parameters. Keep these in sync with existing links.
export const QUICKNET_CHAIN_HASH =
  '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
export const QUICKNET: Readonly<Pick<
  ChainInfo, 'hash' | 'public_key' | 'genesis_time' | 'period' | 'schemeID'
>> = Object.freeze({
  hash: QUICKNET_CHAIN_HASH,
  public_key:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesis_time: 1692803367,
  period: 3,
  schemeID: 'bls-unchained-g1-rfc9380',
});

export interface DrandAttempt {
  endpoint: string;
  phase: 'info' | 'round';
  reason: 'timeout' | 'network' | 'http' | 'invalid-response' | 'verification';
  status?: number;
  round?: number;
}

export class NotYetReadyError extends Error {
  readonly code = 'DRAND_NOT_YET_READY';
  constructor(readonly round: number) {
    super(`drand round ${round} not yet available`);
    this.name = 'NotYetReadyError';
  }
}

export class NoEndpointError extends Error {
  readonly code = 'DRAND_UNAVAILABLE';
  constructor(
    readonly attempts: readonly DrandAttempt[] = [],
    readonly round?: number,
    readonly budgetExceeded = false,
  ) {
    super('All drand endpoints unreachable');
    this.name = 'NoEndpointError';
  }
}

export class DrandVerificationError extends Error {
  readonly code = 'DRAND_VERIFICATION_FAILED';
  constructor(readonly attempts: readonly DrandAttempt[], readonly round?: number) {
    super('drand chain or beacon verification failed');
    this.name = 'DrandVerificationError';
  }
}

export class InvalidCiphertextError extends Error {
  readonly code = 'INVALID_TIME_CAPSULE';
  constructor() {
    super('Invalid or damaged time-capsule ciphertext');
    this.name = 'InvalidCiphertextError';
  }
}

export class TimeCapsuleCryptoError extends Error {
  constructor(readonly code: 'CRYPTO_LOAD_FAILED' | 'TIMELOCK_ENCRYPT_FAILED') {
    super(code === 'CRYPTO_LOAD_FAILED'
      ? 'Time-capsule encryption module could not be loaded; please retry'
      : 'Time-capsule encryption failed');
    this.name = 'TimeCapsuleCryptoError';
  }
}

const MAX_DATE_MS = 8.64e15;

/** Smallest drand round whose publish time ≥ `unlockMs`. Pure local math. */
export function roundAtUnix(unlockMs: number): number {
  if (!Number.isFinite(unlockMs) || Math.abs(unlockMs) > MAX_DATE_MS) {
    throw new RangeError('Invalid time-capsule unlock time');
  }
  const deltaSec = (unlockMs - QUICKNET.genesis_time * 1000) / 1000;
  if (deltaSec <= 0) return 1;
  return Math.ceil(deltaSec / QUICKNET.period) + 1;
}

/** Scheduled Unix-ms for round `r`; availability still requires a beacon. */
export function unixMsAtRound(round: number): number {
  if (!Number.isSafeInteger(round) || round < 1) {
    throw new RangeError('Invalid time-capsule round');
  }
  const ms = (QUICKNET.genesis_time + (round - 1) * QUICKNET.period) * 1000;
  if (!Number.isSafeInteger(ms) || ms > MAX_DATE_MS) {
    throw new RangeError('Time-capsule round is outside the supported date range');
  }
  return ms;
}

let cryptoModule: Promise<typeof import('./timecapsule-crypto')> | undefined;

function loadCrypto() {
  if (!cryptoModule) {
    cryptoModule = (async () => {
      const { Buffer } = await import('buffer');
      // Some transitive crypto code expects a global Buffer during evaluation.
      // The next import must stay AFTER this shim, including in browser chunks.
      const globals = globalThis as { Buffer?: typeof Buffer };
      globals.Buffer ??= Buffer;
      return import('./timecapsule-crypto');
    })().catch(() => {
      cryptoModule = undefined;
      // Dependency errors may contain input/URLs; expose only our stable error.
      throw new TimeCapsuleCryptoError('CRYPTO_LOAD_FAILED');
    });
  }
  return cryptoModule;
}

/** Encrypt a payload so it can only be decrypted at-or-after `round`. */
export async function timelockEncrypt(
  plaintext: Uint8Array | string,
  round: number,
): Promise<string> {
  unixMsAtRound(round);
  return (await loadCrypto()).encrypt(plaintext, round);
}

/** Decrypt age-armored (or legacy unarmored) tlock ciphertext. */
export async function timelockDecrypt(ciphertextArmor: string): Promise<Uint8Array> {
  return (await loadCrypto()).decrypt(ciphertextArmor);
}

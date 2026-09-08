// This entire module must be imported after the Buffer shim in timecapsule.ts.
import { Buffer } from 'buffer';
import { timelockEncrypt, timelockDecrypt } from 'tlock-js';
import { decodeArmor, isProbablyArmored } from 'tlock-js/age/armor';
import { readAge } from 'tlock-js/age/age-reader-writer';
import { createDrandClient } from './timecapsule-drand';
import {
  QUICKNET_CHAIN_HASH, NoEndpointError, NotYetReadyError, DrandVerificationError,
  InvalidCiphertextError, TimeCapsuleCryptoError, unixMsAtRound,
} from './timecapsule';

function isDrandError(error: unknown) {
  return error instanceof NoEndpointError || error instanceof NotYetReadyError ||
    error instanceof DrandVerificationError;
}

// Use the installed age parser to obtain the same recipient tlock will use.
// This is structural validation only: authenticating MAC/IBE/payload still
// requires the published signature and remains the crypto library's job.
function ciphertextRound(ciphertext: string): number {
  try {
    const age = readAge(isProbablyArmored(ciphertext) ? decodeArmor(ciphertext) : ciphertext);
    const stanza = age.header.recipients.find(recipient => recipient.type === 'tlock');
    if (age.header.version !== 'age-encryption.org/v1' || !stanza ||
        stanza.args.length !== 2 || !/^[1-9]\d*$/.test(stanza.args[0]) ||
        stanza.args[1] !== QUICKNET_CHAIN_HASH ||
        // quicknet: compressed G2 point (96) and two wrapped file-key halves (16 each).
        stanza.body.length !== 128 || age.header.mac.length !== 32 ||
        // tlock 0.9 encodes an empty payload as just the 16-byte nonce.
        (age.body.length !== 16 && age.body.length < 32)) {
      throw new InvalidCiphertextError();
    }
    const round = Number(stanza.args[0]);
    unixMsAtRound(round);
    return round;
  } catch {
    // Never expose parser errors: dependency messages can echo the ciphertext.
    throw new InvalidCiphertextError();
  }
}

export async function encrypt(plaintext: Uint8Array | string, round: number): Promise<string> {
  const client = createDrandClient(round);
  try {
    const bytes = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext);
    return await timelockEncrypt(round, bytes, client);
  } catch (error) {
    if (isDrandError(error)) throw error;
    throw new TimeCapsuleCryptoError('TIMELOCK_ENCRYPT_FAILED');
  }
}

export async function decrypt(ciphertext: string): Promise<Uint8Array> {
  const round = ciphertextRound(ciphertext);
  const client = createDrandClient(round);
  // tlock 0.9 rejects future rounds before calling get(), using an untyped
  // error. Classify this ourselves with the parsed round and pinned chain time.
  const info = await client.chain().info();
  const publishMs = (info.genesis_time + (round - 1) * info.period) * 1000;
  if (publishMs > Date.now()) throw new NotYetReadyError(round);
  try {
    return new Uint8Array(await timelockDecrypt(ciphertext, client));
  } catch (error) {
    if (isDrandError(error)) throw error;
    throw new InvalidCiphertextError();
  }
}

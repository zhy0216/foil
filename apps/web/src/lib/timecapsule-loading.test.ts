// @vitest-environment node
import { Buffer as NodeBuffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let capsule: typeof import('./timecapsule');
let events: string[];
let seal: ReturnType<typeof vi.fn<typeof import('tlock-js')['timelockEncrypt']>>;
let open: ReturnType<typeof vi.fn<typeof import('tlock-js')['timelockDecrypt']>>;

const globals = globalThis as { Buffer?: typeof import('buffer')['Buffer'] };

// A structurally valid age header, used only with a mocked crypto operation.
// The real MAC/IBE/authentication and historical interoperability are tested
// separately in timecapsule.test.ts with a genuine fixed beacon.
function mockCiphertext() {
  const stanza = NodeBuffer.alloc(128).toString('base64').replace(/=+$/, '').match(/.{1,64}/g)!.join('\n');
  const mac = NodeBuffer.alloc(32).toString('base64').replace(/=+$/, '');
  return `age-encryption.org/v1\n-> tlock 1000 ${capsule.QUICKNET_CHAIN_HASH}\n${stanza}\n--- ${mac}\n${'x'.repeat(32)}`;
}

function infoResponse() {
  return new Response(JSON.stringify({
    ...capsule.QUICKNET, groupHash: 'f'.repeat(64), metadata: { beaconID: 'quicknet' },
  }));
}

beforeEach(async () => {
  vi.resetModules();
  events = [];
  seal = vi.fn<typeof import('tlock-js')['timelockEncrypt']>(async (_round, bytes, client) => {
    expect(client.options.disableBeaconVerification).toBe(false);
    await client.chain().info();
    return `sealed:${bytes.toString('utf8')}`;
  });
  open = vi.fn<typeof import('tlock-js')['timelockDecrypt']>(async () => NodeBuffer.from('opened'));
  vi.doMock('buffer', async () => {
    events.push('buffer');
    return vi.importActual('buffer');
  });
  vi.doMock('tlock-js', () => {
    events.push('tlock');
    expect(globals.Buffer).toBeDefined();
    return { timelockEncrypt: seal, timelockDecrypt: open };
  });
  capsule = await import('./timecapsule');
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => infoResponse()));
});

afterEach(() => {
  vi.doUnmock('buffer');
  vi.doUnmock('tlock-js');
  vi.doUnmock('drand-client');
  vi.doUnmock('./timecapsule-crypto');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('time-capsule loading boundary', () => {
  it('keeps Buffer/tlock unloaded for math and both ordinary share schemes', async () => {
    const originalBuffer = globals.Buffer;
    const { encodeUrl, decodeUrl } = await import('./url-codec');
    const doc = { md: 'ordinary document', comments: [], title: 'note' };
    expect(capsule.roundAtUnix(capsule.unixMsAtRound(1000))).toBe(1000);
    for (const opts of [{}, { password: 'ordinary password' }]) {
      const hash = await encodeUrl(doc, opts);
      expect((await decodeUrl(hash, 'ordinary password')).state).toEqual(doc);
    }
    expect(events).toEqual([]);
    expect(globals.Buffer).toBe(originalBuffer);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('installs the browser Buffer shim before tlock and shares concurrent imports', async () => {
    vi.stubGlobal('Buffer', undefined);
    const results = await Promise.all([
      capsule.timelockEncrypt('one', 1000),
      capsule.timelockEncrypt(new TextEncoder().encode('two'), 1000),
      capsule.timelockDecrypt(mockCiphertext()),
    ]);
    expect(results).toEqual(['sealed:one', 'sealed:two', new TextEncoder().encode('opened')]);
    expect(events).toEqual(['buffer', 'tlock']);
    expect(globals.Buffer?.isBuffer(seal.mock.calls[0][1])).toBe(true);
    await capsule.timelockEncrypt('again', 1000);
    expect(events).toEqual(['buffer', 'tlock']);
  });

  it('preserves an existing Buffer implementation', async () => {
    const originalBuffer = globals.Buffer;
    await capsule.timelockEncrypt('payload', 1000);
    expect(globals.Buffer).toBe(originalBuffer);
  });

  it('retries after a Buffer import failure without retaining a rejected promise', async () => {
    vi.doMock('buffer', () => { throw new Error('module url with private content'); });
    const first = await capsule.timelockEncrypt('secret body', 1000).catch(error => error);
    expect(first).toBeInstanceOf(capsule.TimeCapsuleCryptoError);
    expect(first.code).toBe('CRYPTO_LOAD_FAILED');
    expect(first.message).not.toContain('private');
    expect(events).toEqual([]);
    vi.doMock('buffer', async () => {
      events.push('buffer');
      return vi.importActual('buffer');
    });
    await expect(capsule.timelockEncrypt('retry', 1000)).resolves.toBe('sealed:retry');
    expect(events).toEqual(['buffer', 'tlock']);
  });

  it('retries a failed crypto chunk import in the same caller module', async () => {
    vi.doMock('./timecapsule-crypto', () => { throw { message: 'chunk unavailable private' }; });
    const errors = await Promise.all([
      capsule.timelockEncrypt('one', 1000).catch(error => error),
      capsule.timelockDecrypt(mockCiphertext()).catch(error => error),
    ]);
    expect(errors.every(error => error instanceof capsule.TimeCapsuleCryptoError)).toBe(true);
    expect(errors.map(error => error.code)).toEqual(['CRYPTO_LOAD_FAILED', 'CRYPTO_LOAD_FAILED']);
    vi.doMock('./timecapsule-crypto', () => ({
      encrypt: async () => 'retried', decrypt: async () => new Uint8Array([1]),
    }));
    await expect(capsule.timelockEncrypt('again', 1000)).resolves.toBe('retried');
    await expect(capsule.timelockDecrypt(mockCiphertext())).resolves.toEqual(new Uint8Array([1]));
  });

  it('normalizes changing crypto errors and allows the next operation', async () => {
    seal.mockRejectedValueOnce({ message: '404 not found private password body' });
    const error = await capsule.timelockEncrypt('secret', 1000).catch(error => error);
    expect(error).toMatchObject({ name: 'TimeCapsuleCryptoError', code: 'TIMELOCK_ENCRYPT_FAILED' });
    expect(error.message).not.toContain('private');
    await expect(capsule.timelockEncrypt('retry', 1000)).resolves.toBe('sealed:retry');
    expect(events).toEqual(['buffer', 'tlock']);
  });

  it.each([
    new Error('404 not found too early future private password body'),
    { message: 'future 404 private password body', status: 404 },
    'not found private password body',
    null,
  ])('never treats untyped dependency errors as future-round evidence %#', async failure => {
    open.mockRejectedValueOnce(failure);
    const error = await capsule.timelockDecrypt(mockCiphertext()).catch(error => error);
    expect(error).toBeInstanceOf(capsule.InvalidCiphertextError);
    expect(error.message).not.toContain('private');
    await expect(capsule.timelockDecrypt(mockCiphertext())).resolves.toEqual(new TextEncoder().encode('opened'));
  });

  it('normalizes an untyped verifier failure without leaking its details', async () => {
    vi.doMock('drand-client', async () => ({
      ...await vi.importActual<typeof import('drand-client')>('drand-client'),
      fetchBeacon: async () => { throw { detail: '404 future private password body' }; },
    }));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => String(input).endsWith('/info')
      ? infoResponse() : new Response(JSON.stringify({
        round: 1000, signature: 'ab'.repeat(48), randomness: 'cd'.repeat(32),
      }))));
    open.mockImplementation(async (_ciphertext, client) => {
      await client.get(1000);
      return NodeBuffer.from('opened');
    });
    const error = await capsule.timelockDecrypt(mockCiphertext()).catch(error => error);
    expect(error).toBeInstanceOf(capsule.DrandVerificationError);
    expect(error).toMatchObject({ code: 'DRAND_VERIFICATION_FAILED', round: 1000 });
    expect(error.attempts).toHaveLength(4);
    expect(error.message + JSON.stringify(error)).not.toContain('private');
  });
});

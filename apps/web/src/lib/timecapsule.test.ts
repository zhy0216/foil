// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';
import { encodeArmor, decodeArmor } from 'tlock-js/age/armor';
import type { ChainInfo } from 'drand-client';

// Fixed public quicknet data; no test contacts a beacon endpoint. The beacon is
// the round-1000 example at https://github.com/thibmeu/drand-rs#retrieve-public-randomness
// and is verified with the REAL installed drand/tlock implementation below.
const INFO: ChainInfo = {
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  public_key: '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesis_time: 1692803367,
  period: 3,
  schemeID: 'bls-unchained-g1-rfc9380',
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  metadata: { beaconID: 'quicknet' },
};
const BEACON = {
  round: 1000,
  randomness: 'fe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd',
  signature: 'b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39',
};
const BASES = ['https://api.drand.sh', 'https://drand.cloudflare.com', 'https://api2.drand.sh', 'https://api3.drand.sh'];
const infoUrl = (base: string) => `${base}/${INFO.hash}/info`;
const roundUrl = (base: string, round = BEACON.round) => `${base}/${INFO.hash}/public/${round}`;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const goodResponse = (url: string) => json(url.endsWith('/info') ? INFO : BEACON);

let capsule: typeof import('./timecapsule');
let createDrandClient: typeof import('./timecapsule-drand')['createDrandClient'];
let requests: { url: string; signal: AbortSignal; start: number }[];
let pending: Set<AbortSignal>;
let respond: (url: string, signal: AbortSignal) => Response | Promise<Response>;

// An abort-aware fake server. Both completion and cancellation release its
// listener/timer so resource leaks are asserted, not hidden by test teardown.
function delayed(signal: AbortSignal, value?: Response, delayMs?: number): Promise<Response> {
  pending.add(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      pending.delete(signal);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = delayMs === undefined ? undefined : setTimeout(() => {
      cleanup();
      resolve(value!);
    }, delayMs);
    signal.addEventListener('abort', abort, { once: true });
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.setSystemTime(new Date('2026-09-06T00:00:00Z'));
  requests = [];
  pending = new Set();
  respond = url => goodResponse(url);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    const signal = init?.signal;
    if (!signal) throw new Error('Every drand request must have an AbortSignal');
    expect(BASES).toContain(new URL(url).origin);
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    requests.push({ url, signal, start: performance.now() });
    return Promise.resolve(respond(url, signal));
  }));
  capsule = await import('./timecapsule');
  ({ createDrandClient } = await import('./timecapsule-drand'));
  // The dependency logs public beacons during decrypt. Keep test output focused.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  expect(pending.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('quicknet round math', () => {
  it('preserves genesis clamping and ceiling-to-publish boundaries', () => {
    const genesis = INFO.genesis_time * 1000;
    expect(capsule.QUICKNET).toMatchObject({
      hash: INFO.hash, public_key: INFO.public_key, period: 3,
      genesis_time: 1692803367, schemeID: INFO.schemeID,
    });
    for (const time of [-8.64e15, -1, 0, genesis - 1, genesis]) {
      expect(capsule.roundAtUnix(time)).toBe(1);
    }
    for (const round of [1, 2, 1000, 1_000_000, 2_000_000_000]) {
      const publish = (INFO.genesis_time + (round - 1) * 3) * 1000;
      expect(capsule.unixMsAtRound(round)).toBe(publish);
      expect(capsule.roundAtUnix(publish)).toBe(round);
      expect(capsule.roundAtUnix(publish + 1)).toBe(round + 1);
      expect(capsule.roundAtUnix(publish + 2999)).toBe(round + 1);
    }
    expect(requests).toHaveLength(0);
  });

  it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, 8.64e15 + 1, -8.64e15 - 1])(
    'rejects invalid date %s without loading crypto or fetching', time => {
      expect(() => capsule.roundAtUnix(time)).toThrow(RangeError);
      expect(requests).toHaveLength(0);
    },
  );

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid round %s at the math and encryption boundaries', async round => {
      expect(() => capsule.unixMsAtRound(round)).toThrow(RangeError);
      await expect(capsule.timelockEncrypt('private', round)).rejects.toBeInstanceOf(RangeError);
      await expect(createDrandClient().get(round)).rejects.toBeInstanceOf(RangeError);
      expect(requests).toHaveLength(0);
    },
  );
});

describe('bounded drand transport', () => {
  it('aborts the first info timeout and verifies the next endpoint', async () => {
    respond = (url, signal) => url === infoUrl(BASES[0]) ? delayed(signal) : goodResponse(url);
    const result = createDrandClient().get(BEACON.round);
    await vi.advanceTimersByTimeAsync(4999);
    expect(requests.map(request => request.url)).toEqual([infoUrl(BASES[0])]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(BEACON);
    expect(requests.map(request => request.url)).toEqual([
      infoUrl(BASES[0]), infoUrl(BASES[1]), roundUrl(BASES[1]),
    ]);
    expect(requests[0].signal.aborted).toBe(true);
    expect(performance.now()).toBe(5000);
  });

  it.each([404, 503, 'rejected fetch'])(
    'falls back when the first info request fails with %s', async failure => {
      respond = url => {
        if (url !== infoUrl(BASES[0])) return goodResponse(url);
        if (typeof failure === 'number') return json({ error: 'private server text' }, failure);
        return Promise.reject({ detail: '404 not found private server text' });
      };
      await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
      expect(requests.map(request => request.url)).toEqual([
        infoUrl(BASES[0]), infoUrl(BASES[1]), roundUrl(BASES[1]),
      ]);
      expect(requests[0].signal.aborted).toBe(true);
    },
  );

  it.each([404, 503, 'timeout'])(
    'falls back after successful info but a round request fails with %s', async failure => {
      respond = (url, signal) => url === roundUrl(BASES[0])
        ? (typeof failure === 'number' ? json({}, failure) : delayed(signal)) : goodResponse(url);
      const result = createDrandClient().get(BEACON.round);
      await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 5000 : 0);
      await expect(result).resolves.toEqual(BEACON);
      expect(requests.map(request => request.url)).toEqual([
        infoUrl(BASES[0]), roundUrl(BASES[0]), infoUrl(BASES[1]), roundUrl(BASES[1]),
      ]);
      expect(requests[1].signal.aborted).toBe(true);
    },
  );

  it('aborts a response body that stalls after successful headers', async () => {
    let bodyAborted = false;
    respond = (url, signal) => {
      if (url !== infoUrl(BASES[0])) return goodResponse(url);
      pending.add(signal);
      return new Response(new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => {
            pending.delete(signal);
            bodyAborted = true;
            controller.error(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        },
      }));
    };
    const result = createDrandClient().get(BEACON.round);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual(BEACON);
    expect(bodyAborted).toBe(true);
    expect(requests[0].signal.aborted).toBe(true);
  });

  it('finishes all hanging endpoints within 20 seconds and can retry', async () => {
    respond = (_url, signal) => delayed(signal);
    const result = createDrandClient().get(BEACON.round).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await result;
    expect(error).toBeInstanceOf(capsule.NoEndpointError);
    expect(error).toMatchObject({ code: 'DRAND_UNAVAILABLE', round: BEACON.round, budgetExceeded: true });
    expect(error.attempts).toEqual(BASES.map(endpoint => ({
      endpoint, phase: 'info', round: undefined, reason: 'timeout',
    })));
    expect(requests.every(request => request.signal.aborted)).toBe(true);
    respond = url => goodResponse(url);
    await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
  });

  it('shares one total budget across info, round, and subsequent endpoints', async () => {
    respond = (url, signal) => url.endsWith('/info')
      ? delayed(signal, json(INFO), 4500) : delayed(signal);
    const result = createDrandClient().get(BEACON.round).catch(error => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ code: 'DRAND_UNAVAILABLE', budgetExceeded: true });
    expect(requests.map(({ url, start }) => [url, start])).toEqual([
      [infoUrl(BASES[0]), 0], [roundUrl(BASES[0]), 4500],
      [infoUrl(BASES[1]), 9500], [roundUrl(BASES[1]), 14_000],
      [infoUrl(BASES[2]), 19_000],
    ]);
    expect(requests[4].signal.aborted).toBe(true); // Only 1s of the budget remained.
  });

  it('recovers from a cached endpoint failure and prefers the working fallback', async () => {
    await expect(createDrandClient().chain().info()).resolves.toEqual(INFO);
    respond = url => url === roundUrl(BASES[0]) ? json({}, 503) : goodResponse(url);
    await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
    const count = requests.length;
    await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
    expect(requests.slice(count).map(request => request.url)).toEqual([roundUrl(BASES[1])]);
    // A subsequent failure of that cached fallback allows the original node to recover.
    respond = url => url === roundUrl(BASES[1]) ? json({}, 503) : goodResponse(url);
    await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
    expect(requests.slice(-3).map(request => request.url)).toEqual([
      roundUrl(BASES[1]), infoUrl(BASES[0]), roundUrl(BASES[0]),
    ]);
  });

  it('does not cache a failed round operation or its rejection', async () => {
    respond = url => url.endsWith('/info') ? json(INFO) : json({}, 503);
    await expect(createDrandClient().get(BEACON.round)).rejects.toMatchObject({
      code: 'DRAND_UNAVAILABLE', round: BEACON.round,
      attempts: BASES.map(endpoint => ({ endpoint, phase: 'round', reason: 'http', status: 503, round: BEACON.round })),
    });
    respond = url => goodResponse(url);
    await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
    expect(requests.slice(-2).map(request => request.url)).toEqual([infoUrl(BASES[0]), roundUrl(BASES[0])]);
  });

  it('consumes late rejections after abort without affecting the next endpoint', async () => {
    let rejectLate!: (reason: unknown) => void;
    respond = url => url === infoUrl(BASES[0])
      ? new Promise((_resolve, reject) => { rejectLate = reject; }) : goodResponse(url);
    const result = createDrandClient().get(BEACON.round);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual(BEACON);
    expect(requests[0].signal.aborted).toBe(true);
    rejectLate(new Error('late private error'));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('keeps concurrent operations and their abort signals independent', async () => {
    let first = true;
    respond = (url, signal) => {
      if (first) { first = false; return delayed(signal); }
      return goodResponse(url);
    };
    const slow = createDrandClient().get(BEACON.round);
    await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
    expect(requests[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(slow).resolves.toEqual(BEACON);
    expect(requests.filter(request => request.signal.aborted)).toHaveLength(1);
  });
});

describe('verification and error classification', () => {
  it.each([
    ['hash', 'private wrong hash'], ['public_key', 'private wrong key'],
    ['genesis_time', 0], ['period', 30], ['schemeID', 'bls-unchained-on-g1'],
  ])('rejects an untrusted info %s', async (field, value) => {
    respond = () => json({ ...INFO, [field]: value });
    await expect(createDrandClient().get(BEACON.round)).rejects.toMatchObject({
      name: 'DrandVerificationError', code: 'DRAND_VERIFICATION_FAILED', round: BEACON.round,
    });
    expect(requests.map(request => request.url)).toEqual(BASES.map(infoUrl));
  });

  it('rejects an invalid signature even when its randomness hash and reported round match', async () => {
    // This genuine signature is for 1000, not 1001. Its randomness hash is valid.
    respond = url => json(url.endsWith('/info') ? INFO : { ...BEACON, round: 1001 });
    await expect(createDrandClient().get(1001)).rejects.toBeInstanceOf(capsule.DrandVerificationError);
  });

  it.each([
    { ...BEACON, round: 999 },
    { ...BEACON, signature: '00'.repeat(48) },
    { ...BEACON, signature: 'not found 404 private' },
    { ...BEACON, randomness: '00'.repeat(32) },
    { ...BEACON, previous_signature: '00' },
    null,
  ])('rejects malformed or mismatched beacons %#', async beacon => {
    respond = url => json(url.endsWith('/info') ? INFO : beacon);
    await expect(createDrandClient().get(BEACON.round)).rejects.toBeInstanceOf(capsule.DrandVerificationError);
  });

  it('can recover from a rejected signature using a verified fallback', async () => {
    respond = url => url === roundUrl(BASES[0])
      ? json({ ...BEACON, randomness: '00'.repeat(32) }) : goodResponse(url);
    await expect(createDrandClient().get(BEACON.round)).resolves.toEqual(BEACON);
    expect(requests.at(-1)?.url).toBe(roundUrl(BASES[1]));
  });

  it('reports past round 404 as unavailable, not future', async () => {
    respond = url => url.endsWith('/info') ? json(INFO) : json({ error: 'not found' }, 404);
    await expect(createDrandClient().get(BEACON.round)).rejects.toMatchObject({
      code: 'DRAND_UNAVAILABLE', round: BEACON.round,
    });
  });

  it('uses actual 404 status, verified chain time and the exact future round', async () => {
    vi.setSystemTime(capsule.unixMsAtRound(BEACON.round) - 1);
    respond = url => url.endsWith('/info') ? json(INFO) : json({}, 404);
    await expect(createDrandClient().get(BEACON.round)).rejects.toMatchObject({
      name: 'NotYetReadyError', code: 'DRAND_NOT_YET_READY', round: BEACON.round,
    });
  });

  it.each(['info-404', 'round-503', 'offline', 'invalid-json'])(
    'does not misclassify a future request with %s', async failure => {
      vi.setSystemTime(capsule.unixMsAtRound(BEACON.round) - 60_000);
      respond = url => {
        if (failure === 'offline') return Promise.reject({ message: '404 not found too early future private' });
        if (failure === 'invalid-json') return new Response('404 not found private');
        if (failure === 'info-404') return json({}, 404);
        return url.endsWith('/info') ? json(INFO) : json({}, 503);
      };
      const error = await createDrandClient().get(BEACON.round).catch(error => error);
      expect(error).toBeInstanceOf(capsule.NoEndpointError);
      expect(JSON.stringify(error)).not.toContain('private');
      expect(error.message).not.toContain('404');
    },
  );
});

describe('time-capsule crypto compatibility', () => {
  it.each(['Unicode 正文\n\t**with spaces**  ', new Uint8Array([0, 255, 1, 128, 10]), new Uint8Array()])(
    'round-trips with real tlock, pinned quicknet and a fixed verified beacon %#', async payload => {
      const armor = await capsule.timelockEncrypt(payload, BEACON.round);
      expect(armor).toMatch(/^-----BEGIN AGE ENCRYPTED FILE-----/);
      const expected = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
      await expect(capsule.timelockDecrypt(armor)).resolves.toEqual(expected);
      // tlock accepted raw age before this change; retain that compatibility too.
      await expect(capsule.timelockDecrypt(decodeArmor(armor))).resolves.toEqual(expected);
      expect(requests.filter(request => request.url.endsWith('/info'))).toHaveLength(1);
    },
  );

  it('opens an age ciphertext produced directly by the previous tlock API', async () => {
    const tlock = await import('tlock-js');
    const client = createDrandClient();
    const armor = await tlock.timelockEncrypt(BEACON.round, Buffer.from('old link'), client);
    await expect(capsule.timelockDecrypt(armor)).resolves.toEqual(new TextEncoder().encode('old link'));
  });

  it('reports the parsed future round without depending on tlock error wording', async () => {
    const armor = await capsule.timelockEncrypt('waiting', BEACON.round);
    vi.setSystemTime(capsule.unixMsAtRound(BEACON.round) - 1);
    await expect(capsule.timelockDecrypt(armor)).rejects.toMatchObject({
      name: 'NotYetReadyError', round: BEACON.round,
    });
    expect(requests.map(request => request.url)).toEqual([infoUrl(BASES[0])]);
    vi.setSystemTime(capsule.unixMsAtRound(BEACON.round));
    await expect(capsule.timelockDecrypt(armor)).resolves.toEqual(new TextEncoder().encode('waiting'));
  });

  it.each(['404 not found too early future private', '', 'age-encryption.org/v404\nprivate'])(
    'rejects malformed ciphertext before any drand request %#', async value => {
      const error = await capsule.timelockDecrypt(value).catch(error => error);
      expect(error).toBeInstanceOf(capsule.InvalidCiphertextError);
      expect(error.message).not.toContain('private');
      expect(requests).toHaveLength(0);
    },
  );

  it.each(['0', '-1', '1.5', '1000private', 'NaN', 'Infinity', '9007199254740992'])(
    'rejects invalid embedded round %s before future classification', async round => {
      const armor = await capsule.timelockEncrypt('data', BEACON.round);
      const raw = decodeArmor(armor).replace('-> tlock 1000 ', `-> tlock ${round} `);
      const count = requests.length;
      await expect(capsule.timelockDecrypt(encodeArmor(raw))).rejects.toBeInstanceOf(capsule.InvalidCiphertextError);
      expect(requests).toHaveLength(count);
    },
  );

  it('rejects a foreign chain or truncated future ciphertext before waiting', async () => {
    const armor = await capsule.timelockEncrypt('data', BEACON.round);
    vi.setSystemTime(capsule.unixMsAtRound(BEACON.round) - 1);
    const raw = decodeArmor(armor);
    const count = requests.length;
    for (const damaged of [raw.replace(INFO.hash, 'f'.repeat(64)), raw.slice(0, -32)]) {
      await expect(capsule.timelockDecrypt(encodeArmor(damaged))).rejects.toBeInstanceOf(capsule.InvalidCiphertextError);
    }
    expect(requests).toHaveLength(count);
  });

  it('rejects payload authentication damage without turning it into a future retry', async () => {
    const armor = await capsule.timelockEncrypt('secret body', BEACON.round);
    const raw = decodeArmor(armor);
    const damaged = raw.slice(0, -1) + String.fromCharCode(raw.charCodeAt(raw.length - 1) ^ 1);
    const error = await capsule.timelockDecrypt(encodeArmor(damaged)).catch(error => error);
    expect(error).toBeInstanceOf(capsule.InvalidCiphertextError);
    expect(error.message).not.toContain('secret body');
  });

  it('preserves all four share schemes with mocked drand and real encryption', async () => {
    const { encodeUrl, decodeUrl, openTimeCapsule } = await import('./url-codec');
    const state = { md: '#  文档\n\twith spaces  ', title: 'title', comments: [] };
    const unlockMs = capsule.unixMsAtRound(BEACON.round);
    for (const [scheme, options] of [
      ['#d=', {}], ['#e=', { password: 'secret password' }],
      ['#td=', { unlockMs }], ['#te=', { unlockMs, password: 'secret password' }],
    ] as const) {
      vi.setSystemTime(unlockMs - 1000);
      const hash = await encodeUrl(state, options);
      expect(hash.startsWith(scheme)).toBe(true);
      vi.setSystemTime(unlockMs);
      const decoded = await decodeUrl(hash, 'secret password');
      expect(decoded.error).toBeUndefined();
      const opened = decoded.timeCapsule ? await openTimeCapsule(decoded.timeCapsule) : decoded.state;
      expect(opened).toEqual(state);
    }
  });
});

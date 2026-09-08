// Loaded only by timecapsule-crypto. drand-client 1.2.5's HttpOptions do not
// accept a signal, so implement its public ChainClient contract locally.
import { fetchBeacon } from 'drand-client';
import type { Chain, ChainClient, ChainInfo, ChainOptions, RandomnessBeacon } from 'drand-client';
import {
  QUICKNET, DrandVerificationError, NoEndpointError, NotYetReadyError,
  unixMsAtRound,
} from './timecapsule';
import type { DrandAttempt } from './timecapsule';

const ENDPOINTS = [
  'https://api.drand.sh',
  'https://drand.cloudflare.com',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
];
const REQUEST_TIMEOUT_MS = 5_000;
const NETWORK_BUDGET_MS = 20_000;

// Only successful, pinned information is cached. Requests, deadlines and
// rejected promises are never shared between seal/open operations.
const infoCache = new Map<string, ChainInfo>();
let preferredEndpoint = ENDPOINTS[0];

class EndpointFailure extends Error {
  constructor(readonly attempt: DrandAttempt) {
    super('drand endpoint request failed');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verifiedInfo(value: unknown, endpoint: string): ChainInfo {
  if (!record(value) || value.hash !== QUICKNET.hash ||
      value.public_key !== QUICKNET.public_key ||
      value.genesis_time !== QUICKNET.genesis_time || value.period !== QUICKNET.period ||
      value.schemeID !== QUICKNET.schemeID || typeof value.groupHash !== 'string' ||
      !record(value.metadata) || typeof value.metadata.beaconID !== 'string') {
    throw new EndpointFailure({ endpoint, phase: 'info', reason: 'verification' });
  }
  // Do not carry arbitrary server fields into crypto code or diagnostics.
  return { ...QUICKNET, groupHash: value.groupHash, metadata: { beaconID: value.metadata.beaconID } };
}

function parsedBeacon(value: unknown, endpoint: string, round: number): RandomnessBeacon {
  if (!record(value) || value.round !== round ||
      typeof value.signature !== 'string' || !/^[\da-f]{96}$/i.test(value.signature) ||
      typeof value.randomness !== 'string' || !/^[\da-f]{64}$/i.test(value.randomness) ||
      value.previous_signature !== undefined) {
    throw new EndpointFailure({ endpoint, phase: 'round', round, reason: 'verification' });
  }
  return { round, signature: value.signature, randomness: value.randomness };
}

function requestJson(
  endpoint: string, phase: DrandAttempt['phase'], deadline: number, round?: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, Math.max(0, deadline - performance.now()));
  const failure = (reason: DrandAttempt['reason'], status?: number) =>
    new EndpointFailure({ endpoint, phase, round, reason, ...(status === undefined ? {} : { status }) });
  if (timeoutMs <= 0) return Promise.reject(failure('timeout'));

  // The deadline actively aborts fetch AND response-body consumption. The
  // rejection handler also consumes a late rejection from a nonconforming
  // fetch implementation; it cannot poison the next endpoint or cached info.
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(failure('timeout'));
    }, timeoutMs);
    const request = async (): Promise<unknown> => {
      const path = phase === 'info' ? 'info' : `public/${round}`;
      const response = await fetch(`${endpoint}/${QUICKNET.hash}/${path}`, {
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
      });
      if (controller.signal.aborted) {
        // A late response from a fetch polyfill must not leave its body open.
        void response.body?.cancel().catch(() => {});
        throw failure('timeout');
      }
      if (!response.ok) throw failure('http', response.status);
      try {
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw failure('timeout');
        if (error instanceof SyntaxError) throw failure('invalid-response');
        throw failure('network');
      }
    };
    void request().then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      controller.abort();
      reject(error instanceof EndpointFailure ? error : failure('network'));
    });
  });
}

/** A fresh operation gets one monotonic budget across info, round and failover. */
export function createDrandClient(targetRound?: number): ChainClient {
  const deadline = performance.now() + NETWORK_BUDGET_MS;
  const endpoints = [preferredEndpoint, ...ENDPOINTS.filter(base => base !== preferredEndpoint)];
  const attempts: DrandAttempt[] = [];
  let position = 0;
  const options: ChainOptions = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: { chainHash: QUICKNET.hash, publicKey: QUICKNET.public_key },
  };

  async function withEndpoint<T>(
    operation: (base: string, info: ChainInfo) => Promise<T>, round = targetRound,
  ): Promise<T> {
    for (; position < endpoints.length && performance.now() < deadline; position++) {
      const base = endpoints[position];
      try {
        let info = infoCache.get(base);
        if (!info) {
          info = verifiedInfo(await requestJson(base, 'info', deadline), base);
          infoCache.set(base, info);
        }
        const result = await operation(base, info);
        preferredEndpoint = base;
        return result;
      } catch (error) {
        if (!(error instanceof EndpointFailure)) throw error;
        attempts.push(error.attempt);
        infoCache.delete(base);
      }
    }
    // Preserve verification failures even if other endpoints were offline.
    if (attempts.some(attempt => attempt.reason === 'verification')) {
      throw new DrandVerificationError([...attempts], round);
    }
    // A 404 is evidence of an unpublished round only with a verified schedule,
    // a concrete requested round, and no contrary network/HTTP failures.
    if (round !== undefined && unixMsAtRound(round) > Date.now() && attempts.length > 0 &&
        attempts.every(attempt => attempt.phase === 'round' && attempt.status === 404)) {
      throw new NotYetReadyError(round);
    }
    throw new NoEndpointError([...attempts], round, performance.now() >= deadline);
  }

  const chain: Chain = {
    get baseUrl() { return `${endpoints[position] ?? endpoints[0]}/${QUICKNET.hash}`; },
    info: () => withEndpoint(async (_base, info) => info),
  };
  const client: ChainClient = {
    options,
    chain: () => chain,
    latest: async () => {
      const info = await chain.info();
      return client.get(Math.floor((Date.now() / 1000 - info.genesis_time) / info.period) + 1);
    },
    get: async round => {
      unixMsAtRound(round);
      return withEndpoint(async (base, info) => {
        const beacon = parsedBeacon(await requestJson(base, 'round', deadline, round), base, round);
        // Validate INSIDE the endpoint attempt so bad signatures also fail over.
        // Use the library's public verifier with a typed, in-memory transport.
        const candidate: ChainClient = {
          options,
          chain: () => ({ baseUrl: `${base}/${QUICKNET.hash}`, info: async () => info }),
          get: async () => beacon,
          latest: async () => beacon,
        };
        try {
          return await fetchBeacon(candidate, round);
        } catch {
          throw new EndpointFailure({ endpoint: base, phase: 'round', round, reason: 'verification' });
        }
      }, round);
    },
  };
  return client;
}

// This is the same pinned quicknet information used by the time-capsule unit
// tests. Round 992 publishes on a whole minute, matching datetime-local input
// precision. Its real beacon lets the browser run actual tlock encryption and
// signature verification while every drand request is fulfilled offline.
export const DRAND_INFO = {
  hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  public_key:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesis_time: 1692803367,
  period: 3,
  schemeID: 'bls-unchained-g1-rfc9380',
  groupHash: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
  metadata: { beaconID: 'quicknet' },
};

export const DRAND_BEACON = {
  round: 992,
  randomness: '5c7adf1800f7878909a9c31bf254fe0be3f8d7939f70dd30e3cc78754d1f86df',
  signature:
    '84ded69151cf00341cb8d11a15472e44e5268046ab6c2301ff74ed3aab9b517c857191506eda83dd8442c9d6752cfeca',
};

export const DRAND_ORIGINS = new Set([
  'https://api.drand.sh',
  'https://drand.cloudflare.com',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
]);

export const UNLOCK_MS = (DRAND_INFO.genesis_time + (DRAND_BEACON.round - 1) * DRAND_INFO.period) * 1000;

import type { Buffer as NodeBuffer } from 'buffer';

// Standalone-only build alias. The preceding bootstrap owns the single Buffer
// implementation; both free globals and CJS/ESM imports see it immediately.
export const Buffer = (globalThis as unknown as { Buffer: typeof NodeBuffer }).Buffer;

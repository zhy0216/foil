import type { DocState } from '../types';

export class DocSchemaError extends Error {
  constructor(message = 'Invalid document data') {
    super(message);
    this.name = 'DocSchemaError';
  }
}

export interface DocLimits {
  maxThreads?: number;
  maxRepliesPerThread?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** IDs are opaque, nonempty tokens. Punctuation and Unicode are preserved;
 *  callers must still escape IDs when using them in selectors. */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\s\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertDocState(value: unknown, limits: DocLimits): asserts value is DocState {
  if (!isRecord(value) || typeof value.md !== 'string' || typeof value.title !== 'string' || !Array.isArray(value.comments)) {
    throw new DocSchemaError();
  }
  if (limits.maxThreads !== undefined && value.comments.length > limits.maxThreads) {
    throw new DocSchemaError('Too many comment threads to share');
  }

  const ids = new Set<string>();
  function addId(id: unknown) {
    if (!isValidId(id) || ids.has(id)) throw new DocSchemaError();
    ids.add(id);
  }

  for (const thread of value.comments) {
    if (!isRecord(thread) || typeof thread.quote !== 'string' || typeof thread.before !== 'string' || typeof thread.after !== 'string' || !Array.isArray(thread.replies)) {
      throw new DocSchemaError();
    }
    addId(thread.id);
    if (limits.maxRepliesPerThread !== undefined && thread.replies.length > limits.maxRepliesPerThread) {
      throw new DocSchemaError('Too many replies in a thread to share');
    }
    for (const reply of thread.replies) {
      if (!isRecord(reply) || typeof reply.author !== 'string' || typeof reply.body !== 'string' || !isFiniteTimestamp(reply.ts)) {
        throw new DocSchemaError();
      }
      addId(reply.id);
    }
  }
}

/** Validate without coercion, truncation, or mutation. Local storage can use
 *  the default shape-only check; share limits are opt-in. Extra storage
 *  metadata is retained, and must be validated by the storage caller. */
export function parseDocState(value: unknown, limits: DocLimits = {}): DocState {
  assertDocState(value, limits);
  return value;
}

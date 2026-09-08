/* Per-document local persistence.
   Each doc is its own localStorage entry; the current tab's binding lives in
   sessionStorage so multiple tabs stay independent. Browser storage is an
   optional capability: every operation is guarded and reports a stable,
   user-safe failure instead of throwing into the editor. */

import { DocSchemaError, isFiniteTimestamp, isValidId, parseDocState } from './doc-schema';
import type { CommentThread } from '../types';

const DOC_PREFIX = 'foil_doc_';
const CURRENT_KEY = 'foil_current_id';

export interface StoredDoc {
  id: string;
  title: string;
  md: string;
  comments: CommentThread[];
  createdAt: number;
  updatedAt: number;
}

export interface DocMeta {
  id: string;
  title: string;
  updatedAt: number;
}

export type StorageArea = 'local' | 'session';
export type StorageErrorCode = 'unavailable' | 'quota' | 'corrupt' | 'invalid';

export interface StorageFailure {
  code: StorageErrorCode;
  operation: string;
  message: string;
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageFailure };

export type DocReadResult = StorageResult<StoredDoc | null>;

export interface DocListSuccess {
  docs: DocMeta[];
  corrupt: number;
}

export type DocListResult = StorageResult<DocListSuccess>;

export type CreateDocResult =
  | { ok: true; value: StoredDoc }
  // Keep the generated document in memory when storage is unavailable. The
  // caller can continue editing and retry after storage becomes available.
  | { ok: false; error: StorageFailure; value: StoredDoc };

function genId(): string {
  return 'd' + Math.random().toString(36).slice(2, 10);
}

function failure(code: StorageErrorCode, operation: string): StorageFailure {
  const message =
    code === 'quota'
      ? 'Browser storage is full; your edits remain in memory.'
      : code === 'corrupt'
        ? 'A saved document is corrupt and was left untouched.'
        : code === 'invalid'
          ? 'The saved document has invalid data.'
          : 'Browser storage is unavailable; your edits remain in memory.';
  return { code, operation, message };
}

function classifyStorageError(error: unknown, operation: string): StorageFailure {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; code?: unknown };
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      return failure('quota', operation);
    }
  }
  return failure('unavailable', operation);
}

function getStorage(area: StorageArea, operation: string): StorageResult<Storage> {
  try {
    const storage = area === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    if (!storage) return { ok: false, error: failure('unavailable', operation) };
    return { ok: true, value: storage };
  } catch (error) {
    return { ok: false, error: classifyStorageError(error, operation) };
  }
}

/** Safe primitive operations used by settings and the document store. */
export function readStorageItem(area: StorageArea, key: string): StorageResult<string | null> {
  if (!key) return { ok: false, error: failure('invalid', 'read') };
  const storage = getStorage(area, 'read');
  if (!storage.ok) return storage;
  try {
    return { ok: true, value: storage.value.getItem(key) };
  } catch (error) {
    return { ok: false, error: classifyStorageError(error, 'read') };
  }
}

export function writeStorageItem(area: StorageArea, key: string, value: string): StorageResult<void> {
  if (!key) return { ok: false, error: failure('invalid', 'write') };
  const storage = getStorage(area, 'write');
  if (!storage.ok) return storage;
  try {
    storage.value.setItem(key, value);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: classifyStorageError(error, 'write') };
  }
}

export function removeStorageItem(area: StorageArea, key: string): StorageResult<void> {
  if (!key) return { ok: false, error: failure('invalid', 'remove') };
  const storage = getStorage(area, 'remove');
  if (!storage.ok) return storage;
  try {
    storage.value.removeItem(key);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: classifyStorageError(error, 'remove') };
  }
}

function validStoredTime(value: unknown): value is number {
  return isFiniteTimestamp(value) && Number.isSafeInteger(value) && value >= 0;
}

function parseStoredDoc(value: unknown, expectedId?: string): StoredDoc {
  try {
    parseDocState(value);
  } catch (error) {
    if (error instanceof DocSchemaError) throw error;
    throw new DocSchemaError();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DocSchemaError();
  }
  const doc = value as Record<string, unknown>;
  if (!isValidId(doc.id) || (expectedId !== undefined && doc.id !== expectedId)) {
    throw new DocSchemaError();
  }
  if (!validStoredTime(doc.createdAt) || !validStoredTime(doc.updatedAt) || doc.createdAt > doc.updatedAt) {
    throw new DocSchemaError();
  }
  return value as StoredDoc;
}

function docKey(id: string): StorageResult<string> {
  if (!isValidId(id)) return { ok: false, error: failure('invalid', 'document') };
  return { ok: true, value: DOC_PREFIX + id };
}

/** Read a document while distinguishing absence, corruption, and storage failure. */
export function readDoc(id: string): DocReadResult {
  const key = docKey(id);
  if (!key.ok) return key;
  const raw = readStorageItem('local', key.value);
  if (!raw.ok) return raw;
  if (raw.value == null) return { ok: true, value: null };
  try {
    return { ok: true, value: parseStoredDoc(JSON.parse(raw.value), id) };
  } catch {
    return { ok: false, error: failure('corrupt', 'read') };
  }
}

/** Compatibility helper; callers needing the reason should use readDoc. */
export function getDoc(id: string): StoredDoc | null {
  const result = readDoc(id);
  return result.ok ? result.value : null;
}

/** Enumerate valid documents without modifying malformed entries. */
export function listDocsDetailed(): DocListResult {
  const storage = getStorage('local', 'enumerate');
  if (!storage.ok) return storage;
  const out: DocMeta[] = [];
  let corrupt = 0;
  try {
    const length = storage.value.length;
    for (let i = 0; i < length; i++) {
      const key = storage.value.key(i);
      if (!key || !key.startsWith(DOC_PREFIX)) continue;
      const suffix = key.slice(DOC_PREFIX.length);
      const raw = storage.value.getItem(key);
      if (raw == null) {
        corrupt++;
        continue;
      }
      try {
        const doc = parseStoredDoc(JSON.parse(raw), suffix);
        out.push({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt });
      } catch {
        corrupt++;
      }
    }
  } catch (error) {
    return { ok: false, error: classifyStorageError(error, 'enumerate') };
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ok: true, value: { docs: out, corrupt } };
}

/** Compatibility helper retaining the original listDocs return shape. */
export function listDocs(): DocMeta[] {
  const result = listDocsDetailed();
  return result.ok ? result.value.docs : [];
}

/** Save only a valid document and never overwrite an existing corrupt record. */
export function saveDoc(doc: StoredDoc): StorageResult<void> {
  let parsed: StoredDoc;
  try {
    parsed = parseStoredDoc(doc, doc.id);
  } catch {
    return { ok: false, error: failure('invalid', 'write') };
  }
  const key = docKey(parsed.id);
  if (!key.ok) return key;
  const storage = getStorage('local', 'write');
  if (!storage.ok) return storage;
  try {
    const existingRaw = storage.value.getItem(key.value);
    if (existingRaw != null) {
      try {
        parseStoredDoc(JSON.parse(existingRaw), parsed.id);
      } catch {
        return { ok: false, error: failure('corrupt', 'write') };
      }
    }
    storage.value.setItem(key.value, JSON.stringify(parsed));
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: classifyStorageError(error, 'write') };
  }
}

export function deleteDoc(id: string): StorageResult<void> {
  const key = docKey(id);
  if (!key.ok) return key;
  return removeStorageItem('local', key.value);
}

export function createDocResult(
  initial?: Partial<Pick<StoredDoc, 'title' | 'md' | 'comments'>>
): CreateDocResult {
  const now = Date.now();
  let doc: StoredDoc = {
    id: genId(),
    title: initial?.title ?? 'Untitled document',
    md: initial?.md ?? '',
    comments: initial?.comments ?? [],
    createdAt: now,
    updatedAt: now,
  };
  // A random ID collision must never turn creation into an overwrite. Keep a
  // corrupt existing record untouched as well; saveDoc performs the final
  // check immediately before writing.
  let available = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = readDoc(doc.id);
    if (!existing.ok) return { ok: false, error: existing.error, value: doc };
    if (!existing.value) {
      available = true;
      break;
    }
    doc = { ...doc, id: genId() };
  }
  if (!available) return { ok: false, error: failure('unavailable', 'create'), value: doc };
  const result = saveDoc(doc);
  return result.ok ? { ok: true, value: doc } : { ok: false, error: result.error, value: doc };
}

/** Compatibility helper. Use createDocResult when persistence status matters. */
export function createDoc(initial?: Partial<Pick<StoredDoc, 'title' | 'md' | 'comments'>>): StoredDoc {
  return createDocResult(initial).value;
}

export function readCurrentId(): StorageResult<string | null> {
  const result = readStorageItem('session', CURRENT_KEY);
  if (!result.ok) return result;
  if (result.value == null || result.value === '') return { ok: true, value: null };
  return isValidId(result.value)
    ? { ok: true, value: result.value }
    : { ok: false, error: failure('corrupt', 'read') };
}

export function getCurrentId(): string | null {
  const result = readCurrentId();
  return result.ok ? result.value : null;
}

export function setCurrentId(id: string): StorageResult<void> {
  if (!isValidId(id)) return { ok: false, error: failure('invalid', 'write') };
  return writeStorageItem('session', CURRENT_KEY, id);
}

export function clearCurrentId(): StorageResult<void> {
  return removeStorageItem('session', CURRENT_KEY);
}

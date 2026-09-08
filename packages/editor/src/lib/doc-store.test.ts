import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocResult,
  deleteDoc,
  listDocsDetailed,
  readCurrentId,
  readDoc,
  saveDoc,
  setCurrentId,
} from './doc-store';

const key = 'foil_doc_local';
const doc = {
  id: 'local',
  title: 'Local note',
  md: '#  keep this exact',
  comments: [],
  createdAt: 10,
  updatedAt: 20,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('safe local document storage', () => {
  it('round-trips valid documents and preserves metadata', () => {
    expect(saveDoc(doc)).toEqual({ ok: true, value: undefined });
    expect(readDoc(doc.id)).toEqual({ ok: true, value: doc });
    expect(listDocsDetailed()).toEqual({
      ok: true,
      value: { docs: [{ id: doc.id, title: doc.title, updatedAt: doc.updatedAt }], corrupt: 0 },
    });
  });

  it('skips corrupt records without deleting or replacing their raw value', () => {
    const raw = '{"id":"local","title":{},"md":"keep","comments":[],"createdAt":1,"updatedAt":1}';
    localStorage.setItem(key, raw);
    expect(readDoc('local')).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(listDocsDetailed()).toEqual({ ok: true, value: { docs: [], corrupt: 1 } });
    expect(localStorage.getItem(key)).toBe(raw);
    expect(saveDoc(doc)).toMatchObject({ ok: false, error: { code: 'corrupt' } });
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it('distinguishes an absent record from malformed metadata', () => {
    expect(readDoc('missing')).toEqual({ ok: true, value: null });
    localStorage.setItem(key, JSON.stringify({ ...doc, updatedAt: Infinity }));
    // JSON.stringify turns Infinity into null, which fails the metadata check.
    expect(readDoc('local')).toMatchObject({ ok: false, error: { code: 'corrupt' } });
  });

  it('reports quota failures and keeps an in-memory document for retry', () => {
    const error = Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw error;
    });
    expect(saveDoc(doc)).toMatchObject({ ok: false, error: { code: 'quota' } });
    const created = createDocResult({ md: 'draft stays in memory' });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.value.md).toBe('draft stays in memory');
  });

  it('contains SecurityError and session failures without throwing', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    expect(readDoc('local')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(listDocsDetailed()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(setCurrentId('local')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(readCurrentId()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  it('removes only the requested valid document and reports invalid IDs', () => {
    expect(deleteDoc('bad id')).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(deleteDoc('local')).toEqual({ ok: true, value: undefined });
  });
});

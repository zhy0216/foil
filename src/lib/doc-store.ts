/* Per-document local persistence.
   Each doc is its own localStorage entry; the current tab's binding lives in
   sessionStorage so multiple tabs stay independent. */

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

function genId(): string {
  return 'd' + Math.random().toString(36).slice(2, 10);
}

export function listDocs(): DocMeta[] {
  const out: DocMeta[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(DOC_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const doc = JSON.parse(raw) as StoredDoc;
      out.push({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt });
    } catch {
      /* skip corrupt entry */
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function getDoc(id: string): StoredDoc | null {
  try {
    const raw = localStorage.getItem(DOC_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as StoredDoc;
  } catch {
    return null;
  }
}

export function saveDoc(doc: StoredDoc): void {
  localStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify(doc));
}

export function deleteDoc(id: string): void {
  localStorage.removeItem(DOC_PREFIX + id);
}

export function createDoc(initial?: Partial<Pick<StoredDoc, 'title' | 'md' | 'comments'>>): StoredDoc {
  const now = Date.now();
  const doc: StoredDoc = {
    id: genId(),
    title: initial?.title ?? 'Untitled document',
    md: initial?.md ?? '',
    comments: initial?.comments ?? [],
    createdAt: now,
    updatedAt: now,
  };
  saveDoc(doc);
  return doc;
}

export function getCurrentId(): string | null {
  return sessionStorage.getItem(CURRENT_KEY);
}

export function setCurrentId(id: string): void {
  sessionStorage.setItem(CURRENT_KEY, id);
}

export function clearCurrentId(): void {
  sessionStorage.removeItem(CURRENT_KEY);
}

/* Comment source mapping for the reading view: locates quote/before/after
   anchors in normalized Markdown and maps them onto visible text fragments.
   Uses only pure string helpers; never the line-based editor DOM functions. */

import { findAnchorRange } from './editor-dom';
import type { ReadingDocument, ReadingFragment } from './reading-document';

export interface CommentAnchorRef {
  id: string;
  quote: string;
  before: string;
  after: string;
}

/** One located piece of a comment: a source range clipped to one fragment. */
export interface LocatedPiece {
  fragment: number;
  start: number;
  end: number;
}

export interface CommentLocations {
  /** Thread id -> pieces in source order; located comments only. */
  located: Map<string, LocatedPiece[]>;
  /** Thread ids whose quote is syntax-only, invisible or otherwise not
   *  reliably locatable; hosts keep them reachable in an unlocated list. */
  unlocated: string[];
}

/** True when the clipped range covers at least one visible codepoint, so
 *  quotes hitting only syntax (fences, markers, entity padding) never count
 *  as located. */
function coversVisible(fragment: ReadingFragment, start: number, end: number): boolean {
  const offsets = fragment.charOffsets;
  if (!offsets) return fragment.text.length > 0;
  for (let i = 0; i + 1 < offsets.length; i++) {
    if (offsets[i] < end && offsets[i + 1] > start) return true;
  }
  return false;
}

export function locateComments(doc: ReadingDocument, threads: readonly CommentAnchorRef[]): CommentLocations {
  const located = new Map<string, LocatedPiece[]>();
  const unlocated: string[] = [];
  for (const thread of threads) {
    const range = findAnchorRange(doc.markdown, thread);
    if (!range || range.start >= range.end) {
      unlocated.push(thread.id);
      continue;
    }
    const pieces: LocatedPiece[] = [];
    for (let i = 0; i < doc.fragments.length; i++) {
      const fragment = doc.fragments[i];
      if (fragment.end <= range.start) continue;
      if (fragment.start >= range.end) break;
      const start = Math.max(fragment.start, range.start);
      const end = Math.min(fragment.end, range.end);
      if (coversVisible(fragment, start, end)) pieces.push({ fragment: i, start, end });
    }
    if (pieces.length) located.set(thread.id, pieces);
    else unlocated.push(thread.id);
  }
  return { located, unlocated };
}

export interface FragmentRange {
  id: string;
  start: number;
  end: number;
}

export interface HighlightPiece {
  text: string;
  /** Anchor ids covering this run, in the order the ranges were supplied. */
  anchors: string[];
}

/** Splits one fragment's visible text into runs of equal highlight coverage.
 *  Codepoints only partially covered by a range are included fully, so
 *  entities, escapes and surrogate pairs are never cut in half. Fragments
 *  without verified per-codepoint offsets highlight all-or-nothing. */
export function planFragmentPieces(fragment: ReadingFragment, ranges: readonly FragmentRange[]): HighlightPiece[] {
  const active = ranges.filter((range) => range.start < fragment.end && range.end > fragment.start);
  if (!active.length) return [{ text: fragment.text, anchors: [] }];
  const ids = active.map((range) => range.id);
  if (!fragment.charOffsets || !fragment.text) return [{ text: fragment.text, anchors: ids }];
  const offsets = fragment.charOffsets;
  const pieces: HighlightPiece[] = [];
  let codepoint = 0;
  for (const ch of fragment.text) {
    const covering = active.filter((range) => offsets[codepoint] < range.end && offsets[codepoint + 1] > range.start);
    const key = covering.map((range) => range.id).join('\u0000');
    const last = pieces[pieces.length - 1];
    if (last && last.anchors.join('\u0000') === key) last.text += ch;
    else pieces.push({ text: ch, anchors: covering.map((range) => range.id) });
    codepoint++;
  }
  return pieces;
}

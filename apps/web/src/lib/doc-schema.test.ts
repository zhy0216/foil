import { describe, expect, it } from 'vitest';
import { DocSchemaError, isFiniteTimestamp, isValidId, parseDocState } from './doc-schema';
import type { DocState } from '../types';

function document(): DocState {
  return {
    title: '中文标题 👩🏽‍💻',
    md: '#  原样保留\n\t空格、emoji 🦊、零宽\u200b字符\n',
    comments: [
      {
        id: '讨论["甲"]\\', quote: '空格', before: '\t', after: '、emoji',
        replies: [
          { id: 'r:甲', author: '作者 🐈', ts: 0, body: '第一条\n回复' },
          { id: 'r-2', author: '', ts: -0.5, body: '' },
        ],
      },
      { id: 'c2', quote: '', before: '', after: '', replies: [] },
    ],
  };
}

describe('document shape validation', () => {
  it('preserves text, opaque IDs, all replies, and the original object', () => {
    const value = document();
    const before = JSON.stringify(value);
    expect(parseDocState(value)).toBe(value);
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each([
    null, [], {}, { title: 'a', md: '', comments: null },
    { title: {}, md: '', comments: [] }, { title: 'a', md: {}, comments: [] },
    { title: 'a', md: '', comments: {} }, { title: 'a', md: '', comments: [null] },
    { title: 'a', md: '', comments: [[]] },
  ])('rejects an invalid document/container: %j', (value) => {
    expect(() => parseDocState(value)).toThrow(DocSchemaError);
  });

  it.each(['id', 'quote', 'before', 'after', 'replies'])('checks thread.%s', (field) => {
    const value = document();
    Object.assign(value.comments[0], { [field]: {} });
    expect(() => parseDocState(value)).toThrow('Invalid document data');
    Reflect.deleteProperty(value.comments[0], field);
    expect(() => parseDocState(value)).toThrow('Invalid document data');
  });

  it.each(['id', 'author', 'ts', 'body'])('checks reply.%s', (field) => {
    const value = document();
    Object.assign(value.comments[0].replies[0], { [field]: {} });
    expect(() => parseDocState(value)).toThrow('Invalid document data');
    Reflect.deleteProperty(value.comments[0].replies[0], field);
    expect(() => parseDocState(value)).toThrow('Invalid document data');
  });

  it.each([null, [], 'reply'])('rejects a non-object reply: %j', (reply) => {
    const value = document();
    Object.assign(value.comments[0], { replies: [reply] });
    expect(() => parseDocState(value)).toThrow('Invalid document data');
  });

  it.each([undefined, null, 12, '', ' ', 'two words', 'id\n', 'id\u0000', '\u007f', '\u0085'])('rejects invalid IDs: %j', (id) => {
    expect(isValidId(id)).toBe(false);
    for (const target of ['thread', 'reply']) {
      const value = document();
      Object.assign(target === 'thread' ? value.comments[0] : value.comments[0].replies[0], { id });
      expect(() => parseDocState(value)).toThrow('Invalid document data');
    }
  });

  it.each([NaN, Infinity, -Infinity, null, '123'])('rejects non-finite/non-numeric timestamps: %j', (ts) => {
    expect(isFiniteTimestamp(ts)).toBe(false);
    const value = document();
    Object.assign(value.comments[0].replies[0], { ts });
    expect(() => parseDocState(value)).toThrow('Invalid document data');
  });

  it.each(['thread', 'reply', 'cross-thread reply', 'thread/reply'])('rejects duplicate %s IDs', (kind) => {
    const value = document();
    const [first, second] = value.comments;
    if (kind === 'thread') second.id = first.id;
    if (kind === 'reply') first.replies[1].id = first.replies[0].id;
    if (kind === 'cross-thread reply') second.replies.push({ ...first.replies[0] });
    if (kind === 'thread/reply') first.replies[0].id = second.id;
    expect(() => parseDocState(value)).toThrow('Invalid document data');
  });

  it('allows local documents beyond share size and count limits without dropping metadata', () => {
    const stored = {
      ...document(), id: 'local-id', createdAt: 1, updatedAt: 2,
      md: '文'.repeat(4 * 1024 * 1024 + 1),
      comments: Array.from({ length: 1001 }, (_, i) => ({
        id: `c${i}`, quote: '', before: '', after: '',
        replies: i === 0 ? Array.from({ length: 201 }, (_, j) => ({
          id: `r${j}`, author: '', body: '', ts: 0,
        })) : [],
      })),
    };
    expect(parseDocState(stored)).toBe(stored);
    expect(stored.comments).toHaveLength(1001);
    expect(stored.comments[0].replies).toHaveLength(201);
    expect(stored.id).toBe('local-id');
  });

  it('applies explicitly requested count limits, including their exact boundary', () => {
    const value = document();
    const limits = { maxThreads: 2, maxRepliesPerThread: 2 };
    expect(parseDocState(value, limits)).toBe(value);
    expect(() => parseDocState(value, { ...limits, maxThreads: 1 })).toThrow('Too many comment threads');
    expect(() => parseDocState(value, { ...limits, maxRepliesPerThread: 1 })).toThrow('Too many replies');
  });
});

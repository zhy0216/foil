import { useState } from 'react';
import type { CommentThread } from '../types';

interface ThreadBaseProps {
  thread: CommentThread & { top?: number };
  active: boolean;
  onActivate: (id: string) => void;
  mode?: 'gutter' | 'sheet';
}

type ThreadProps = ThreadBaseProps & ({
  readOnly: true;
  onReply?: never;
  onDelete?: never;
  defaultName?: never;
} | {
  readOnly?: false;
  onReply: (threadId: string, body: string, author: string) => void;
  onDelete: (threadId: string) => void;
  defaultName: string;
});

function fmt(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = (now - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return d.toLocaleDateString();
}

export function Thread({
  thread,
  active,
  onActivate,
  onReply,
  onDelete,
  defaultName,
  readOnly = false,
  mode = 'gutter',
}: ThreadProps) {
  const [replying, setReplying] = useState(false);
  const [name, setName] = useState(defaultName || '');
  const [body, setBody] = useState('');

  const submit = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    if (readOnly || !body.trim()) return;
    onReply?.(thread.id, body, name || 'Anonymous');
    setBody('');
    setReplying(false);
  };

  return (
    <div
      className={'comment-thread' + (active ? ' active' : '') + (readOnly ? ' readonly' : '')}
      style={mode === 'gutter' ? { top: thread.top } : undefined}
      onClick={readOnly ? undefined : () => onActivate(thread.id)}
    >
      {readOnly ? (
        <button type="button" className="anchor" onClick={() => onActivate(thread.id)}>
          "{thread.quote}"
        </button>
      ) : <div className="anchor">"{thread.quote}"</div>}
      {thread.replies.map((r, i) => (
        <div key={r.id} className={i === 0 ? '' : 'reply'}>
          <div className="meta">
            <span className="author">{r.author}</span>
            <span>{fmt(r.ts)}</span>
          </div>
          <div className="body">{r.body}</div>
        </div>
      ))}
      {!readOnly && (replying ? (
        <div className="reply-input" style={{ flexDirection: 'column' }}>
          <input
            className="name-input"
            style={{
              background: 'transparent',
              border: 0,
              borderBottom: '1px solid var(--border)',
              padding: '4px 0',
              fontSize: 'var(--text-xs)',
              marginBottom: 6,
            }}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            placeholder="Reply…"
            value={body}
            autoFocus
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(e);
              }
            }}
          />
          <div
            className="row"
            style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}
          >
            <button
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                setReplying(false);
              }}
            >
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!body.trim()} onClick={submit}>
              Reply
            </button>
          </div>
        </div>
      ) : (
        <div className="small-actions">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReplying(true);
            }}
          >
            Reply
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(thread.id);
            }}
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { ComposerState } from '../types';

interface Props {
  pos: ComposerState;
  quote: string;
  defaultName: string;
  onSubmit: (body: string, author: string) => void;
  onCancel: () => void;
}

export function Composer({ pos, quote, defaultName, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(defaultName || '');
  const [body, setBody] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="composer" style={{ top: pos.top, left: pos.left }}>
      <div className="quote">"{quote}"</div>
      <input
        className="name-input"
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        ref={ref}
        placeholder="Leave a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (body.trim()) onSubmit(body, name || 'Anonymous');
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
      />
      <div className="row">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!body.trim()}
          onClick={() => onSubmit(body, name || 'Anonymous')}
        >
          Comment{' '}
          <span className="kbd" style={{ marginLeft: 4, opacity: 0.8 }}>
            ⌘↵
          </span>
        </button>
      </div>
    </div>
  );
}

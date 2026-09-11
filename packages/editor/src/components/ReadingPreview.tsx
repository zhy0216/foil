import { forwardRef, Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  parseReadingDocument,
  truncateTarget,
  type ReadingBlock,
  type ReadingDocument,
  type ReadingInline,
} from '../lib/reading-document';
import {
  locateComments,
  planFragmentPieces,
  type FragmentRange,
} from '../lib/reading-source-map';
import type { CommentThread } from '../types';

export interface ReadingPreviewProps {
  markdown: string;
  anchors: CommentThread[];
  activeAnchorId: string | null;
  onAnchorClick?: (id: string) => void;
}

interface RenderContext {
  doc: ReadingDocument;
  rangesByFragment: Map<number, FragmentRange[]>;
  activeAnchorId: string | null;
  interactive: boolean;
  quotes: Map<string, string>;
  /** Anchor ids that already received the single keyboard stop. */
  stops: Set<string>;
}

function inlineHasText(ctx: RenderContext, nodes: ReadingInline[]): boolean {
  for (const node of nodes) {
    if ('fragment' in node) {
      if (ctx.doc.fragments[node.fragment]?.text) return true;
    } else if ('children' in node && inlineHasText(ctx, node.children)) {
      return true;
    }
  }
  return false;
}

function renderPieces(ctx: RenderContext, index: number): ReactNode {
  const fragment = ctx.doc.fragments[index];
  if (!fragment) return null;
  const pieces = planFragmentPieces(fragment, ctx.rangesByFragment.get(index) ?? []);
  if (pieces.length === 1 && !pieces[0].anchors.length) return pieces[0].text;
  return pieces.map((piece, i) => {
    let node: ReactNode = piece.text;
    // Later anchors nest inside earlier ones; every id keeps one keyboard stop.
    for (let a = piece.anchors.length - 1; a >= 0; a--) {
      const id = piece.anchors[a];
      const stop = ctx.interactive && !ctx.stops.has(id);
      if (ctx.interactive) ctx.stops.add(id);
      node = (
        <span
          className={'anchor-hl' + (ctx.activeAnchorId === id ? ' active' : '')}
          data-anchor-id={id}
          tabIndex={stop ? 0 : undefined}
          role={stop ? 'button' : undefined}
          aria-label={stop ? `Read comment: ${ctx.quotes.get(id) ?? ''}` : undefined}
          aria-pressed={stop ? ctx.activeAnchorId === id : undefined}
        >
          {node}
        </span>
      );
    }
    return <Fragment key={i}>{node}</Fragment>;
  });
}

function renderLink(ctx: RenderContext, node: Extract<ReadingInline, { type: 'link' }>, key: number): ReactNode {
  const children = renderInlines(ctx, node.children);
  const label = inlineHasText(ctx, node.children) ? children : truncateTarget(node.href);
  const target = node.target;
  if (target.kind === 'external') {
    return (
      <a key={key} href={target.href} title={node.title ?? undefined} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  if (target.kind === 'mailto') {
    return (
      <a key={key} href={target.href} title={node.title ?? undefined}>
        {label}
      </a>
    );
  }
  if (target.kind === 'internal') {
    const headingId = target.headingId;
    return (
      <a
        key={key}
        href={`#${headingId}`}
        title={node.title ?? undefined}
        onClick={(event) => {
          // In-document jumps scroll; they must never rewrite the URL
          // fragment that carries share payloads.
          event.preventDefault();
          event.currentTarget.ownerDocument.getElementById(headingId)?.scrollIntoView();
        }}
      >
        {label}
      </a>
    );
  }
  return (
    <span key={key} className="reading-link-inert">
      {label}
      <span className="reading-link-target"> ({truncateTarget(node.href)})</span>
    </span>
  );
}

function renderInlines(ctx: RenderContext, nodes: ReadingInline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
      case 'html':
        return <Fragment key={i}>{renderPieces(ctx, node.fragment)}</Fragment>;
      case 'code':
        return <code key={i}>{renderPieces(ctx, node.fragment)}</code>;
      case 'emphasis':
        return <em key={i}>{renderInlines(ctx, node.children)}</em>;
      case 'strong':
        return <strong key={i}>{renderInlines(ctx, node.children)}</strong>;
      case 'delete':
        return <del key={i}>{renderInlines(ctx, node.children)}</del>;
      case 'mark':
        return <mark key={i} className="reading-mark">{renderInlines(ctx, node.children)}</mark>;
      case 'break':
        return <br key={i} />;
      case 'image':
        return <span key={i} className="reading-image">{renderPieces(ctx, node.fragment)}</span>;
      case 'footnoteRef':
        return <sup key={i} className="reading-footnote-ref">{renderPieces(ctx, node.fragment)}</sup>;
      case 'link':
        return renderLink(ctx, node, i);
    }
  });
}

function alignStyle(align: 'left' | 'right' | 'center' | null | undefined): CSSProperties | undefined {
  return align && align !== 'left' ? { textAlign: align } : undefined;
}

function renderBlocks(ctx: RenderContext, blocks: ReadingBlock[], tight = false): ReactNode[] {
  return blocks.map((block, i) => {
    switch (block.type) {
      case 'heading': {
        const Tag = `h${Math.min(6, Math.max(1, block.level))}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return <Tag key={i} id={block.id}>{renderInlines(ctx, block.children)}</Tag>;
      }
      case 'paragraph':
        return tight
          ? <Fragment key={i}>{renderInlines(ctx, block.children)}</Fragment>
          : <p key={i}>{renderInlines(ctx, block.children)}</p>;
      case 'blockquote':
        return <blockquote key={i}>{renderBlocks(ctx, block.children)}</blockquote>;
      case 'list': {
        const items = block.items.map((item, j) => (
          <li key={j} className={item.checked !== null ? 'reading-task-item' : undefined}>
            {item.checked !== null && <input type="checkbox" disabled checked={item.checked} />}
            {renderBlocks(ctx, item.children, block.tight)}
          </li>
        ));
        if (block.ordered) return <ol key={i} start={block.start ?? undefined}>{items}</ol>;
        return (
          <ul key={i} className={block.items.some((item) => item.checked !== null) ? 'reading-task-list' : undefined}>
            {items}
          </ul>
        );
      }
      case 'code':
        return <pre key={i} className="reading-code"><code>{renderPieces(ctx, block.fragment)}</code></pre>;
      case 'html':
        return <pre key={i} className="reading-html">{renderPieces(ctx, block.fragment)}</pre>;
      case 'thematicBreak':
        return <hr key={i} />;
      case 'table':
        return (
          <div key={i} className="reading-table-scroll">
            <table className="reading-table">
              <thead>
                <tr>
                  {block.head.map((cell, j) => (
                    <th key={j} style={alignStyle(block.align[j])}>{renderInlines(ctx, cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k} style={alignStyle(block.align[k])}>{renderInlines(ctx, cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** Semantic reading view: renders the parsed document with whitelisted React
 *  nodes only. Raw HTML stays visible text, unsafe link targets stay inert,
 *  images never fetch. Copying uses the browser's native selection, so users
 *  copy exactly the visible text; see CopyMarkdownButton for the source. */
export const ReadingPreview = forwardRef<HTMLDivElement, ReadingPreviewProps>(function ReadingPreview(
  { markdown, anchors, activeAnchorId, onAnchorClick },
  ref
) {
  const prepared = useMemo(() => {
    const doc = parseReadingDocument(markdown);
    const { located } = locateComments(doc, anchors);
    const rangesByFragment = new Map<number, FragmentRange[]>();
    for (const [id, pieces] of located) {
      for (const piece of pieces) {
        const ranges = rangesByFragment.get(piece.fragment) ?? [];
        ranges.push({ id, start: piece.start, end: piece.end });
        rangesByFragment.set(piece.fragment, ranges);
      }
    }
    return { doc, rangesByFragment };
  }, [markdown, anchors]);

  const quotes = useMemo(() => new Map(anchors.map((anchor) => [anchor.id, anchor.quote])), [anchors]);
  const ctx: RenderContext = {
    doc: prepared.doc,
    rangesByFragment: prepared.rangesByFragment,
    activeAnchorId,
    interactive: Boolean(onAnchorClick),
    quotes,
    stops: new Set(),
  };

  return (
    <div
      ref={ref}
      className="reading-preview"
      role="document"
      aria-label="Document text"
      onClick={(event) => {
        if (!onAnchorClick) return;
        if (!event.currentTarget.ownerDocument.getSelection()?.isCollapsed) return;
        const span = event.target instanceof Element ? event.target.closest<HTMLElement>('.anchor-hl') : null;
        if (span?.dataset.anchorId) onAnchorClick(span.dataset.anchorId);
      }}
      onKeyDown={(event) => {
        const span = event.target instanceof HTMLElement ? event.target : null;
        if ((event.key === 'Enter' || event.key === ' ') && span?.dataset.anchorId) {
          event.preventDefault();
          onAnchorClick?.(span.dataset.anchorId);
        }
      }}
    >
      {renderBlocks(ctx, prepared.doc.blocks)}
      {prepared.doc.footnotes.length > 0 && (
        <section className="reading-footnotes" aria-label="Footnotes">
          {prepared.doc.footnotes.map((footnote, i) => (
            <div className="reading-footnote" key={i}>
              <span className="reading-footnote-marker">{renderPieces(ctx, footnote.marker)}</span>
              {renderBlocks(ctx, footnote.blocks)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
});

/** Copies the raw Markdown source; the reading view's own copy is native and
 *  yields the visible text. Two contracts, deliberately different. */
export function CopyMarkdownButton({ markdown }: { markdown: string }) {
  return (
    <button
      type="button"
      className="btn btn-ghost-bordered"
      onClick={() => {
        void navigator.clipboard?.writeText(markdown).catch(() => {});
      }}
    >
      Copy Markdown
    </button>
  );
}

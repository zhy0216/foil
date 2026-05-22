import { describe, it, expect } from 'vitest';
import { renderDecorated, escapeHtml, inlineHtml } from './markdown';

/** Render `md` into a detached DOM element and return any event-attribute-bearing
 *  elements (img onerror, svg onload, iframe srcdoc, ...) and any javascript: URLs.
 *  These are the executable sinks an XSS payload would reach for. */
function findDangerousSinks(html: string): {
  withEventAttrs: Element[];
  jsUrlElements: Element[];
  scriptTags: HTMLScriptElement[];
} {
  const host = document.createElement('div');
  host.innerHTML = html;
  const all = host.querySelectorAll('*');
  const withEventAttrs: Element[] = [];
  const jsUrlElements: Element[] = [];
  for (const el of Array.from(all)) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) withEventAttrs.push(el);
      if (/^(href|src|xlink:href|action|formaction|srcdoc)$/i.test(attr.name)) {
        if (/^\s*javascript:/i.test(attr.value)) jsUrlElements.push(el);
      }
    }
  }
  const scriptTags = Array.from(host.querySelectorAll('script')) as HTMLScriptElement[];
  return { withEventAttrs, jsUrlElements, scriptTags };
}

describe('escapeHtml', () => {
  it('escapes <, >, &', () => {
    expect(escapeHtml('<img src=x>')).toBe('&lt;img src=x&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
});

describe('renderDecorated XSS regressions', () => {
  it('codefence start line containing HTML is escaped (F-01)', () => {
    const md = '```<img src=x onerror="alert(1)">\nhello\n```';
    const html = renderDecorated(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.withEventAttrs).toHaveLength(0);
    expect(sinks.scriptTags).toHaveLength(0);
    expect(html).not.toContain('<img');
  });

  it('codefence end line containing HTML is escaped (F-01)', () => {
    const md = '```\nbody\n```<svg onload=alert(1)>';
    const html = renderDecorated(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<svg');
  });

  it('inline HTML in paragraphs is escaped', () => {
    const md = '<img src=x onerror=alert(1)>';
    const html = renderDecorated(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<img');
  });

  it('iframe srcdoc payload is escaped', () => {
    const md = '<iframe srcdoc="<img src=x onerror=alert(1)>"></iframe>';
    const html = renderDecorated(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<iframe');
  });

  it('details ontoggle payload inside a heading is escaped', () => {
    const md = '# <details open ontoggle=alert(1)>x</details>';
    const html = renderDecorated(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<details');
  });

  it('javascript: link URLs render as text only (no clickable href)', () => {
    const md = '[click](javascript:alert(1))';
    const html = renderDecorated(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.jsUrlElements).toHaveLength(0);
  });

  it('javascript: image URLs render as text only (no clickable src)', () => {
    const md = '![x](javascript:alert(1))';
    const html = renderDecorated(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.jsUrlElements).toHaveLength(0);
  });

  it('quote line containing HTML is escaped', () => {
    const md = '> <img src=x onerror=alert(1)>';
    const html = renderDecorated(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<img');
  });

  it('task list item with HTML is escaped', () => {
    const md = '- [ ] <img src=x onerror=alert(1)>';
    const html = renderDecorated(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
  });

  it('horizontal rule line with injected HTML cannot exist (--- is exact match)', () => {
    // Sanity: hr regex is anchored; a line like "---<img>" should not match hr branch.
    const md = '---<img src=x onerror=alert(1)>';
    const html = renderDecorated(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
  });
});

describe('renderDecorated structural correctness', () => {
  it('still renders code fence markers visibly', () => {
    const html = renderDecorated('```ts\nx\n```');
    // The literal backticks must remain in the output text (escaped form is fine).
    expect(html).toContain('```ts');
    expect(html).toContain('codefence');
  });

  it('still renders inline bold/italic markup', () => {
    const html = inlineHtml('**bold**');
    expect(html).toContain('md-bold');
  });

  it('renders headings', () => {
    const html = renderDecorated('# Title');
    expect(html).toContain('class="ln h1"');
  });
});

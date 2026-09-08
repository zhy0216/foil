import { describe, it, expect } from 'vitest';
import { renderDecorated, escapeHtml, inlineHtml } from './markdown';
import { getMarkdown } from './editor-dom';

function renderMarkdown(md: string): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = renderDecorated(md);
  return host;
}

function expectMarkdownText(host: HTMLElement, md: string): void {
  const lines = md.split('\n');
  expect(getMarkdown(host)).toBe(md);
  expect(host.children).toHaveLength(lines.length);
  Array.from(host.children).forEach((block, i) => {
    expect(block.classList.contains('ln')).toBe(true);
    expect(block.getAttribute('data-i')).toBe(String(i));
    // Only truly empty lines need a caret placeholder; syntax stays in the text.
    expect(block.textContent).toBe(lines[i] === '' ? '\u200b' : lines[i]);
  });
}

function expectSafeMarkdown(md: string): string {
  const html = renderDecorated(md);
  const host = document.createElement('div');
  host.innerHTML = html;
  expectMarkdownText(host, md);
  for (const el of Array.from(host.querySelectorAll('*'))) {
    expect(['DIV', 'SPAN']).toContain(el.tagName);
    for (const attr of Array.from(el.attributes)) {
      // Decoration never needs href/src, event handlers, inline styles or srcdoc.
      expect(['class', 'data-i']).toContain(attr.name);
    }
  }
  return html;
}

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

  it('escapes both quote characters without changing their DOM text', () => {
    const text = `"double" and 'single' < & >`;
    const html = escapeHtml(text);
    expect(html).not.toMatch(/[<>"']/);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.children).toHaveLength(0);
    expect(host.textContent).toBe(text);
  });

  it.each(['"', "'"])('cannot break out of a %s-quoted plain attribute', (quote) => {
    const text = `" onmouseover="alert(1)" ' onclick='alert(2)' <script>&`;
    const host = document.createElement('div');
    host.innerHTML = `<span title=${quote}${escapeHtml(text)}${quote}></span>`;
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild!.getAttributeNames()).toEqual(['title']);
    expect(host.firstElementChild!.getAttribute('title')).toBe(text);
  });

  it('preserves literal entity spellings without decoding them twice', () => {
    const text = '&lt;script&gt; &amp; &quot; &#39; &#x3c; &notanentity;';
    const host = document.createElement('div');
    host.innerHTML = escapeHtml(text);
    expect(host.children).toHaveLength(0);
    expect(host.textContent).toBe(text);
  });
});

describe('renderDecorated markdown fidelity', () => {
  it.each([
    '#  heading',
    '-   item',
    '1.  item',
    '>quote',
    '\t  ',
    '-\t[x]\titem',
    '######\t heading  ',
    '##   ',
    '  >\t quote  ',
    '\t>>>nested quote\t',
    '>',
    '> ',
    '> ![图片](https://example.test/image.png)',
    '\t*\t  item \t',
    '+   ',
    '  42)\t item  ',
    '1.  ',
    '  +  [X]\t  已完成 ✅  ',
    '*\t[ ]  待办\t',
    '- [ ] ',
    '  leading and trailing \t ',
    ' \u00a0\t ',
    '',
    '\n',
    '\n\ntext\n\n',
    '\t  \n \n\t',
    '---  \n****\t',
    '```ts\n\n\t  \nconst text = "中文 👩🏽‍💻";\n```\n',
    '```\n#  literal heading\n-\t[x]\titem\n>quote',
    '**粗体 _斜体_** and __bold *emphasis*__',
    '~~strike **bold**~~ and ==mark _emphasis_==',
    '***nested*** and `**literal**`',
    '中文🙂 👩🏽‍💻 e\u0301 & "quotes" and \'apostrophes\'',
    '[**链接** _文字_](https://example.test/?a=1&b=2 "标题")',
    '![图片 🙂](https://example.test/image.png "说明")',
    '&lt;img src=x onerror=alert(1)&gt; &quot; &#39; &amp;',
  ])('round-trips %j through the DOM', (md) => {
    expectMarkdownText(renderMarkdown(md), md);
  });

  it('keeps line boundaries when different decorations share one document', () => {
    const md = '\n#  标题 👋  \n\t  \n>quote\n-\t[x]\t**item**\n1.  [链接](url)\n```html\n\n<div title="x">&amp;</div>\n```\n';
    const host = renderMarkdown(md);
    expectMarkdownText(host, md);
    expectMarkdownText(renderMarkdown(getMarkdown(host)), md);
  });

  it.each([
    ['#  heading\r\n-   item\r\n>quote\r\n', '#  heading\n-   item\n>quote\n'],
    ['\r\n\t  \r\n\r\n', '\n\t  \n\n'],
    ['```html\r\n\r\n<div>中文🙂</div>\r\n```', '```html\n\n<div>中文🙂</div>\n```'],
    ['first\rsecond\nthird\r\n', 'first\nsecond\nthird\n'],
  ])('normalizes CRLF and lone CR to LF: %j', (md, expected) => {
    const host = renderMarkdown(md);
    expectMarkdownText(host, expected);
    expectMarkdownText(renderMarkdown(getMarkdown(host)), expected);
  });
});

describe('renderDecorated XSS regressions', () => {
  it('codefence start line containing HTML is escaped (F-01)', () => {
    const md = '```<img src=x onerror="alert(1)">\nhello\n```';
    const html = expectSafeMarkdown(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.withEventAttrs).toHaveLength(0);
    expect(sinks.scriptTags).toHaveLength(0);
    expect(html).not.toContain('<img');
  });

  it('codefence end line containing HTML is escaped (F-01)', () => {
    const md = '```\nbody\n```<svg onload=alert(1)>';
    const html = expectSafeMarkdown(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<svg');
  });

  it('inline HTML in paragraphs is escaped', () => {
    const md = '<img src=x onerror=alert(1)>';
    const html = expectSafeMarkdown(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<img');
  });

  it('iframe srcdoc payload is escaped', () => {
    const md = '<iframe srcdoc="<img src=x onerror=alert(1)>"></iframe>';
    const html = expectSafeMarkdown(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<iframe');
  });

  it('details ontoggle payload inside a heading is escaped', () => {
    const md = '# <details open ontoggle=alert(1)>x</details>';
    const html = expectSafeMarkdown(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<details');
  });

  it('javascript: link URLs render as text only (no clickable href)', () => {
    const md = '[click](javascript:alert(1))';
    const html = expectSafeMarkdown(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.jsUrlElements).toHaveLength(0);
  });

  it('javascript: image URLs render as text only (no clickable src)', () => {
    const md = '![x](javascript:alert(1))';
    const html = expectSafeMarkdown(md);
    const sinks = findDangerousSinks(html);
    expect(sinks.jsUrlElements).toHaveLength(0);
  });

  it('quote line containing HTML is escaped', () => {
    const md = '> <img src=x onerror=alert(1)>';
    const html = expectSafeMarkdown(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
    expect(html).not.toContain('<img');
  });

  it('task list item with HTML is escaped', () => {
    const md = '- [ ] <img src=x onerror=alert(1)>';
    const html = expectSafeMarkdown(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
  });

  it('horizontal rule line with injected HTML cannot exist (--- is exact match)', () => {
    // Sanity: hr regex is anchored; a line like "---<img>" should not match hr branch.
    const md = '---<img src=x onerror=alert(1)>';
    const html = expectSafeMarkdown(md);
    expect(findDangerousSinks(html).withEventAttrs).toHaveLength(0);
  });

  it.each([
    '<script>alert("x")</script>',
    '```html\n<script>alert(1)</script>\n<img src="x" onerror=\'alert(2)\'>\n```',
    '```" onmouseover="alert(1)\n&copy; &#x3c;script&#x3e;\n```\' onclick=\'alert(2)',
    '**<img src="x" onerror=\'alert(1)\'>** _<svg onload="alert(2)">_ `"<&>`',
    '~~<iframe srcdoc="<script>alert(1)</script>"></iframe>~~ =="onerror"==',
    '[<img src=x onerror="alert(1)">](javascript:alert(2))',
    '!["\' <svg onload=alert(1)>](data:text/html,<script>alert(2)</script>)',
    '[link](https://example.test/?a=1&b=2 "title") ![image](https://example.test/x.png)',
    '&lt;script&gt;alert(1)&lt;/script&gt; &#34; &#39; &amp;quot;',
    '>\t<img src="x" onerror=\'alert(1)\'>',
    '-\t[x]\t<svg onload="alert(1)">',
  ])('keeps hostile and URL-bearing text inert: %j', (md) => {
    const sinks = findDangerousSinks(expectSafeMarkdown(md));
    expect(sinks.withEventAttrs).toHaveLength(0);
    expect(sinks.jsUrlElements).toHaveLength(0);
    expect(sinks.scriptTags).toHaveLength(0);
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

  it.each([
    ['#  heading', 'h1'],
    ['######\t heading', 'h6'],
    ['>quote', 'quote'],
    ['-   item', 'list'],
    ['1.  item', 'list'],
    ['42)\titem', 'list'],
    ['-\t[x]\titem', 'task'],
    ['+\t[X]\titem', 'done'],
    ['*\t[ ]\titem', 'task'],
  ])('retains decoration for %j', (md, cls) => {
    const host = renderMarkdown(md);
    expectMarkdownText(host, md);
    expect(host.firstElementChild!.classList.contains(cls)).toBe(true);
  });
});

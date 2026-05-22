/* Markdown decoration: turn raw markdown into per-line decorated HTML.
   Source-of-truth offsets match raw markdown 1:1 (syntax markers stay visible). */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function inlineHtml(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(
    /(!\[)([^\]]*)(\]\()([^)]+)(\))/g,
    '<span class="syn">$1</span><span class="md-link">$2</span><span class="syn">$3$4$5</span>'
  );
  s = s.replace(
    /(\[)([^\]]+)(\]\()([^)]+)(\))/g,
    '<span class="syn">$1</span><span class="md-link">$2</span><span class="syn">$3$4$5</span>'
  );
  s = s.replace(
    /(`)([^`]+)(`)/g,
    '<span class="syn">$1</span><span class="md-code">$2</span><span class="syn">$3</span>'
  );
  s = s.replace(
    /(\*\*)([^*\n]+)(\*\*)/g,
    '<span class="syn">$1</span><span class="md-bold">$2</span><span class="syn">$3</span>'
  );
  s = s.replace(
    /(__)([^_\n]+)(__)/g,
    '<span class="syn">$1</span><span class="md-bold">$2</span><span class="syn">$3</span>'
  );
  s = s.replace(
    /(?<![*\w])(\*)([^*\n]+)(\*)(?!\w)/g,
    '<span class="syn">$1</span><span class="md-em">$2</span><span class="syn">$3</span>'
  );
  s = s.replace(
    /(?<![_\w])(_)([^_\n]+)(_)(?!\w)/g,
    '<span class="syn">$1</span><span class="md-em">$2</span><span class="syn">$3</span>'
  );
  s = s.replace(
    /(~~)([^~\n]+)(~~)/g,
    '<span class="syn">$1</span><span class="md-strike">$2</span><span class="syn">$3</span>'
  );
  s = s.replace(
    /(==)([^=\n]+)(==)/g,
    '<span class="syn">$1</span><span class="md-mark">$2</span><span class="syn">$3</span>'
  );
  return s;
}

interface LineInfo {
  kind: string;
  cls: string;
  inline: string;
}

function classifyLine(line: string, inFence: number | null): LineInfo {
  if (inFence !== null) {
    if (/^```/.test(line))
      return { kind: 'codefence-end', cls: 'codefence', inline: escapeHtml(line) };
    return { kind: 'code', cls: 'code', inline: escapeHtml(line) || '​' };
  }
  if (/^```/.test(line))
    return { kind: 'codefence-start', cls: 'codefence', inline: escapeHtml(line) };
  if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
    return { kind: 'hr', cls: 'hr', inline: '<span class="syn">' + escapeHtml(line) + '</span>' };
  }
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
    const level = m[1].length;
    return {
      kind: 'h' + level,
      cls: 'h' + level,
      inline: '<span class="syn">' + m[1] + ' </span>' + inlineHtml(m[2]),
    };
  }
  if ((m = line.match(/^(\s*)(>+)\s?(.*)$/)) && !line.startsWith('> ![]')) {
    return {
      kind: 'quote',
      cls: 'quote',
      inline: '<span class="syn">' + escapeHtml(m[1] + m[2] + ' ') + '</span>' + inlineHtml(m[3]),
    };
  }
  if ((m = line.match(/^(\s*)([-*+])\s\[( |x|X)\]\s(.*)$/))) {
    const done = m[3] !== ' ';
    return {
      kind: 'task',
      cls: 'list task' + (done ? ' done' : ''),
      inline:
        '<span class="syn syn-bullet">' +
        escapeHtml(m[1] + m[2]) +
        ' </span>' +
        '<span class="syn-task">[' +
        m[3] +
        ']</span> ' +
        inlineHtml(m[4]),
    };
  }
  if ((m = line.match(/^(\s*)([-*+])\s+(.*)$/))) {
    return {
      kind: 'list',
      cls: 'list',
      inline:
        '<span class="syn syn-bullet">' +
        escapeHtml(m[1] + m[2] + ' ') +
        '</span>' +
        inlineHtml(m[3]),
    };
  }
  if ((m = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/))) {
    return {
      kind: 'olist',
      cls: 'list',
      inline:
        '<span class="syn syn-bullet">' +
        escapeHtml(m[1] + m[2] + m[3]) +
        ' </span>' +
        inlineHtml(m[4]),
    };
  }
  if (line.trim() === '') {
    return { kind: 'empty', cls: 'empty', inline: '​' };
  }
  return { kind: 'p', cls: 'p', inline: inlineHtml(line) };
}

export function renderDecorated(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inFence: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const info = classifyLine(line, inFence);
    let cls = info.cls;
    if (info.kind === 'codefence-start') {
      inFence = i;
      cls += ' code-first';
    } else if (info.kind === 'codefence-end') {
      inFence = null;
      cls += ' code-last';
    }
    html += `<div class="ln ${cls}" data-i="${i}">${info.inline}</div>`;
  }
  return html || '<div class="ln empty" data-i="0">​</div>';
}

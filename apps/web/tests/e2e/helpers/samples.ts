import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocState } from '@foil/editor/types';

/* Task 07 fixed typesetting sample: one document covering the whole content
   matrix (long Chinese prose, English brief, mixed CJK/Latin, consecutive and
   duplicate headings, nested lists, long URL, long code, GFM table, empty
   lines, emoji/combining characters) plus located, cross-block, overlapping
   and unlocated comment threads. Shared by the website, extension and
   standalone-HTML suites; screenshots land in the ignored test-results dir. */

export const SAMPLE_MD = [
  '# 排版样本 Typesetting Sample',
  '',
  '## 概述 Overview',
  '',
  '这是一个用于视觉回归检查的中文长段落。排版的核心是让读者在长时间阅读中保持舒适，',
  '标题与后文的归属要清晰，行高与字距要稳定，标点换行要符合中文习惯。',
  'The quick brown fox jumps over the lazy dog, while 中英混排 keeps both scripts',
  'on the same baseline with ==highlight==, **bold**, *italic*, ~~strike~~ and `inline code`.',
  '',
  '- **行动项 Action items**',
  '- 检查字体回退 fallback rendering',
  '  - 嵌套第二层 nested level two',
  '    - 嵌套第三层 nested level three',
  '  - [x] 已完成任务 completed task',
  '  - [ ] 未完成任务 pending task',
  '',
  '1. First ordered item',
  '2. Second ordered item',
  '42) Answer with a different delimiter',
  '',
  '### 连续标题 A',
  '### 连续标题 B',
  '',
  '## 简报 Brief',
  '',
  '- Ship date: 2026-09-30',
  '- Owner: 张三 zhangsan@example.com',
  '- Status: **on track** 进展正常',
  '',
  '> 引用段落：好的排版是隐形的。',
  '> Good typography is invisible.',
  '',
  '### 小节 Subsection',
  '',
  '段落跨行 cross-block',
  'comment target continues here.',
  '',
  '### 小节 Subsection',
  '',
  '重复标题得到确定且唯一的内部 ID。Duplicate headings get deterministic unique IDs.',
  '',
  '---',
  '',
  '## 数据 Data',
  '',
  '| 指标 Metric | 目标 Target | 实际 Actual | 说明 Notes |',
  '| --- | ---: | ---: | --- |',
  '| 首屏加载 LCP | < 2.5s | 2.1s | 达标 ✅ |',
  '| 累积位移 CLS | < 0.1 | 0.02 | 达标 |',
  '| 输入延迟 INP | < 200ms | 180ms | 接近上限 ⚠️ |',
  '',
  '## 代码与链接 Code & Links',
  '',
  '```ts',
  '// 中文注释 with a very long line that must wrap inside the code block instead of stretching the page: const result = await fetch("https://example.com/api/v1/documents/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { method: "POST" });',
  'const 变量 = 42;',
  'export default 变量;',
  '```',
  '',
  '长链接: https://example.com/very/long/path/segment/another-segment/final-segment?query=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&flag=1#fragment-aaaaaaaaaaaaaaaa',
  '',
  '详见 [文档链接](https://example.com/docs/typesetting-guide?utm_source=sample&utm_medium=e2e#section-1)。',
  '',
  '## 字符 Characters',
  '',
  'Emoji: 🌱🧭✅⚠️🔑 Family: 👨‍👩‍👧‍👦 Flags: 🇨🇳🇯🇵',
  'Combining: e\u0301 = é, a\u030a = å, surrogate pair 𝄞 and 中文.',
  '',
  '',
  '空行以上保留。Trailing paragraph after empty lines.',
].join('\n');

export const SAMPLE_COMMENTS: DocState['comments'] = [
  { id: 'located', quote: '排版的核心', before: '中文长段落。', after: '是让读者', replies: [
    { id: 'r1', author: '作者 Author', ts: 1, body: 'SAMPLE_LOCATED_BODY 定位评论' },
  ] },
  { id: 'cross-block', quote: 'cross-block\ncomment target continues here.', before: '段落跨行 ', after: '', replies: [
    { id: 'r2', author: 'Reader 二', ts: 2, body: 'SAMPLE_CROSSBLOCK_BODY 跨块评论' },
  ] },
  { id: 'overlap-a', quote: '好的排版是隐形的', before: '引用段落：', after: '。', replies: [
    { id: 'r3', author: 'Overlap A', ts: 3, body: 'SAMPLE_OVERLAP_A_BODY 外层评论' },
  ] },
  { id: 'overlap-b', quote: '排版是隐形', before: '好的', after: '。', replies: [
    { id: 'r4', author: 'Overlap B', ts: 4, body: 'SAMPLE_OVERLAP_B_BODY 内层评论' },
  ] },
  { id: 'unlocated', quote: 'This quote was removed from the sample', before: '', after: '', replies: [
    { id: 'r5', author: 'Unlocated reader', ts: 5, body: 'SAMPLE_UNLOCATED_BODY 未定位评论' },
  ] },
];

export const SAMPLE_DOC: DocState = {
  title: '排版样本 Typesetting Sample',
  md: SAMPLE_MD,
  comments: SAMPLE_COMMENTS,
};

/** Distinctive strings per section: the reading view must show all of them. */
export const SAMPLE_SENTINELS = [
  '视觉回归检查',
  '中英混排',
  '行动项 Action items',
  '嵌套第三层',
  'Answer with a different delimiter',
  '连续标题 B',
  'Ship date: 2026-09-30',
  'Good typography is invisible',
  'comment target continues here',
  'deterministic unique IDs',
  '首屏加载',
  '中文注释',
  '文档链接',
  '👨‍👩‍👧‍👦',
  'Combining',
  '空行以上保留。Trailing paragraph after empty lines.',
];

export const SAMPLE_REPLY_BODIES = SAMPLE_COMMENTS.flatMap((thread) => thread.replies.map((reply) => reply.body));

/** Screenshot baselines live under each app's ignored test-results directory.
 *  Pass the calling spec's `import.meta.url` (a file in `<app>/tests/e2e/`). */
export function visualBaselineDir(callerUrl: string) {
  const dir = fileURLToPath(new URL('../../test-results/visual-baseline/', callerUrl));
  mkdirSync(dir, { recursive: true });
  return dir;
}

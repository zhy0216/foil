import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StandaloneApp, type StandaloneAppProps } from './StandaloneApp';
import { decodeHtmlPayload, openTimeCapsule, type DecodeResult, type TimeCapsuleEnvelope } from '../lib/url-codec';
import { NoEndpointError, NotYetReadyError } from '../lib/timecapsule';
import { getMarkdown } from '../lib/editor-dom';
import type { DocState } from '../types';

vi.mock('../lib/url-codec', async load => ({
  ...await load<typeof import('../lib/url-codec')>(), decodeHtmlPayload: vi.fn(), openTimeCapsule: vi.fn(),
}));
vi.mock('../App', () => { throw new Error('Standalone imported App'); });
vi.mock('../components/Editor', () => { throw new Error('Standalone imported Editor'); });
vi.mock('../components/DocSwitcher', () => { throw new Error('Standalone imported DocSwitcher'); });
vi.mock('../components/Composer', () => { throw new Error('Standalone imported Composer'); });
vi.mock('../lib/doc-store', () => { throw new Error('Standalone imported document storage'); });
vi.mock('../lib/standalone-runtime-loader', () => { throw new Error('Standalone imported website resources'); });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const doc: DocState = {
  title: 'SECRET_TITLE_中文', md: 'SECRET_MD_🌱', comments: [{
    id: 'c1', quote: 'SECRET_MD', before: '', after: '', replies: [
      { id: 'r1', author: 'Author', ts: 1, body: 'SECRET_COMMENT_评论' },
    ],
  }],
};
const capsule: TimeCapsuleEnvelope = { v: 1, age: 'encrypted fixture', round: 1, unlockMs: 1 };
let root: Root | null;
let host: HTMLDivElement;
let block: HTMLScriptElement;
const decode = vi.mocked(decodeHtmlPayload);
const open = vi.mocked(openTimeCapsule);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('foil_doc_other', 'UNRELATED_LOCAL_DOCUMENT');
  sessionStorage.setItem('foil_current_id', 'other');
  window.history.replaceState(null, '', '/#d=OTHER_FRAGMENT');
  host = document.createElement('div'); document.body.append(host);
  block = document.createElement('script'); block.id = 'foil-share-data'; block.type = 'application/json';
  document.body.append(block);
  embed('d');
  decode.mockReset().mockResolvedValue({ state: doc });
  open.mockReset().mockResolvedValue(doc);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove(); block.remove();
  document.querySelectorAll('#foil-share-runtime, #foil-share-styles').forEach(el => el.remove());
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  document.documentElement.removeAttribute('style'); document.documentElement.removeAttribute('data-theme');
});
function embed(scheme: string) {
  block.textContent = JSON.stringify({ format: 'foil-share', version: 1,
    payload: '#' + scheme + '=' + 'A'.repeat(60), shareBaseUrl: 'https://example.test/foil/?private#fragment' });
}
async function mount(props: StandaloneAppProps = {}, strict = true) {
  await act(async () => root!.render(strict ? <StrictMode><StandaloneApp {...props} /></StrictMode> : <StandaloneApp {...props} />));
}
function button(label: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(el =>
    el.textContent?.trim() === label || el.getAttribute('aria-label') === label);
  if (!found) throw new Error('Missing button: ' + label);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function password(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
function hidden() {
  expect(host.querySelector('.editor, [contenteditable="true"]')).toBeNull();
  expect(host.textContent).not.toMatch(/SECRET_|UNRELATED_LOCAL_DOCUMENT/);
}
function preview() {
  expect(getMarkdown(host.querySelector('.preview')!)).toBe(doc.md);
  expect(host.querySelector('h1')?.textContent).toBe(doc.title);
  expect(host.textContent).toContain(doc.comments[0].replies[0].body);
  expect(host.querySelector('input, textarea, [contenteditable="true"], .composer, .doc-switcher')).toBeNull();
  expect(host.textContent).not.toMatch(/Edit anyway|Reply|Delete/);
  expect(localStorage.getItem('foil_doc_other')).toBe('UNRELATED_LOCAL_DOCUMENT');
  expect(Object.keys(localStorage).filter(k => k.startsWith('foil_doc_'))).toEqual(['foil_doc_other']);
  expect(sessionStorage.getItem('foil_current_id')).toBe('other');
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('standalone file lifecycle', () => {
  it.each(['d', 'e', 'td', 'te'])('gates #%s before rendering any document data', async scheme => {
    embed(scheme);
    decode.mockImplementation(async (_payload, pw) => {
      if ((scheme === 'e' || scheme === 'te') && !pw) return { encrypted: scheme === 'e' ? 'password' : 'time-password' };
      return scheme === 'td' || scheme === 'te' ? { timeCapsule: capsule } : { state: doc };
    });
    await mount();
    if (scheme === 'e' || scheme === 'te') {
      hidden(); expect(open).not.toHaveBeenCalled();
      expect(host.textContent).toContain('This document is encrypted');
      expect(host.textContent).not.toContain('Time capsule');
      await password('correct');
    }
    if (scheme === 'td' || scheme === 'te') {
      hidden(); expect(host.textContent).toContain('Time capsule');
      await click('Decrypt');
    }
    preview();
    for (const [payload] of decode.mock.calls) expect(payload).toBe('#' + scheme + '=' + 'A'.repeat(60));
  });

  it('keeps wrong passwords retryable and disables duplicate submissions while decrypting', async () => {
    embed('e');
    const pending = deferred<DecodeResult>();
    decode.mockImplementation(async (_p, pw) => !pw ? { encrypted: 'password' }
      : pw === 'wrong' ? { error: 'Incorrect password or damaged share link' } : pending.promise);
    await mount();
    await password('wrong'); hidden();
    expect(host.textContent).toContain('Incorrect password');
    await password('correct'); hidden();
    expect(button('Unlocking…').disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    const calls = decode.mock.calls.length;
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(decode).toHaveBeenCalledTimes(calls);
    await act(async () => pending.resolve({ state: doc })); preview();
  });

  it('discards StrictMode bootstrap results and reads only the captured embedded payload on retry', async () => {
    const pending: ReturnType<typeof deferred<DecodeResult>>[] = [];
    decode.mockImplementation(() => { const request = deferred<DecodeResult>(); pending.push(request); return request.promise; });
    await mount(); hidden();
    expect(pending).toHaveLength(2);
    await click('Cancel');
    block.textContent = JSON.stringify({ format: 'foil-share', version: 1, payload: '#d=e30' });
    await click('Retry'); hidden();
    expect(decode.mock.calls[2][0]).toBe('#d=' + 'A'.repeat(60));
    await act(async () => { pending[0].resolve({ state: { ...doc, md: 'STALE0' } }); pending[1].resolve({ state: { ...doc, md: 'STALE1' } }); });
    hidden();
    await act(async () => pending[2].resolve({ state: doc })); preview();
    expect(host.textContent).not.toMatch(/STALE|OTHER_FRAGMENT/);
  });

  it.each(['cancel', 'unmount'])('invalidates a password result after %s', async action => {
    embed('e');
    const pending = deferred<DecodeResult>();
    decode.mockImplementation(async (_p, pw) => pw ? pending.promise : { encrypted: 'password' });
    await mount(); await password('correct'); hidden();
    if (action === 'cancel') await click('Cancel');
    else act(() => { root!.unmount(); root = null; });
    await act(async () => pending.resolve({ state: doc }));
    hidden();
    if (action === 'cancel') { expect(host.textContent).toContain('Reading cancelled'); await click('Retry'); hidden(); }
  });

  it.each(['cancel', 'unmount'])('invalidates a tlock result after %s and starts no further retries', async action => {
    embed('td'); decode.mockResolvedValue({ timeCapsule: capsule });
    const pending = deferred<DocState>(); open.mockReturnValue(pending.promise);
    await mount(); await click('Decrypt'); hidden();
    if (action === 'cancel') await click('Cancel');
    else act(() => { root!.unmount(); root = null; });
    await act(async () => pending.resolve(doc));
    await act(async () => vi.advanceTimersByTime(30_000));
    hidden(); expect(open).toHaveBeenCalledOnce();
  });

  it('clears a drand retry timer on cancellation and can reopen the same file', async () => {
    embed('td'); decode.mockResolvedValue({ timeCapsule: capsule });
    open.mockRejectedValueOnce(new NotYetReadyError(1));
    await mount(); await click('Decrypt'); await click('Cancel');
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(open).toHaveBeenCalledOnce(); hidden();
    await click('Retry'); await click('Decrypt'); preview();
  });

  it('keeps a future capsule sealed and permits retry after a network failure', async () => {
    embed('td'); decode.mockResolvedValue({ timeCapsule: { ...capsule, unlockMs: Date.now() + 5000 } });
    open.mockRejectedValueOnce(new NoEndpointError());
    await mount(); hidden(); expect(open).not.toHaveBeenCalled();
    expect(Array.from(host.querySelectorAll('button')).some(el => el.textContent === 'Decrypt')).toBe(false);
    await act(async () => vi.advanceTimersByTime(5000));
    await click('Decrypt'); hidden(); expect(host.textContent).toContain('Could not reach drand');
    await click('Retry'); preview();
  });

  it('hides arbitrary rejected errors and never falls back to a local document', async () => {
    decode.mockRejectedValue(new Error('SECRET_PAYLOAD_PASSWORD'));
    await mount(); hidden(); expect(host.textContent).toContain('Could not read this shared file');
    await click('Retry'); hidden();
    expect(host.textContent).not.toContain('SECRET_PAYLOAD_PASSWORD');
  });

  it.each(['malformed', 'version', 'missing'])('fails clearly for %s data without decoding another source', async kind => {
    if (kind === 'missing') block.remove();
    else block.textContent = kind === 'malformed' ? '{"SECRET":' : '{"format":"foil-share","version":9,"payload":"#d=e30"}';
    await mount(); hidden();
    expect(host.textContent).toContain(kind === 'version' ? 'Unsupported HTML share version' : kind === 'missing' ? 'missing' : 'Invalid HTML share data');
    expect(decode).not.toHaveBeenCalled();
  });

  it.each(['crypto', 'gzip', 'gzip-format'])('reports unavailable %s before decoding', async feature => {
    if (feature === 'crypto') vi.stubGlobal('crypto', undefined);
    else if (feature === 'gzip') vi.stubGlobal('DecompressionStream', undefined);
    else vi.stubGlobal('DecompressionStream', class { constructor() { throw new Error('SECRET_ERROR'); } });
    await mount(); hidden();
    expect(host.textContent).toContain(feature === 'crypto' ? 'Web Crypto' : 'gzip');
    expect(decode).not.toHaveBeenCalled();
  });

  it('keeps reading/settings/help functional when storage access is denied', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    await mount();
    expect(getMarkdown(host.querySelector('.preview')!)).toBe(doc.md);
    await click('Settings'); await click('Large'); await click('Dark'); await click('Violet');
    expect(host.querySelector<HTMLElement>('.editor-wrap')!.style.getPropertyValue('--prose-size')).toBe('21px');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#6f3ad9');
    expect(write.mock.calls.every(([key]) => key === 'foil_settings')).toBe(true);
    await click('Done'); await click('About Foil');
    expect(host.querySelector('.modal h3')!.textContent).toBe('About Foil');
    await click('Done');
    expect(host.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('exposes sharing only after unlocking with the normalized source and its own resources', async () => {
    const onShare = vi.fn();
    const script = document.createElement('script'); script.id = 'foil-share-runtime'; script.textContent = 'void 0;'; document.body.append(script);
    const style = document.createElement('style'); style.id = 'foil-share-styles'; style.textContent = 'body{}'; document.head.append(style);
    embed('e'); decode.mockImplementation(async (_p, pw) => pw ? { state: doc } : { encrypted: 'password' });
    await mount({ onShare }); hidden(); expect(onShare).not.toHaveBeenCalled();
    await password('correct'); await click('Share');
    expect(onShare).toHaveBeenCalledOnce();
    const context = onShare.mock.calls[0][0];
    expect(context.doc).toEqual(doc);
    expect(context.shareBaseUrl).toBe('https://example.test/foil/');
    expect(await context.loadRuntime()).toEqual({ script: 'void 0;', styles: 'body{}' });
  });
});

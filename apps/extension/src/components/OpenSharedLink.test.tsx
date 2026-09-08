// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpenSharedLink } from './OpenSharedLink';
import { IMPORT_SHARE_LINK_MAX_CHARS } from '../lib/import-share-link';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const create = vi.fn().mockResolvedValue({ id: 2 });
const getURL = vi.fn((path: string) => `chrome-extension://installed-foil/${path}`);
let root: Root;
let container: HTMLDivElement;
let storage: ReturnType<typeof vi.spyOn>[];

beforeEach(async () => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 2 });
  getURL.mockImplementation(path => `chrome-extension://installed-foil/${path}`);
  vi.stubGlobal('chrome', { tabs: { create }, runtime: { getURL } });
  // jsdom lacks native dialog lifecycle. Model only opening/closing here;
  // actual inertness, Tab trapping and Escape are checked in installed Chromium.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
  localStorage.setItem('foil_doc_source', 'SOURCE_DRAFT');
  sessionStorage.setItem('foil_current_id', 'source');
  storage = ['getItem', 'setItem', 'removeItem', 'clear'].map(method => vi.spyOn(Storage.prototype, method as 'getItem'));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<StrictMode><OpenSharedLink /></StrictMode>));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const operation of storage) expect(operation).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(localStorage.getItem('foil_doc_source')).toBe('SOURCE_DRAFT');
  expect(sessionStorage.getItem('foil_current_id')).toBe('source');
  localStorage.clear();
  sessionStorage.clear();
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});

function button(name: string) {
  return [...container.querySelectorAll('button')].find(el => el.textContent?.trim() === name)!;
}
function field() { return container.querySelector('textarea')!; }
function dialog() { return container.querySelector('dialog')!; }
async function open() {
  const trigger = button('Open shared link');
  trigger.focus();
  await act(async () => trigger.click());
  expect(dialog().open).toBe(true);
  expect(document.activeElement).toBe(field());
}
async function fill(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

it('opens an explicitly labelled dialog and focuses the paste field without reading anything', async () => {
  expect(container.querySelector('dialog')).toBeNull();
  expect(create).not.toHaveBeenCalled();
  await open();
  expect(button('Open shared link').getAttribute('aria-haspopup')).toBe('dialog');
  expect(document.getElementById(dialog().getAttribute('aria-labelledby')!)?.textContent).toBe('Open shared link');
  expect(field().labels?.[0].textContent).toBe('Foil share link or fragment');
  expect(document.getElementById(field().getAttribute('aria-describedby')!)?.textContent).toContain('#te=');
  expect(create).not.toHaveBeenCalled();
});

it.each(['d', 'e', 'td', 'te'])('submits #%s= only to the fixed packaged page in a new tab and closes', async scheme => {
  await open();
  const fragment = `#${scheme}=${'A'.repeat(60)}AA==`;
  await fill(`  https://supplied.test/path?secret=PRIVATE_QUERY${fragment}\n`);
  await submit();
  expect(getURL).toHaveBeenCalledExactlyOnceWith('index.html');
  expect(create).toHaveBeenCalledExactlyOnceWith({ url: `chrome-extension://installed-foil/index.html${fragment}` });
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(button('Open shared link'));
});

it.each(['', '#d=PRIVATE_DOCUMENT%', 'javascript:PRIVATE_PASSWORD#d=AAAA',
  '#d=' + 'A'.repeat(IMPORT_SHARE_LINK_MAX_CHARS)])('keeps invalid input available with associated error and no navigation (case %#)', async input => {
  await open();
  await fill(input);
  await submit();
  const error = container.querySelector('[role="alert"]')!;
  expect(error.textContent).not.toMatch(/PRIVATE_PASSWORD|PRIVATE_DOCUMENT/);
  expect(field().getAttribute('aria-invalid')).toBe('true');
  expect(field().getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
  expect(field().value).toBe(input);
  expect(document.activeElement).toBe(field());
  expect(create).not.toHaveBeenCalled();
  expect(getURL).not.toHaveBeenCalled();
  await fill('#d=AAAA');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await submit();
  expect(create).toHaveBeenCalledOnce();
});

it.each(['button', 'escape'])('cancels by %s with no navigation, clears the paste on reopening and restores focus', async method => {
  await open();
  await fill('https://supplied.test/#d=AAAA');
  await act(async () => {
    if (method === 'button') button('Cancel').click();
    else dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(button('Open shared link'));
  expect(create).not.toHaveBeenCalled();
  expect(getURL).not.toHaveBeenCalled();
  await open();
  expect(field().value).toBe('');
});

it.each(['rejection', 'create throw', 'URL throw'])('reports API %s without private details and permits retry', async failure => {
  await open();
  await fill('#d=AAAA');
  const privateError = new Error('PRIVATE_PAYLOAD_OR_PASSWORD');
  if (failure === 'rejection') create.mockRejectedValueOnce(privateError);
  if (failure === 'create throw') create.mockImplementationOnce(() => { throw privateError; });
  if (failure === 'URL throw') getURL.mockImplementationOnce(() => { throw privateError; });
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Could not open a new tab. Your link is still here; try again.');
  expect(field().value).toBe('#d=AAAA');
  expect(document.activeElement).toBe(field());
  expect(button('Open in new tab').disabled).toBe(false);
  await submit();
  expect(create).toHaveBeenLastCalledWith({ url: 'chrome-extension://installed-foil/index.html#d=AAAA' });
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(button('Open shared link'));
});

it('prevents duplicate submissions and dismissal while tab creation is pending', async () => {
  let reject!: (reason: Error) => void;
  create.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  await open();
  await fill('#d=AAAA');
  await act(async () => {
    const form = container.querySelector('form')!;
    for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(create).toHaveBeenCalledOnce();
  expect(button('Opening…').disabled).toBe(true);
  expect(button('Cancel').disabled).toBe(true);
  expect(field().readOnly).toBe(true);
  const escape = new Event('cancel', { cancelable: true });
  await act(async () => dialog().dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(dialog().open).toBe(true);
  await act(async () => reject(new Error('API failure')));
  expect(button('Cancel').disabled).toBe(false);
  await submit();
  expect(create).toHaveBeenCalledTimes(2);
  expect(container.querySelector('dialog')).toBeNull();
});

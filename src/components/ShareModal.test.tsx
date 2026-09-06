import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareModal } from './ShareModal';
import { encodeUrl } from '../lib/url-codec';
import type { DocState } from '../types';

vi.mock('../lib/url-codec', async (load) => ({
  ...(await load<typeof import('../lib/url-codec')>()),
  encodeUrl: vi.fn(),
}));

const state: DocState = { md: '# hello', comments: [], title: 'Test' };
let root: Root;
let host: HTMLDivElement;
let close: ReturnType<typeof vi.fn<() => void>>;
let toast: ReturnType<typeof vi.fn<(msg: string) => void>>;
let clipboardWrite: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

function render(getState = () => state) {
  act(() => {
    root.render(
      <ShareModal
        open
        onClose={close}
        getState={getState}
        onToast={toast}
        onLearnMore={vi.fn()}
      />
    );
  });
}

async function settleGeneration() {
  await act(async () => {
    vi.advanceTimersByTime(250);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(encodeUrl).mockReset().mockResolvedValue('#d=plain');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  close = vi.fn<() => void>();
  toast = vi.fn<(msg: string) => void>();
  clipboardWrite = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('ShareModal generation boundaries', () => {
  it('discards a prior plain URL immediately when a protected generation fails', async () => {
    render();
    await settleGeneration();
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toContain('#d=plain');

    vi.mocked(encodeUrl).mockRejectedValueOnce(new Error('Share data exceeds the 4 MiB limit'));
    const toggles = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => toggles[0].click());
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toBe('Enter a password…');
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'secret');
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settleGeneration();

    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toBe('');
    expect(host.querySelector<HTMLButtonElement>('.btn-primary')?.disabled).toBe(true);
    expect(toast).toHaveBeenCalledWith("Couldn't build link: Share data exceeds the 4 MiB limit");
  });

  it('ignores a late result from an older request', async () => {
    let resolveFirst!: (value: string) => void;
    vi.mocked(encodeUrl).mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    render();
    await act(async () => vi.advanceTimersByTime(250));
    expect(vi.mocked(encodeUrl)).toHaveBeenCalledTimes(1);

    const toggles = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => toggles[0].click());
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'new secret');
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settleGeneration();
    resolveFirst('#d=stale');
    await act(async () => Promise.resolve());
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).not.toContain('stale');
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it('debounces password typing to one final generation', async () => {
    render();
    await settleGeneration();
    const initialCalls = vi.mocked(encodeUrl).mock.calls.length;
    const toggle = host.querySelector<HTMLElement>('[role="switch"]')!;
    act(() => toggle.click());
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    for (const value of ['s', 'se', 'sec', 'secret']) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, value);
        password.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(100);
      });
    }
    expect(vi.mocked(encodeUrl).mock.calls.length).toBe(initialCalls);
    await settleGeneration();
    expect(vi.mocked(encodeUrl).mock.calls.length).toBe(initialCalls + 1);
    expect(vi.mocked(encodeUrl).mock.calls.at(-1)?.[1]).toEqual({ password: 'secret' });
  });

  it('hides and disables a capsule link after its safety window expires', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.mocked(encodeUrl).mockResolvedValue('#td=capsule');
    render();
    const switches = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => switches[1].click());
    await settleGeneration();
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toContain('#td=capsule');

    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(host.querySelector<HTMLInputElement>('.url-row input')?.value).toBe('Pick an unlock time…');
    expect(host.querySelector<HTMLButtonElement>('.url-row button')?.disabled).toBe(true);
    expect(host.querySelector('.tc-readout')).toBeNull();
  });

  it('copies the successful scheme and toast from the captured result', async () => {
    vi.mocked(encodeUrl).mockResolvedValue('#te=sealed');
    render();
    const switches = host.querySelectorAll<HTMLElement>('[role="switch"]');
    act(() => switches[0].click());
    const password = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(password, 'secret');
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => switches[1].click());
    await settleGeneration();
    const copy = host.querySelector<HTMLButtonElement>('.url-row button')!;
    expect(copy.disabled).toBe(false);
    act(() => copy.click());
    await act(async () => Promise.resolve());
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining('#te=sealed'));
    expect(toast).toHaveBeenCalledWith('Encrypted time capsule copied');
    expect(close).toHaveBeenCalled();
  });
});

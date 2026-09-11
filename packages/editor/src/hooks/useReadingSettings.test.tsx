import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReadingSettings } from './useReadingSettings';
import { DEFAULT_SETTINGS, PROSE_FONT_MAP } from '../lib/settings-config';
import type { Settings } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let light: boolean;
let mediaListeners: Map<string, Set<() => void>>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  light = false;
  mediaListeners = new Map();
  vi.stubGlobal('matchMedia', (query: string) => {
    const listeners = mediaListeners.get(query) ?? new Set();
    mediaListeners.set(query, listeners);
    return {
      get matches() { return light; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
  });
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.readingStyle;
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Host({ settings, enabled }: { settings: Settings; enabled?: boolean }) {
  const { editorWrapStyle, canvasStyle } = useReadingSettings(settings, enabled);
  return (
    <div className="canvas" style={canvasStyle}>
      <div className="editor-wrap" style={editorWrapStyle} />
    </div>
  );
}
function render(next: Partial<Settings>, enabled?: boolean) {
  const settings = { ...DEFAULT_SETTINGS, ...next };
  act(() => root.render(<Host settings={settings} enabled={enabled} />));
  return host.querySelector<HTMLElement>('.editor-wrap')!.style;
}
const rootStyle = () => document.documentElement.style;

describe('useReadingSettings', () => {
  it('publishes the resolved theme and the reading style on the document element', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const readingStyle of ['standard', 'paper'] as const) {
        render({ theme, readingStyle });
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(document.documentElement.dataset.readingStyle).toBe(readingStyle);
      }
    }
    render({ theme: 'auto', readingStyle: 'paper' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    light = true;
    act(() => mediaListeners.get('(prefers-color-scheme: light)')!.forEach((listener) => listener()));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.readingStyle).toBe('paper');
  });

  it('keeps the accent but darkens its links on light surfaces', () => {
    render({ accent: 'emerald', theme: 'dark' });
    expect(rootStyle().getPropertyValue('--accent')).toBe('#0a9b5e');
    expect(rootStyle().getPropertyValue('--link')).toBe('#34c489');
    render({ accent: 'emerald', theme: 'light' });
    expect(rootStyle().getPropertyValue('--accent')).toBe('#0a9b5e');
    expect(rootStyle().getPropertyValue('--link')).toBe('#0a7a49');
    expect(rootStyle().getPropertyValue('--link-hover')).toBe('#07603a');
    // The default accent owns no overrides, so the theme tokens show through.
    render({ accent: 'cerulean', theme: 'light' });
    expect(rootStyle().getPropertyValue('--accent')).toBe('');
    expect(rootStyle().getPropertyValue('--link')).toBe('');
  });

  it('gives headings the chosen document face and paints no document colors inline', () => {
    const style = render({ proseFont: 'cjk-serif', proseSize: 'large', density: 'compact' });
    expect(style.getPropertyValue('--prose-font')).toBe(PROSE_FONT_MAP['cjk-serif']);
    expect(style.getPropertyValue('--prose-heading-font')).toBe(PROSE_FONT_MAP['cjk-serif']);
    expect(style.getPropertyValue('--prose-size')).toBe('21px');
    expect(style.getPropertyValue('--prose-leading')).toBe('1.55');
    // Paper colors live in the stylesheet, so a host cannot leak them inline.
    expect(style.getPropertyValue('--doc-bg')).toBe('');
    expect(rootStyle().getPropertyValue('--doc-fg')).toBe('');
    expect(host.querySelector<HTMLElement>('.canvas')!.style.getPropertyValue('--editor-width')).toBe('820px');
  });

  it('leaves the document element untouched when disabled', () => {
    render({ theme: 'light', readingStyle: 'paper', accent: 'violet' }, false);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.readingStyle).toBeUndefined();
    expect(rootStyle().getPropertyValue('--accent')).toBe('');
  });
});

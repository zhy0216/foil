import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';
import { DEFAULT_SETTINGS, PROSE_FONTS } from '../lib/settings-config';
import type { Settings } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let changed: Settings[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  changed = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Host({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  return (
    <SettingsModal
      open
      onClose={vi.fn()}
      settings={settings}
      onChange={(next) => { changed.push(next); setSettings(next); }}
      onReset={() => setSettings({ ...DEFAULT_SETTINGS })}
    />
  );
}
function render(initial: Settings = DEFAULT_SETTINGS) {
  act(() => root.render(<Host initial={initial} />));
}
function card(label: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('.font-card'))
    .find((button) => button.querySelector('.font-card-label span')?.textContent === label);
  if (!found) throw new Error('Font card not found: ' + label);
  return found;
}
function radio(label: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    .find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error('Radio not found: ' + label);
  return found;
}
function click(label: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error('Button not found: ' + label);
  act(() => found.click());
}

describe('SettingsModal appearance controls', () => {
  it('samples every prose font in Chinese and Latin with its own stack', () => {
    render();
    const cards = host.querySelectorAll('.font-card');
    expect(cards.length).toBe(PROSE_FONTS.length);
    for (const font of PROSE_FONTS) {
      const preview = card(font.label).querySelector<HTMLElement>('.font-card-preview')!;
      expect(preview.textContent).toBe('中文 Aa 123');
      expect(preview.style.fontFamily).toBe(font.stack);
    }
    expect(card('CJK Serif').querySelector('.font-card-hint')?.textContent).toContain('Songti');
  });

  it('changes only the prose font and marks the chosen card', () => {
    render({ ...DEFAULT_SETTINGS, proseFont: 'mono', readingStyle: 'paper' });
    expect(card('Mono').classList.contains('on')).toBe(true);
    act(() => card('CJK Serif').click());
    expect(changed.at(-1)).toEqual({ ...DEFAULT_SETTINGS, proseFont: 'cjk-serif', readingStyle: 'paper' });
    expect(card('CJK Serif').classList.contains('on')).toBe(true);
    expect(card('Mono').classList.contains('on')).toBe(false);
  });

  it('switches the reading style without touching other preferences and resets to standard', () => {
    render({ ...DEFAULT_SETTINGS, proseFont: 'mono', accent: 'ember' });
    expect(radio('Standard').getAttribute('aria-checked')).toBe('true');
    expect(radio('Standard').closest('[role="radiogroup"]')).not.toBeNull();
    click('Paper');
    expect(changed.at(-1)).toEqual({ ...DEFAULT_SETTINGS, proseFont: 'mono', accent: 'ember', readingStyle: 'paper' });
    expect(radio('Paper').getAttribute('aria-checked')).toBe('true');
    expect(radio('Standard').getAttribute('aria-checked')).toBe('false');
    click('Reset to defaults');
    expect(radio('Standard').getAttribute('aria-checked')).toBe('true');
  });
});

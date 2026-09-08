import { useEffect, type CSSProperties } from 'react';
import { ACCENT_MAP, EDITOR_WIDTHS, PROSE_FONT_MAP, PROSE_SIZES } from '../lib/settings-config';
import type { Settings } from '../types';

/** Applies presentation only. The host owns preferences and any persistence. */
export function useReadingSettings(settings: Settings, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const apply = () => document.documentElement.setAttribute('data-theme',
      settings.theme === 'auto' ? (mq.matches ? 'light' : 'dark') : settings.theme);
    apply();
    if (settings.theme === 'auto') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [settings.theme, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    for (const key of ['--accent', '--accent-hover', '--accent-hi', '--accent-lo', '--link', '--link-hover']) {
      root.style.removeProperty(key);
    }
    for (const [key, value] of Object.entries(ACCENT_MAP[settings.accent]?.overrides ?? {})) {
      root.style.setProperty(key, value);
    }
  }, [settings.accent, enabled]);

  const editorWrapStyle: CSSProperties & Record<string, string> = {
    '--prose-font': PROSE_FONT_MAP[settings.proseFont] || PROSE_FONT_MAP.serif,
    '--prose-size': (PROSE_SIZES[settings.proseSize] || PROSE_SIZES.default) + 'px',
    '--prose-leading': settings.density === 'compact' ? '1.55' : '1.7',
  };
  const canvasStyle: CSSProperties & Record<string, string> = {
    '--editor-width': EDITOR_WIDTHS[settings.editorWidth] || EDITOR_WIDTHS.default,
  };
  return { editorWrapStyle, canvasStyle };
}

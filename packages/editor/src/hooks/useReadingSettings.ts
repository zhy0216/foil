import { useEffect, type CSSProperties } from 'react';
import { accentVars, EDITOR_WIDTHS, PROSE_FONT_MAP, PROSE_SIZES } from '../lib/settings-config';
import type { Settings } from '../types';

const ACCENT_KEYS = ['--accent', '--accent-hover', '--accent-hi', '--accent-lo', '--link', '--link-hover'];

/** Applies presentation only. The host owns preferences and any persistence. */
export function useReadingSettings(settings: Settings, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: light)');
    // Link colors depend on the resolved theme, so one pass paints theme,
    // reading style and accent together.
    const apply = () => {
      const theme = settings.theme === 'auto' ? (mq.matches ? 'light' : 'dark') : settings.theme;
      root.setAttribute('data-theme', theme);
      root.setAttribute('data-reading-style', settings.readingStyle);
      for (const key of ACCENT_KEYS) root.style.removeProperty(key);
      for (const [key, value] of Object.entries(accentVars(settings.accent, theme))) {
        root.style.setProperty(key, value);
      }
    };
    apply();
    if (settings.theme === 'auto') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [settings.theme, settings.accent, settings.readingStyle, enabled]);

  const proseFont = PROSE_FONT_MAP[settings.proseFont] || PROSE_FONT_MAP.serif;
  const editorWrapStyle: CSSProperties & Record<string, string> = {
    '--prose-font': proseFont,
    // Document headings follow the chosen prose face; UI chrome keeps its own.
    '--prose-heading-font': proseFont,
    '--prose-size': (PROSE_SIZES[settings.proseSize] || PROSE_SIZES.default) + 'px',
    '--prose-leading': settings.density === 'compact' ? '1.55' : '1.7',
  };
  const canvasStyle: CSSProperties & Record<string, string> = {
    '--editor-width': EDITOR_WIDTHS[settings.editorWidth] || EDITOR_WIDTHS.default,
  };
  return { editorWrapStyle, canvasStyle };
}

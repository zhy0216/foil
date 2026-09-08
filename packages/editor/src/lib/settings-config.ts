import type {
  Accent,
  EditorWidth,
  ProseFont,
  ProseSize,
  Settings,
  Theme,
} from '../types';

interface ProseFontDef {
  value: ProseFont;
  label: string;
  hint: string;
  stack: string;
}

interface AccentDef {
  value: Accent;
  label: string;
  swatch: string;
  overrides: Record<string, string> | null;
}

export const PROSE_FONTS: ReadonlyArray<ProseFontDef> = [
  {
    value: 'serif',
    label: 'Serif',
    hint: 'Charter / Iowan',
    stack:
      'ui-serif, Charter, "Source Serif Pro", "Iowan Old Style", Baskerville, Georgia, serif',
  },
  {
    value: 'modern-serif',
    label: 'Modern',
    hint: 'New York / Times',
    stack: '"New York", "Times New Roman", Times, serif',
  },
  {
    value: 'sans',
    label: 'Sans',
    hint: 'System UI',
    stack: 'ui-sans-serif, system-ui, sans-serif',
  },
  {
    value: 'humanist',
    label: 'Humanist',
    hint: 'Optima / Candara',
    stack: 'Optima, Candara, "Trebuchet MS", "Lucida Sans", sans-serif',
  },
  {
    value: 'mono',
    label: 'Mono',
    hint: 'Plain code',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
];

export const PROSE_FONT_MAP: Record<ProseFont, string> = Object.fromEntries(
  PROSE_FONTS.map((f) => [f.value, f.stack])
) as Record<ProseFont, string>;

export const ACCENTS: ReadonlyArray<AccentDef> = [
  { value: 'cerulean', label: 'Cerulean', swatch: '#0278ff', overrides: null },
  {
    value: 'emerald',
    label: 'Emerald',
    swatch: '#0a9b5e',
    overrides: {
      '--accent': '#0a9b5e',
      '--accent-hover': '#10b070',
      '--accent-hi': '#7fdaae',
      '--accent-lo': '#053823',
      '--link': '#34c489',
      '--link-hover': '#5cd8a4',
    },
  },
  {
    value: 'ember',
    label: 'Ember',
    swatch: '#d94d1c',
    overrides: {
      '--accent': '#d94d1c',
      '--accent-hover': '#e76233',
      '--accent-hi': '#f6b89a',
      '--accent-lo': '#3a1407',
      '--link': '#ee7846',
      '--link-hover': '#f49165',
    },
  },
  {
    value: 'violet',
    label: 'Violet',
    swatch: '#6f3ad9',
    overrides: {
      '--accent': '#6f3ad9',
      '--accent-hover': '#7e4ce6',
      '--accent-hi': '#c9b3f0',
      '--accent-lo': '#1c0c44',
      '--link': '#9d72ed',
      '--link-hover': '#b294f1',
    },
  },
  {
    value: 'graphite',
    label: 'Graphite',
    swatch: '#71717a',
    overrides: {
      '--accent': '#52525b',
      '--accent-hover': '#71717a',
      '--accent-hi': '#d4d4d8',
      '--accent-lo': '#1c1c20',
      '--link': '#a1a1aa',
      '--link-hover': '#d4d4d8',
    },
  },
];

export const ACCENT_MAP: Record<Accent, AccentDef> = Object.fromEntries(
  ACCENTS.map((a) => [a.value, a])
) as Record<Accent, AccentDef>;

export const EDITOR_WIDTHS: Record<EditorWidth, string> = {
  narrow: '620px',
  default: '820px',
  wide: '960px',
};

export const PROSE_SIZES: Record<ProseSize, number> = {
  small: 17,
  default: 19,
  large: 21,
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  proseFont: 'serif',
  proseSize: 'default',
  accent: 'cerulean',
  editorWidth: 'default',
  density: 'comfortable',
};

const THEMES: ReadonlySet<Theme> = new Set(['auto', 'light', 'dark']);
const PROSE_SIZE_VALUES: ReadonlySet<ProseSize> = new Set(['small', 'default', 'large']);
const DENSITIES: ReadonlySet<Settings['density']> = new Set(['comfortable', 'compact']);
const EDITOR_WIDTH_VALUES: ReadonlySet<EditorWidth> = new Set(['narrow', 'default', 'wide']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEMES.has(value as Theme);
}

export function isProseFont(value: unknown): value is ProseFont {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROSE_FONT_MAP, value);
}

export function isProseSize(value: unknown): value is ProseSize {
  return typeof value === 'string' && PROSE_SIZE_VALUES.has(value as ProseSize);
}

export function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACCENT_MAP, value);
}

export function isEditorWidth(value: unknown): value is EditorWidth {
  return typeof value === 'string' && EDITOR_WIDTH_VALUES.has(value as EditorWidth);
}

export function isDensity(value: unknown): value is Settings['density'] {
  return typeof value === 'string' && DENSITIES.has(value as Settings['density']);
}

/**
 * Parse persisted settings without trusting arbitrary object fields. Unknown
 * or invalid values fall back independently, so one bad preference does not
 * discard otherwise valid preferences. Legacy `foil_theme` is handled by the
 * caller when no structured settings record exists.
 */
export function parseSettings(value: unknown): Settings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  return {
    theme: isTheme(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    proseFont: isProseFont(value.proseFont) ? value.proseFont : DEFAULT_SETTINGS.proseFont,
    proseSize: isProseSize(value.proseSize) ? value.proseSize : DEFAULT_SETTINGS.proseSize,
    accent: isAccent(value.accent) ? value.accent : DEFAULT_SETTINGS.accent,
    editorWidth: isEditorWidth(value.editorWidth) ? value.editorWidth : DEFAULT_SETTINGS.editorWidth,
    density: isDensity(value.density) ? value.density : DEFAULT_SETTINGS.density,
  };
}

export function isSettings(value: unknown): value is Settings {
  if (!isRecord(value)) return false;
  return (
    isTheme(value.theme) &&
    isProseFont(value.proseFont) &&
    isProseSize(value.proseSize) &&
    isAccent(value.accent) &&
    isEditorWidth(value.editorWidth) &&
    isDensity(value.density)
  );
}

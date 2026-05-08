import type {
  Accent,
  EditorWidth,
  ProseFont,
  ProseSize,
  Settings,
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

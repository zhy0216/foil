import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  PROSE_FONTS,
  PROSE_FONT_MAP,
  accentVars,
  isReadingStyle,
  isSettings,
  isTheme,
  parseSettings,
} from './settings-config';

describe('persisted settings validation', () => {
  it('accepts only known enum values and falls back per field', () => {
    expect(parseSettings({
      theme: 'dark',
      proseFont: 'unknown',
      proseSize: 'large',
      accent: 'violet',
      editorWidth: 'wide',
      density: 'compact',
      unexpected: 'ignored',
    })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      proseSize: 'large',
      accent: 'violet',
      editorWidth: 'wide',
      density: 'compact',
    });
  });

  it('rejects malformed complete settings while parsing partial legacy records safely', () => {
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
    expect(isSettings({ ...DEFAULT_SETTINGS, theme: 'sepia' })).toBe(false);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ theme: 'light' }).theme).toBe('light');
    expect(isTheme('light')).toBe(true);
    expect(isTheme('sepia')).toBe(false);
  });

  it('reads a record written before readingStyle existed as standard, keeping every other preference', () => {
    const legacy = {
      theme: 'dark',
      proseFont: 'mono',
      proseSize: 'small',
      accent: 'ember',
      editorWidth: 'narrow',
      density: 'compact',
    };
    expect(parseSettings(legacy)).toEqual({ ...legacy, readingStyle: 'standard' });
    expect(isSettings(legacy)).toBe(false);
    expect(isReadingStyle('paper')).toBe(true);
  });

  it('falls back only the reading style when it is invalid', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, readingStyle: 'papyrus' })).toEqual({
      ...DEFAULT_SETTINGS,
      readingStyle: 'standard',
    });
    expect(isSettings({ ...DEFAULT_SETTINGS, readingStyle: 'papyrus' })).toBe(false);
    expect(DEFAULT_SETTINGS.readingStyle).toBe('standard');
  });
});

describe('prose font stacks', () => {
  it('keeps every previous option and adds cjk-serif', () => {
    const values = PROSE_FONTS.map((font) => font.value).sort();
    expect(values).toEqual(['cjk-serif', 'humanist', 'modern-serif', 'mono', 'sans', 'serif']);
    expect(Object.keys(PROSE_FONT_MAP).sort()).toEqual(values);
  });

  it('is a plain system stack: no downloads, no external references', () => {
    for (const stack of Object.values(PROSE_FONT_MAP)) {
      expect(stack).not.toMatch(/url\(|https?:|@font-face|local\(/i);
      expect(stack.trim()).not.toBe('');
    }
  });

  it('gives the Latin-first options a local Chinese serif or sans fallback', () => {
    expect(PROSE_FONT_MAP.serif).toContain('"Songti SC"');
    expect(PROSE_FONT_MAP.serif).toContain('SimSun');
    expect(PROSE_FONT_MAP['modern-serif']).toContain('"Noto Serif CJK SC"');
    expect(PROSE_FONT_MAP.mono).toContain('"Noto Sans CJK SC"');
    // The Latin faces still come first for the existing options.
    expect(PROSE_FONT_MAP.serif.indexOf('Charter')).toBeLessThan(PROSE_FONT_MAP.serif.indexOf('Songti SC'));
    expect(PROSE_FONT_MAP.mono.indexOf('Menlo')).toBeLessThan(PROSE_FONT_MAP.mono.indexOf('PingFang SC'));
    // A generic family closes every stack so a machine with none of the named
    // faces still renders.
    for (const value of ['serif', 'modern-serif', 'cjk-serif', 'mono'] as const) {
      expect(PROSE_FONT_MAP[value].trim()).toMatch(/(serif|monospace)$/);
    }
  });

  it('leads cjk-serif with Chinese serif faces and keeps the Latin serif fallback', () => {
    const stack = PROSE_FONT_MAP['cjk-serif'];
    expect(stack.indexOf('"Source Han Serif SC"')).toBe(0);
    expect(stack.indexOf('"Noto Serif CJK SC"')).toBeLessThan(stack.indexOf('Songti SC'));
    expect(stack.indexOf('Songti SC')).toBeLessThan(stack.indexOf('Charter'));
    expect(stack.indexOf('Charter')).toBeLessThan(stack.lastIndexOf('serif'));
    expect(stack.endsWith('serif')).toBe(true);
  });
});

describe('accent link colors', () => {
  it('keeps the accent itself across themes but darkens links on light surfaces', () => {
    for (const accent of ACCENTS) {
      const dark = accentVars(accent.value, 'dark');
      const light = accentVars(accent.value, 'light');
      expect(Object.keys(dark)).toEqual(Object.keys(light));
      if (!accent.overrides) {
        // Cerulean links already come from the theme tokens.
        expect(dark).toEqual({});
        continue;
      }
      expect(light['--accent']).toBe(dark['--accent']);
      expect(light['--link']).not.toBe(dark['--link']);
      expect(light['--link-hover']).not.toBe(dark['--link-hover']);
    }
  });

  it('never invents variables the caller does not reset', () => {
    const known = ['--accent', '--accent-hover', '--accent-hi', '--accent-lo', '--link', '--link-hover'];
    for (const accent of ACCENTS) {
      for (const theme of ['light', 'dark'] as const) {
        expect(Object.keys(accentVars(accent.value, theme)).every((key) => known.includes(key))).toBe(true);
      }
    }
  });
});

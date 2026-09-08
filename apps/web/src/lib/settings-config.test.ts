import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
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
});

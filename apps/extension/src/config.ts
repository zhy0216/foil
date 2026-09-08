import { normalizeShareBaseUrl } from '@foil/editor/share';

export const DEFAULT_SHARE_BASE_URL = 'https://foil-47v.pages.dev/';

/** Undefined means the default; an explicitly empty or invalid setting fails. */
export function resolveShareBaseUrl(value: string | undefined): string {
  try {
    return normalizeShareBaseUrl(value === undefined ? DEFAULT_SHARE_BASE_URL : value);
  } catch {
    throw new Error('VITE_FOIL_SHARE_BASE_URL must be an absolute HTTP(S) URL without credentials.');
  }
}

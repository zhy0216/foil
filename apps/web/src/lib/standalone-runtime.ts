/** Shared types/IDs only. Never import the website's generated module here. */
export interface StandaloneRuntime {
  script: string;
  styles: string;
}

export const STANDALONE_IDS = {
  data: 'foil-share-data',
  script: 'foil-share-runtime',
  styles: 'foil-share-styles',
  root: 'root',
} as const;

export const STANDALONE_RESOURCE_FILE = 'foil-standalone.js';
const MAX_RUNTIME_CHARS = 8 * 1024 * 1024;

export function parseStandaloneRuntime(value: unknown): StandaloneRuntime {
  const invalid = () => new Error('The HTML reading program is unavailable. Please retry.');
  if (!value || typeof value !== 'object') throw invalid();
  const { script, styles } = value as Record<string, unknown>;
  if (typeof script !== 'string' || typeof styles !== 'string' || !script.trim() || !styles.trim() ||
      script.length + styles.length > MAX_RUNTIME_CHARS ||
      // Trusted compiled resources still have to be safe in HTML raw-text elements.
      // Reject parser state changes as well as closing tags; never rewrite JS syntax.
      // The quantified comment opener also keeps this validator safe when bundled inline.
      /<\/script\b|<!-{2}|\u0000/i.test(script) ||
      /<\/style\b|\u0000/i.test(styles)) throw invalid();
  // HTML parsing normalizes line endings; Blob UTF-8 encoding replaces lone
  // surrogates. Hash exactly that representation, including on re-export.
  const normalize = (text: string) => new TextDecoder().decode(
    new TextEncoder().encode(text.replace(/\r\n?/g, '\n')));
  return { script: normalize(script), styles: normalize(styles) };
}

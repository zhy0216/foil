import { normalizeShareBaseUrl, SHARE_BASE_URL_MAX_CHARS, SHARE_LIMITS, validateUrlPayload } from '@foil/editor/share';

// Includes surrounding whitespace; reject before trimming or parsing a URL.
export const IMPORT_SHARE_LINK_MAX_CHARS = SHARE_BASE_URL_MAX_CHARS + SHARE_LIMITS.fragmentChars;

export class ImportShareLinkError extends Error {}

/** Inspect pasted transport only. Never decode, fetch, navigate or persist it. */
export function parseShareLink(input: string): string {
  if (input.length > IMPORT_SHARE_LINK_MAX_CHARS) {
    throw new ImportShareLinkError('Shared link is too long. Use a link with a shorter website address or ask for an HTML export.');
  }
  const value = input.trim();
  if (!value) throw new ImportShareLinkError('Paste a Foil share link or fragment.');

  const hashIndex = value.indexOf('#');
  if (!value.startsWith('#')) {
    const base = hashIndex < 0 ? value : value.slice(0, hashIndex);
    try {
      // Require an explicit authority rather than URL's repaired https:///host
      // form. The shared normalizer rejects credentials, controls and backslashes.
      if (!/^https?:\/\/[^/?#]+(?:[/?]|$)/i.test(base) || /%(?![\da-f]{2})/i.test(base)) {
        throw new Error();
      }
      normalizeShareBaseUrl(base);
    } catch {
      throw new ImportShareLinkError('Use a complete HTTP(S) share URL without credentials (website address up to 2,048 characters), or paste only its fragment.');
    }
  }
  if (hashIndex < 0) throw new ImportShareLinkError('The link is missing its share fragment (#d=, #e=, #td= or #te=).');
  // Keep the original fragment byte-for-byte, including valid legacy padding.
  const fragment = value.slice(hashIndex);
  try {
    validateUrlPayload(fragment);
  } catch (error) {
    // The shared transport validator emits fixed messages, never payload text.
    throw new ImportShareLinkError((error as Error).message);
  }
  return fragment;
}

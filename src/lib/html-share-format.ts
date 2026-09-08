import { validateHtmlPayload } from './url-codec';

/** The only data stored outside the payload's protection layers. */
export interface HtmlShareData {
  format: 'foil-share';
  version: 1;
  payload: string;
  shareBaseUrl?: string;
}

export const SHARE_BASE_URL_MAX_CHARS = 2048;

export class HtmlShareFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HtmlShareFormatError';
  }
}

/** Keep only an absolute HTTP(S) origin and path for subsequent website links. */
export function normalizeShareBaseUrl(value: unknown): string {
  const invalid = () => new HtmlShareFormatError('Invalid HTML share base URL');
  if (typeof value !== 'string' || value.length > SHARE_BASE_URL_MAX_CHARS ||
      !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value) ||
      /^https?:\/\/[^/?#]*@/i.test(value)) {
    throw invalid();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw invalid();
  }
  const base = url.origin + url.pathname;
  if (base.length > SHARE_BASE_URL_MAX_CHARS) throw invalid();
  return base;
}

/** Validate unknown parsed JSON and return only version 1's explicit fields.
 *  This does not parse HTML, decrypt, decompress or read any browser storage. */
export function parseHtmlShareData(value: unknown): HtmlShareData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HtmlShareFormatError('Invalid HTML share data');
  }
  const data = value as Record<string, unknown>;
  if (!Object.hasOwn(data, 'format') || data.format !== 'foil-share') {
    throw new HtmlShareFormatError('Unsupported HTML share format');
  }
  if (!Object.hasOwn(data, 'version') || data.version !== 1) {
    throw new HtmlShareFormatError('Unsupported HTML share version');
  }
  if (!Object.hasOwn(data, 'payload') ||
      Object.keys(data).some(key => !['format', 'version', 'payload', 'shareBaseUrl'].includes(key))) {
    throw new HtmlShareFormatError('Invalid HTML share data');
  }
  const payload = data.payload;
  try {
    validateHtmlPayload(payload);
  } catch (error) {
    // The transport validator emits only fixed messages, never input text.
    throw new HtmlShareFormatError((error as Error).message);
  }
  return {
    format: 'foil-share', version: 1, payload,
    ...(Object.hasOwn(data, 'shareBaseUrl') ? { shareBaseUrl: normalizeShareBaseUrl(data.shareBaseUrl) } : {}),
  };
}

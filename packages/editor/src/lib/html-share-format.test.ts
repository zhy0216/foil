// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseHtmlShareData, normalizeShareBaseUrl, HtmlShareFormatError,
  SHARE_BASE_URL_MAX_CHARS, type HtmlShareData,
} from './html-share-format';
import { encodeHtmlPayload, decodeHtmlPayload, HTML_PAYLOAD_MAX_CHARS, SHARE_LIMITS } from './url-codec';

const valid: HtmlShareData = { format: 'foil-share', version: 1, payload: '#d=e30' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network access'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HTML share data format', () => {
  it('validates parsed JSON and returns only the versioned fields', () => {
    const data = parseHtmlShareData(JSON.parse(JSON.stringify(valid)));
    expect(data).toEqual(valid);
    expect(data).not.toBe(valid);
    expect(Object.hasOwn(data, 'shareBaseUrl')).toBe(false);
  });

  it.each(['d', 'e', 'td', 'te'])('validates #%s= framing without decoding, deriving, decompressing or opening', scheme => {
    const allocate = vi.spyOn(globalThis, 'atob');
    const kdf = vi.spyOn(crypto.subtle, 'deriveKey');
    const decompress = vi.fn();
    vi.stubGlobal('DecompressionStream', class { constructor() { decompress(); } });
    // Structurally valid transport bytes; cryptographic/schema validity is
    // deliberately deferred to decodeHtmlPayload/openTimeCapsule.
    const payload = `#${scheme}=` + 'A'.repeat(60);
    expect(parseHtmlShareData({ ...valid, payload })).toEqual({ ...valid, payload });
    expect(allocate).not.toHaveBeenCalled();
    expect(kdf).not.toHaveBeenCalled();
    expect(decompress).not.toHaveBeenCalled();
  });

  it('keeps document title, body and comments inside the protected payload', async () => {
    const doc = {
      title: 'PRIVATE_TITLE_甲', md: 'PRIVATE_BODY_乙',
      comments: [{ id: 'c', quote: 'PRIVATE_BODY_乙', before: '', after: '', replies: [
        { id: 'r', author: 'PRIVATE_AUTHOR', body: 'PRIVATE_COMMENT_丙', ts: 0 },
      ] }],
    };
    const payload = await encodeHtmlPayload(doc, { password: 'PRIVATE_PASSWORD_丁' });
    const data = parseHtmlShareData({ ...valid, payload, shareBaseUrl: 'https://foil.example/foil/?private=1#d=private' });
    expect(Object.keys(data)).toEqual(['format', 'version', 'payload', 'shareBaseUrl']);
    expect(JSON.stringify(data)).not.toContain('PRIVATE_');
    expect(data.shareBaseUrl).toBe('https://foil.example/foil/');
    expect(await decodeHtmlPayload(data.payload, 'PRIVATE_PASSWORD_丁')).toEqual({ state: doc });
  });

  it.each([null, undefined, [], true, 1, 'foil-share', JSON.stringify(valid), new Date()])('rejects unknown input %# with a stable format error', value => {
    expect(() => parseHtmlShareData(value)).toThrow(HtmlShareFormatError);
    expect(() => parseHtmlShareData(value)).toThrow(/^(Invalid HTML share data|Unsupported HTML share format)$/);
  });

  it.each([undefined, null, 'foil', 'Foil-share', 1])('rejects an unsupported format %#', format => {
    expect(() => parseHtmlShareData({ ...valid, format })).toThrow('Unsupported HTML share format');
  });

  it.each([undefined, null, 0, 2, -1, 1.5, '1', NaN, Infinity])('rejects an unsupported version %#', version => {
    expect(() => parseHtmlShareData({ ...valid, version })).toThrow('Unsupported HTML share version');
  });

  it.each([
    [undefined, 'Invalid HTML share payload'], [null, 'Invalid HTML share payload'],
    [1, 'Invalid HTML share payload'], [{}, 'Invalid HTML share payload'],
    ['', 'Invalid HTML share payload'], ['#', 'Invalid HTML share payload'],
    ['d=e30', 'Unsupported share scheme'], ['#unknown=AAAA', 'Unsupported share scheme'],
    ['#D=AAAA', 'Unsupported share scheme'], ['#d', 'Unsupported share scheme'],
    ['#=AAAA', 'Unsupported share scheme'], ['#d=', 'Invalid share encoding'],
    ['#d=!', 'Invalid share encoding'], ['#d=Zh', 'Invalid share encoding'],
    ['#d=Zg=', 'Invalid share encoding'], ['#e=AAAA', 'Invalid encrypted share data'],
    ['#te=AAAA', 'Invalid encrypted share data'],
  ])('rejects invalid payload %# consistently with the decoder', async (payload, error) => {
    expect(() => parseHtmlShareData({ ...valid, payload })).toThrow(error as string);
    expect(await decodeHtmlPayload(payload as string)).toEqual({ error });
  });

  it('checks string, decoded-layer and known cumulative limits before base64 allocation', () => {
    const allocate = vi.spyOn(globalThis, 'atob');
    expect(() => parseHtmlShareData({ ...valid, payload: '#d=' + 'A'.repeat(HTML_PAYLOAD_MAX_CHARS) }))
      .toThrow('HTML share payload exceeds the character limit');
    const overLayer = Math.ceil((SHARE_LIMITS.layerBytes + 1) * 4 / 3);
    expect(() => parseHtmlShareData({ ...valid, payload: '#d=' + 'A'.repeat(overLayer) }))
      .toThrow('Share data exceeds the 4 MiB limit');
    const overTotal = Math.ceil((SHARE_LIMITS.layerBytes + 23) * 4 / 3);
    expect(() => parseHtmlShareData({ ...valid, payload: '#te=' + 'A'.repeat(overTotal) }))
      .toThrow('Share data exceeds the total byte budget');
    expect(allocate).not.toHaveBeenCalled();
  });

  it.each(['state', 'md', 'title', 'password', 'author', 'settings', 'toJSON', '__proto__'])('rejects extra top-level %s instead of carrying unprotected data', key => {
    expect(() => parseHtmlShareData({ ...valid, [key]: 'private' })).toThrow('Invalid HTML share data');
  });

  it('requires its own payload and never fills it from prototypes or globals', () => {
    vi.stubGlobal('foilShare', valid);
    expect(() => parseHtmlShareData({ format: 'foil-share', version: 1 })).toThrow('Invalid HTML share data');
    expect(() => parseHtmlShareData(Object.create(valid))).toThrow('Unsupported HTML share format');
    const inherited = Object.assign(Object.create({ payload: valid.payload }), { format: 'foil-share', version: 1 });
    expect(() => parseHtmlShareData(inherited)).toThrow('Invalid HTML share data');
  });
});

describe('HTML share website base', () => {
  it.each([
    ['https://foil.example/foil/', 'https://foil.example/foil/'],
    ['http://localhost:5173', 'http://localhost:5173/'],
    ['https://FOIL.example:443/a/../foil/?source=private#e=secret', 'https://foil.example/foil/'],
    ['https://foil.example/中文', 'https://foil.example/%E4%B8%AD%E6%96%87'],
    ['http://[::1]:4173/foil/', 'http://[::1]:4173/foil/'],
    ['https://foil.example/a%3Fb%23c?secret#private', 'https://foil.example/a%3Fb%23c'],
  ])('normalizes %s to only an HTTP(S) origin/path', (value, expected) => {
    expect(normalizeShareBaseUrl(value)).toBe(expected);
    const input = { ...valid, shareBaseUrl: value };
    expect(parseHtmlShareData(input)).toEqual({ ...valid, shareBaseUrl: expected });
    expect(input.shareBaseUrl).toBe(value);
  });

  it.each([
    undefined, null, 1, {}, '', 'null', 'null/foil/', '/foil/', '//foil.example/foil/',
    'javascript:alert(1)', 'file:///tmp/share.html', 'data:text/html,hello',
    'blob:https://foil.example/id', 'ftp://foil.example/', 'https://',
    'https://user:secret@foil.example/foil/', 'http://user@foil.example/',
    'https://:secret@foil.example/', 'https://@foil.example/',
    ' https://foil.example/', 'https://foil.example/\nprivate', 'https://foil.example/\tprivate',
    'https://foil.example/\u0000private', 'https://foil.example\\@evil.example/',
  ])('rejects dangerous or non-website base %# with a stable error', value => {
    expect(() => normalizeShareBaseUrl(value)).toThrow(/^Invalid HTML share base URL$/);
    expect(() => parseHtmlShareData({ ...valid, shareBaseUrl: value })).toThrow(HtmlShareFormatError);
    expect(() => parseHtmlShareData({ ...valid, shareBaseUrl: value })).toThrow(/^Invalid HTML share base URL$/);
  });

  it('bounds both input and normalized base lengths', () => {
    const prefix = 'https://foil.example/';
    const maxBase = prefix + 'x'.repeat(SHARE_BASE_URL_MAX_CHARS - prefix.length);
    expect(normalizeShareBaseUrl(maxBase)).toBe(maxBase);
    expect(() => normalizeShareBaseUrl(maxBase + 'x')).toThrow('Invalid HTML share base URL');
    // Percent encoding can expand a short Unicode path beyond the fixed bound.
    expect(() => normalizeShareBaseUrl(prefix + '文'.repeat(300))).toThrow('Invalid HTML share base URL');
  });
});

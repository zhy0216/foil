import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeUrl, encodeUrl, SHARE_BASE_URL_MAX_CHARS, SHARE_LIMITS } from '@foil/editor/share';
import { IMPORT_SHARE_LINK_MAX_CHARS, ImportShareLinkError, parseShareLink } from './import-share-link';

afterEach(() => vi.unstubAllGlobals());

const schemes = ['d', 'e', 'td', 'te'];
// Enough bytes for the encrypted framing check; no cryptography or schema here.
const data = 'A'.repeat(60);
const bases = ['', 'https://foil-47v.pages.dev/', 'https://zhy0216.github.io/foil/',
  'http://localhost:4173/custom/?from=paste', 'HTTPS://custom.test/a%20path/?next=https://elsewhere.test/'];

describe.each(schemes)('#%s= transport', scheme => {
  it.each(bases)('extracts only the fragment from %s', base => {
    const fragment = `#${scheme}=${data}`;
    expect(parseShareLink(base + fragment)).toBe(fragment);
  });

  it.each(['', ' \t\r\n', '\u00a0'])('trims boundary whitespace %j', whitespace => {
    const fragment = `#${scheme}=${data}`;
    expect(parseShareLink(whitespace + bases[1] + fragment + whitespace)).toBe(fragment);
    expect(parseShareLink(whitespace + fragment + whitespace)).toBe(fragment);
  });

  it.each(['AA', 'AA==', 'AAA', 'AAA=', 'AAAA', '_-8='])('preserves canonical legacy padding %s', tail => {
    const fragment = `#${scheme}=${data}${tail}`;
    expect(parseShareLink(bases[1] + fragment)).toBe(fragment);
  });

  it.each(['', 'A', 'AB', 'AAB', 'AA=', 'AAA==', 'AAAA=', 'AA===', '=AAA', 'AA=A',
    'AA+/', 'AA%3D%3D', 'AA AA', 'AA\nAA', 'AA\tAA', 'AA#d=AA', 'AA&x=AA', '中文'])('rejects malformed base64 %j', tail => {
    expect(() => parseShareLink(`#${scheme}=${tail}`)).toThrow(ImportShareLinkError);
  });

  it('enforces the exact fragment ceiling before encoding validation', () => {
    const prefix = `#${scheme}=`;
    const atLimit = prefix + 'A'.repeat(SHARE_LIMITS.fragmentChars - prefix.length);
    if (prefix.length === 4) expect(parseShareLink(atLimit)).toBe(atLimit);
    else {
      // A 3-char prefix leaves base64 length 1 mod 4 at the exact cap.
      expect(() => parseShareLink(atLimit)).toThrow('Invalid share encoding');
      expect(parseShareLink(atLimit.slice(0, -1))).toBe(atLimit.slice(0, -1));
    }
    expect(() => parseShareLink(atLimit + 'A')).toThrow('256 KiB limit');
  });
});

it.each(['', ' ', '\n\t', 'https://foil-47v.pages.dev/', '#', '#x=AAAA', '#D=AAAA',
  '#d', '#d=', 'd=AAAA', 'relative/#d=AAAA', '//foil.test/#d=AAAA',
  'javascript:alert(1)#d=AAAA', 'data:text/html,hello#d=AAAA', 'file:///tmp/a#d=AAAA',
  'chrome-extension://installed/index.html#d=AAAA', 'ftp://host/#d=AAAA', 'blob:https://host/id#d=AAAA',
  'https:host/#d=AAAA', 'https:///host/#d=AAAA', 'https:///#d=AAAA', 'https://[bad/#d=AAAA',
  'https://host:99999/#d=AAAA', 'https://user:PRIVATE_PASSWORD@host/#d=AAAA',
  'https://user@host/#d=AAAA', 'https://@host/#d=AAAA', 'https://user%40name@host/#d=AAAA',
  'https://host\\path/#d=AAAA', 'https://ho\nst/#d=AAAA', 'https://host/a b#d=AAAA',
  'https://host/\u0000#d=AAAA', 'https://host/\u007f#d=AAAA', 'https://host/%zz#d=AAAA'])('rejects unsafe or incomplete input %j', input => {
  expect(() => parseShareLink(input)).toThrow(ImportShareLinkError);
});

it.each(['e', 'te'])('rejects truncated #%s= encrypted framing before KDF', scheme => {
  expect(() => parseShareLink(`#${scheme}=${'A'.repeat(59)}`)).toThrow('Invalid encrypted share data');
  expect(parseShareLink(`#${scheme}=${data}`)).toBe(`#${scheme}=${data}`);
});

it('bounds the website address and raw total including whitespace exactly', () => {
  const origin = 'https://custom.test/';
  const base = origin + 'a'.repeat(SHARE_BASE_URL_MAX_CHARS - origin.length);
  const fragment = '#td=' + 'A'.repeat(SHARE_LIMITS.fragmentChars - 4);
  expect((base + fragment).length).toBe(IMPORT_SHARE_LINK_MAX_CHARS);
  expect(parseShareLink(base + fragment)).toBe(fragment);
  expect(() => parseShareLink(base + 'a#d=AAAA')).toThrow('2,048');
  expect(() => parseShareLink(' ' + base + fragment)).toThrow('too long');
  expect(parseShareLink(' ' + base + fragment.slice(0, -1))).toBe(fragment.slice(0, -1));
});

it('rejects over-budget input before URL parsing', () => {
  const url = vi.fn(() => { throw new Error('URL parsing must not run'); });
  vi.stubGlobal('URL', url);
  expect(() => parseShareLink('https://host/#td=' + 'A'.repeat(IMPORT_SHARE_LINK_MAX_CHARS))).toThrow('too long');
  expect(url).not.toHaveBeenCalled();
});

it('inspects transport without decoding, network, clipboard or storage APIs', () => {
  const forbidden = vi.fn(() => { throw new Error('Unexpected side effect'); });
  for (const name of ['fetch', 'atob', 'DecompressionStream', 'CompressionStream']) vi.stubGlobal(name, forbidden);
  const inaccessible = new Proxy({}, { get: forbidden });
  for (const name of ['crypto', 'localStorage', 'sessionStorage', 'navigator', 'chrome']) vi.stubGlobal(name, inaccessible);
  for (const scheme of schemes) expect(parseShareLink(`https://supplied.test/#${scheme}=${data}`)).toBe(`#${scheme}=${data}`);
  expect(() => parseShareLink('https://supplied.test/#e=%broken')).toThrow('Invalid share encoding');
  expect(forbidden).not.toHaveBeenCalled();
});

it('leaves actual document validation to the shared decoder and round-trips real shares', async () => {
  const state = { title: 'Website snapshot', md: '# Markdown 中文', comments: [] };
  const fragment = await encodeUrl(state);
  expect(await decodeUrl(parseShareLink(bases[1] + fragment))).toEqual({ state });
  const invalidDocument = '#d=e30='; // Valid legacy base64 for {}, not a document.
  expect(parseShareLink(invalidDocument)).toBe(invalidDocument);
  expect(await decodeUrl(invalidDocument)).toHaveProperty('error');
});

it('does not echo credentials or document data in diagnostics', () => {
  for (const input of ['https://name:PRIVATE_PASSWORD@host/#d=PRIVATE_DOCUMENT', '#d=PRIVATE_DOCUMENT%']) {
    try { parseShareLink(input); throw new Error('Expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(ImportShareLinkError);
      expect((error as Error).message).not.toMatch(/PRIVATE_PASSWORD|PRIVATE_DOCUMENT/);
    }
  }
});

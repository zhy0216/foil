import { HtmlShareFormatError, parseHtmlShareData, SHARE_BASE_URL_MAX_CHARS, type HtmlShareData } from '../lib/html-share-format';
import { HTML_PAYLOAD_MAX_CHARS } from '../lib/url-codec';
import { parseStandaloneRuntime, STANDALONE_IDS, type StandaloneRuntime } from '../lib/standalone-runtime';

export const HTML_SHARE_DATA_MAX_CHARS = HTML_PAYLOAD_MAX_CHARS + 6 * SHARE_BASE_URL_MAX_CHARS + 1024;

function fixedElement(doc: Document, id: string, tag: string): Element {
  const elements = doc.querySelectorAll(`[id="${id}"]`);
  if (elements.length !== 1 || elements[0].localName !== tag) {
    throw new HtmlShareFormatError('The shared file is missing or has duplicate reading data.');
  }
  return elements[0];
}

/** Only this fixed, non-executable block can supply a document. */
export function readEmbeddedShareData(doc: Document = document): HtmlShareData {
  const element = fixedElement(doc, STANDALONE_IDS.data, 'script');
  const text = element.textContent ?? '';
  if (element.getAttribute('type') !== 'application/json' || element.hasAttribute('src') ||
      text.length > HTML_SHARE_DATA_MAX_CHARS) {
    throw new HtmlShareFormatError('Invalid HTML share data');
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new HtmlShareFormatError('Invalid HTML share data'); }
  return parseHtmlShareData(value);
}

/** File only. Read static resources, never root/outerHTML or the unlocked DOM. */
export function readStandaloneRuntime(doc: Document = document): StandaloneRuntime {
  const script = fixedElement(doc, STANDALONE_IDS.script, 'script');
  const styles = fixedElement(doc, STANDALONE_IDS.styles, 'style');
  if (script.hasAttribute('src') || script.hasAttribute('type')) {
    throw new Error('The HTML reading program is unavailable. Please retry.');
  }
  return parseStandaloneRuntime({ script: script.textContent, styles: styles.textContent });
}

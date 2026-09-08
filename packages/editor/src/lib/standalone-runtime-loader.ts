import { parseStandaloneRuntime, STANDALONE_RESOURCE_FILE, type StandaloneRuntime } from './standalone-runtime';

/** App hosts only. Dynamic JS import complies with the site's script-src 'self';
 * fetching JSON would be blocked by its deliberately drand-only connect-src.
 * Never import this module into the standalone program or the shared assembler. */
export async function loadStandaloneRuntime(): Promise<StandaloneRuntime> {
  try {
    // Native module imports are cached even with no-store. In dev each request
    // must see source edits made since the previous export in this tab.
    // Resolve against the document, not this module's hashed assets/ chunk.
    const url = new URL(import.meta.env.BASE_URL + STANDALONE_RESOURCE_FILE, document.baseURI);
    if (import.meta.env.DEV) url.searchParams.set('t', String(Date.now()));
    const module = await import(/* @vite-ignore */ url.href);
    return parseStandaloneRuntime(module.default);
  } catch {
    throw new Error('The HTML reading program could not be loaded. Please retry.');
  }
}

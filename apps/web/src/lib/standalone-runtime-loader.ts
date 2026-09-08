import { parseStandaloneRuntime, STANDALONE_RESOURCE_FILE, type StandaloneRuntime } from './standalone-runtime';

/** Website only. Dynamic JS import complies with the site's script-src 'self';
 * fetching JSON would be blocked by its deliberately drand-only connect-src.
 * Never import this module into the standalone program or the shared assembler. */
export async function loadStandaloneRuntime(): Promise<StandaloneRuntime> {
  try {
    // Native module imports are cached even with no-store. In dev each request
    // must see source edits made since the previous export in this tab.
    const url = import.meta.env.BASE_URL + STANDALONE_RESOURCE_FILE +
      (import.meta.env.DEV ? `?t=${Date.now()}` : '');
    const module = await import(/* @vite-ignore */ url);
    return parseStandaloneRuntime(module.default);
  } catch {
    throw new Error('The HTML reading program could not be loaded. Please retry.');
  }
}

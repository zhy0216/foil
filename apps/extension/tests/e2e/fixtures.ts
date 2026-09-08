import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test as base, expect, type BrowserContext, type Page, type Route, type TestInfo, type Worker } from '@playwright/test';
import { loadEnv } from 'vite';
import { resolveShareBaseUrl } from '../../src/config';
import { DRAND_BEACON, DRAND_INFO, DRAND_ORIGINS } from '../../../web/tests/e2e/helpers/drand';
import { fulfillDrand } from '../../../web/tests/e2e/helpers/html-export';

export const extensionRoot = fileURLToPath(new URL('../../', import.meta.url));
export const dist = join(extensionRoot, 'dist');
export const shareBase = resolveShareBaseUrl(loadEnv('production', extensionRoot, 'VITE_').VITE_FOIL_SHARE_BASE_URL);

export type Network = {
  requests: string[]; unexpected: string[]; failed: string[]; drand: string[];
  allowDrand: boolean; failDrand: boolean; failover: boolean; forge: boolean;
  holdBeacon: boolean; held: Route[];
};
export type Session = {
  context: BrowserContext; network: Network; scripts: string[];
  expectedErrors: string[];
  close: () => Promise<void>;
};
export type Installed = Session & {
  worker: Worker; entry: string; profile: string;
  page: () => Promise<Page>;
  restart: () => Promise<Installed>;
};
type Fixtures = {
  install: (directory?: string, profile?: string) => Promise<Installed>;
  extension: Installed;
  recipient: (options?: { drand?: boolean; publicWebsite?: boolean }) => Promise<Session & { page: Page }>;
};

/** All HTTP(S) is denied unless it is a known built website path or fixed beacon.
 * Public recipients retain the actual share URL; route.fetch only ever targets
 * our separate localhost preview. Pasted import hosts get no such grant. */
async function networkPolicy(context: BrowserContext, website: string, publicWebsite: boolean): Promise<Network> {
  const network: Network = { requests: [], unexpected: [], failed: [], drand: [],
    allowDrand: false, failDrand: false, failover: false, forge: false, holdBeacon: false, held: [] };
  const local = new URL(website);
  const publicBase = new URL(shareBase);
  await context.route(/^https?:/, async route => {
    const url = new URL(route.request().url());
    network.requests.push(url.href);
    const localPath = url.pathname.startsWith(local.pathname) ? url.pathname.slice(local.pathname.length) : null;
    const asset = localPath !== null && /^(?:assets\/[\w.-]+\.(?:js|css|svg|png|woff2?)|foil-standalone\.js)$/.test(localPath);
    if (url.origin === local.origin && (url.pathname === local.pathname || asset) && !url.search) return route.continue();
    if (publicWebsite && url.origin === publicBase.origin && !url.search && (url.pathname === publicBase.pathname || asset)) {
      const response = await route.fetch({ url: url.pathname === publicBase.pathname ? website : `${local.origin}${url.pathname}`, maxRedirects: 0 });
      expect(response.status(), `Local website asset ${url.pathname}`).toBe(200);
      return route.fulfill({ response });
    }
    const info = url.pathname === `/${DRAND_INFO.hash}/info`;
    const beacon = url.pathname === `/${DRAND_INFO.hash}/public/${DRAND_BEACON.round}`;
    if (network.allowDrand && DRAND_ORIGINS.has(url.origin) && !url.search && (info || beacon)) {
      network.drand.push(url.href);
      if (network.failDrand) { network.failed.push(url.href); return route.abort('internetdisconnected'); }
      if (beacon && network.holdBeacon) { network.held.push(route); return; }
      const data = info
        ? network.failover && url.origin !== 'https://api3.drand.sh' ? { ...DRAND_INFO, hash: 'invalid' } : DRAND_INFO
        : network.forge ? { ...DRAND_BEACON, signature: '00'.repeat(48) } : DRAND_BEACON;
      return fulfillDrand(route, data);
    }
    network.unexpected.push(url.href);
    return route.abort('internetdisconnected');
  });
  return network;
}

// Playwright's configured tracing also covers custom contexts, including those
// closed before a profile restart. Keep additional per-context diagnostics and
// screenshots, and delete every temporary profile even on assertion failure.
export class Sessions {
  private sessions: Session[] = [];
  private contexts = new Set<BrowserContext>();
  private profiles: string[] = [];
  constructor(private info: TestInfo, private baseURL: string) {}

  async monitor(context: BrowserContext, publicWebsite = false): Promise<Session> {
    this.contexts.add(context);
    const index = this.sessions.length;
    const network = await networkPolicy(context, this.baseURL, publicWebsite);
    const errors: { message: string; url: string }[] = [];
    const pageErrors: string[] = [];
    const csp: unknown[] = [];
    const scripts: string[] = [];
    const expectedErrors: string[] = [];
    await context.exposeBinding('__foilCsp', (_source, violation) => csp.push(violation));
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', event => {
        void (window as unknown as { __foilCsp: (value: unknown) => Promise<void> }).__foilCsp({
          directive: event.violatedDirective, blocked: event.blockedURI,
        });
      });
    });
    const monitorPage = (page: Page) => {
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push({ message: message.text(), url: message.location().url }); });
    };
    context.on('page', monitorPage);
    context.pages().forEach(monitorPage);
    let closed = false;
    const session: Session = { context, network, scripts, expectedErrors, close: async () => {
      if (closed) return;
      closed = true;
      await mkdir(this.info.outputDir, { recursive: true });
      if (this.info.status !== this.info.expectedStatus) {
        for (const [i, page] of context.pages().entries()) {
          if (!page.isClosed()) await page.screenshot({ path: this.info.outputPath(`context-${index}-page-${i}.png`) }).catch(() => {});
        }
      }
      await context.close();
      // Check all diagnostics, including pages already closed or reloaded.
      // Closing first also catches requests issued by page lifecycle handlers.
      expect.soft(network.unexpected, 'Unexpected HTTP(S)').toEqual([]);
      expect.soft(pageErrors, 'Page errors').toEqual([]);
      expect.soft(csp, 'CSP violations').toEqual([]);
      const functionalErrors = errors.filter(error => !(network.failed.includes(error.url) &&
        /Failed to load resource|Load failed|network connection was lost/i.test(error.message)));
      expect.soft(functionalErrors.map(error => error.message).sort(), 'Unexpected console errors').toEqual([...expectedErrors].sort());
      await writeFile(this.info.outputPath(`context-${index}.json`), JSON.stringify({
        browser: context.browser()?.version(), network: { ...network, held: network.held.length }, pageErrors, errors, csp, scripts,
      }, null, 2));
    } };
    this.sessions.push(session);
    this.info.annotations.push({ type: 'browser', description: context.browser()!.version() });
    return session;
  }

  async install(directory = dist, existingProfile?: string): Promise<Installed> {
    const profile = existingProfile ?? await mkdtemp(join(tmpdir(), 'foil-extension-e2e-'));
    if (!existingProfile) this.profiles.push(profile);
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, serviceWorkers: 'allow', acceptDownloads: true,
      timezoneId: 'UTC', viewport: { width: 1400, height: 1000 },
      args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
    });
    // Register ownership before monitoring, tracing or worker discovery can fail.
    this.contexts.add(context);
    try {
      const session = await this.monitor(context);
      await context.setOffline(true);
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const entry = await worker.evaluate(() => chrome.runtime.getURL('index.html'));
      expect(entry).toMatch(/^chrome-extension:\/\/[a-p]{32}\/index\.html$/);
      expect(worker.url()).toBe(entry.replace('index.html', 'background.js'));
      return { ...session, worker, entry, profile,
        page: async () => {
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          cdp.on('Debugger.scriptParsed', event => { if (event.url) session.scripts.push(event.url); });
          await cdp.send('Debugger.enable');
          await page.goto(entry);
          await expect(page.locator('[contenteditable="true"]')).toBeVisible();
          return page;
        },
        restart: async () => { await session.close(); return this.install(directory, profile); },
      };
    } catch (error) {
      try { await context.close(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Extension startup and cleanup failed'); }
      throw error;
    }
  }

  async finish() {
    const errors: unknown[] = [];
    const attemptAll = async (actions: (() => Promise<unknown>)[]) => {
      for (const result of await Promise.allSettled(actions.map(action => Promise.resolve().then(action)))) {
        if (result.status === 'rejected') errors.push(result.reason);
      }
    };
    await attemptAll(this.sessions.map(session => () => session.close()));
    // Include contexts whose startup never got as far as creating a Session.
    await attemptAll([...this.contexts].map(context => () => context.close()));
    // Only directories this manager created with mkdtemp are owned/deleted.
    await attemptAll(this.profiles.map(profile => () => rm(profile, { recursive: true, force: true })));
    if (errors.length) throw new AggregateError(errors, 'Browser fixture cleanup failed');
  }
}

export const test = base.extend<Fixtures & { sessions: Sessions }>({
  sessions: async ({ baseURL }, use, info) => {
    const sessions = new Sessions(info, baseURL!);
    try { await use(sessions); } finally { await sessions.finish(); }
  },
  install: async ({ sessions }, use) => use((directory, profile) => sessions.install(directory, profile)),
  extension: async ({ install }, use) => use(await install()),
  recipient: async ({ browser, sessions }, use) => use(async (options = {}) => {
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC', acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
    const session = await sessions.monitor(context, options.publicWebsite);
    session.network.allowDrand = options.drand ?? false;
    return { ...session, page: await context.newPage() };
  }),
});
export { expect };

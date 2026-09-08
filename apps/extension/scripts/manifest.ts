import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const DRAND_ORIGINS = [
  'https://api.drand.sh', 'https://drand.cloudflare.com',
  'https://api2.drand.sh', 'https://api3.drand.sh',
];
export const ICON_SIZES = [16, 32, 48, 128];

export function validateManifest(value: unknown): asserts value is chrome.runtime.ManifestV3 {
  assert(value && typeof value === 'object', 'Missing extension manifest');
  const manifest = value as chrome.runtime.ManifestV3;
  assert.equal(manifest.manifest_version, 3);
  assert.equal(typeof manifest.name, 'string');
  assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/);
  assert(manifest.version.split('.').every(part => Number(part) <= 65535));
  assert.deepEqual(Object.keys(manifest).sort(), [
    'manifest_version', 'name', 'version', 'description', 'action', 'icons',
    'background', 'host_permissions', 'content_security_policy',
  ].sort(), 'Unexpected manifest capability');
  assert.deepEqual(manifest.background, { service_worker: 'background.js', type: 'module' });
  assert.deepEqual(manifest.host_permissions && [...manifest.host_permissions].sort(), DRAND_ORIGINS.map(origin => `${origin}/*`).sort());
  const icons = Object.fromEntries(ICON_SIZES.map(size => [size, `icons/${size}.png`]));
  assert.deepEqual(manifest.icons, icons);
  assert.deepEqual(manifest.action, { default_title: 'Open Foil', default_icon: icons });
  assert.deepEqual(Object.keys(manifest.content_security_policy ?? {}), ['extension_pages']);
  const directives = manifest.content_security_policy!.extension_pages!.split(';').map(s => s.trim()).filter(Boolean);
  assert.deepEqual(directives.sort(), [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${DRAND_ORIGINS.join(' ')}`, "img-src 'self' data:",
    "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'",
  ].sort(), 'Extension CSP must keep local scripts and exactly the drand connections');
}

/** Read on each build, including watch rebuilds; never copy a stale manifest. */
export function extensionPlugin(): Plugin {
  let root: string;
  return {
    name: 'foil-extension-package',
    configResolved(config) { root = config.root; },
    async buildStart() {
      const manifestFile = resolve(root, 'manifest.json');
      this.addWatchFile(manifestFile);
      // The nested standalone build is in memory, so add its source files to
      // the outer watch graph as well (including reader-only edits).
      const { readdir } = await import('node:fs/promises');
      const editorRoot = resolve(root, '../../packages/editor');
      for (const name of await readdir(resolve(editorRoot, 'src'), { recursive: true })) {
        if (/\.(?:tsx?|css|svg)$/.test(name) && !/\.test\./.test(name)) this.addWatchFile(resolve(editorRoot, 'src', name));
      }
      this.addWatchFile(resolve(editorRoot, 'build/standalone.ts'));
      const source = await readFile(manifestFile, 'utf8');
      validateManifest(JSON.parse(source));
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source });
    },
    generateBundle(_options, bundle) {
      const worker = bundle['background.js'];
      assert(worker?.type === 'chunk', 'Missing toolbar worker');
      assert.equal(Object.keys(worker.modules).length, 1, 'Keep dependencies out of the toolbar worker');
      assert.equal(worker.imports.length + worker.dynamicImports.length, 0, 'Worker must be self-contained');
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const dependency of [...item.imports, ...item.dynamicImports]) {
          assert(Object.hasOwn(bundle, dependency), `Missing or remote executable dependency: ${dependency}`);
        }
      }
    },
  };
}

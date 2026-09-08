import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import manifest from '../manifest.json';
import { ICON_SIZES, validateManifest } from './manifest';
import { checkFiles, createPackageZip, readPackage, type PackageFiles } from './artifact';

const bytes = (text: string) => new TextEncoder().encode(text);
async function fixture(): Promise<PackageFiles> {
  return {
    'manifest.json': bytes(JSON.stringify(manifest)),
    'index.html': bytes('<link rel="icon" href="./icons/32.png"><script type="module" src="./assets/index-abc.js"></script>'),
    'background.js': bytes('chrome.action.onClicked.addListener(async()=>{});'),
    'foil-standalone.js': bytes('export default {script:"reader",styles:"body{}"};'),
    'assets/index-abc.js': bytes('import("./crypto-abc.js");'),
    'assets/crypto-abc.js': bytes('export const local = true;'),
    ...Object.fromEntries(await Promise.all(ICON_SIZES.map(async size => [
      `icons/${size}.png`, await readFile(new URL(`../public/icons/${size}.png`, import.meta.url)),
    ]))),
  };
}

it('accepts the checked-in minimal manifest and packaged icon dimensions', async () => {
  await expect(checkFiles(await fixture())).resolves.toEqual(manifest);
});

it.each([
  ['permissions', ['tabs']], ['optional_permissions', ['clipboardRead']],
  ['content_scripts', []], ['web_accessible_resources', []], ['sandbox', { pages: ['sandbox.html'] }],
  ['host_permissions', ['https://*.drand.sh/*']],
  ['host_permissions', [...manifest.host_permissions, 'https://example.com/*']],
  ['action', { ...manifest.action, default_popup: 'index.html' }],
  ['background', { type: 'module', service_worker: 'missing.js' }],
  ['content_security_policy', { extension_pages: manifest.content_security_policy.extension_pages.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'") }],
])('rejects a changed capability or policy: %s', (key, value) => {
  expect(() => validateManifest({ ...manifest, [key]: value })).toThrow();
});

it.each(['src/main.tsx', 'node_modules/lib.js', 'profile/Preferences', 'report.html', 'previous.zip', 'assets/index.js.map', '../outside.js'])('rejects non-runtime archive content: %s', async name => {
  const files = await fixture();
  files[name] = bytes('must not ship');
  await expect(checkFiles(files)).rejects.toThrow('Unexpected package file');
});

it.each(['background.js', 'foil-standalone.js', 'assets/crypto-abc.js', 'icons/16.png'])('rejects missing runtime content: %s', async name => {
  const files = await fixture();
  delete files[name];
  await expect(checkFiles(files)).rejects.toThrow(/Missing/);
});

it.each([
  ['index.html', '<script type="module" src="/foil/assets/index-abc.js"></script>'],
  ['index.html', '<script type="module" src="http://localhost:5173/src/main.tsx"></script>'],
  ['index.html', '<script type="module" src="./assets/index-abc.js">alert(1)</script>'],
  ['assets/index-abc.js', 'import "https://example.com/remote.js";'],
  ['assets/index-abc.js', 'import("https://example.com/remote.js");'],
  ['assets/styles-abc.css', '@import "https://example.com/style.css";'],
  ['background.js', 'import "./assets/index-abc.js";'],
])('rejects nonlocal resources, inline code and worker dependencies in %s', async (name, source) => {
  const files = await fixture();
  files[name] = bytes(source);
  await expect(checkFiles(files)).rejects.toThrow();
});

it('rejects an icon with the wrong dimensions', async () => {
  const files = await fixture();
  files['icons/16.png'] = files['icons/128.png'];
  await expect(checkFiles(files)).rejects.toThrow('Wrong icon width');
});

it('produces a deterministic ZIP with a root manifest and every runtime byte intact', async () => {
  const files = await fixture();
  const first = createPackageZip(files);
  const second = createPackageZip(Object.fromEntries(Object.entries(files).reverse()));
  expect(first).toEqual(second);
  const extracted = unzipSync(first);
  expect(Object.keys(extracted)).toEqual(Object.keys(files).sort());
  for (const name of Object.keys(files)) expect(Buffer.from(extracted[name])).toEqual(Buffer.from(files[name]));
});

it('refuses a profile directory or symlink before collecting package bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'foil-package-unit-'));
  try {
    await mkdir(join(directory, 'profile'));
    await expect(readPackage(directory)).rejects.toThrow('Unexpected package directory');
    await rm(join(directory, 'profile'), { recursive: true });
    await writeFile(join(directory, 'index.html'), 'test');
    await symlink(join(directory, 'index.html'), join(directory, 'background.js'));
    await expect(readPackage(directory)).rejects.toThrow('Package contains a symlink');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

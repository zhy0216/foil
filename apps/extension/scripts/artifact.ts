import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { init, parse } from 'es-module-lexer';
import { zipSync, unzipSync } from 'fflate';
import { ICON_SIZES, validateManifest } from './manifest';

export type PackageFiles = Record<string, Uint8Array>;

/** Fail closed: an accidental source/profile/report file must not enter a ZIP. */
export async function readPackage(directory: string): Promise<PackageFiles> {
  const files: PackageFiles = {};
  async function visit(relative = '') {
    for (const entry of await readdir(resolve(directory, relative), { withFileTypes: true })) {
      const name = posix.join(relative, entry.name);
      assert(!entry.isSymbolicLink(), `Package contains a symlink: ${name}`);
      if (entry.isDirectory()) {
        assert(['assets', 'icons'].includes(name), `Unexpected package directory: ${name}`);
        await visit(name);
      } else {
        assert(entry.isFile(), `Not a runtime file: ${name}`);
        files[name] = await readFile(resolve(directory, name));
      }
    }
  }
  await visit();
  await checkFiles(files);
  return files;
}

export async function checkFiles(files: PackageFiles) {
  const runtimeName = /^(?:manifest\.json|index\.html|background\.js|foil-standalone\.js|icons\/(?:16|32|48|128)\.png|assets\/[\w-]+\.(?:js|css|svg|png|woff2?))$/;
  for (const name of Object.keys(files)) assert(runtimeName.test(name), `Unexpected package file: ${name}`);
  function content(name: string) {
    assert(files[name]?.length, `Missing runtime file: ${name}`);
    return new TextDecoder().decode(files[name]);
  }
  const manifest: unknown = JSON.parse(content('manifest.json'));
  validateManifest(manifest);
  content('background.js');
  assert.match(content('foil-standalone.js'), /^export default /);
  function localReference(reference: string, from: string) {
    assert(reference.startsWith('./') || reference.startsWith('../'), `Non-relative resource in ${from}: ${reference}`);
    const name = posix.normalize(posix.join(posix.dirname(from), reference));
    assert(files[name]?.length, `Missing resource from ${from}: ${name}`);
  }
  const html = content('index.html');
  assert(!/http-equiv=["']Content-Security-Policy/i.test(html), 'Use manifest CSP, not website meta-CSP');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1, 'Expected one packaged entry script');
  assert.match(scripts[0][1], /type="module"/);
  assert.match(scripts[0][1], /src="\.\//);
  assert.equal(scripts[0][2].trim(), '', 'Inline executable script in extension page');
  assert(!/\son\w+\s*=|<base\b/i.test(html), 'Unexpected executable attribute or base override');
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) localReference(match[1], 'index.html');
  await init;
  for (const name of Object.keys(files)) {
    if (name.endsWith('.js')) {
      const [imports] = parse(content(name));
      for (const dependency of imports) {
        // import.meta and the native, document-relative standalone loader have
        // no literal specifier. Its actual URL is covered by installed smoke.
        if (dependency.n !== undefined) localReference(dependency.n, name);
      }
      if (name === 'background.js') {
        assert.equal(imports.length, 0, 'Worker must not import other modules');
        assert(!/\b(?:document|window|localStorage|sessionStorage|React)\b/.test(content(name)), 'Page dependency in worker');
      }
    }
    if (name.endsWith('.css')) {
      const css = content(name);
      assert(!/@import\b/i.test(css), 'Unexpected CSS import');
      for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) {
        if (!match[1].startsWith('data:')) localReference(match[1], name);
      }
    }
  }
  for (const size of ICON_SIZES) {
    const name = `icons/${size}.png`;
    content(name);
    const png = Buffer.from(files[name]);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Not PNG: ${name}`);
    assert.equal(png.subarray(12, 16).toString(), 'IHDR');
    assert.equal(png.readUInt32BE(16), size, `Wrong icon width: ${name}`);
    assert.equal(png.readUInt32BE(20), size, `Wrong icon height: ${name}`);
  }
  return manifest;
}

/** Stable ordering/timestamps; archive round-trip verifies every runtime byte. */
export function createPackageZip(files: PackageFiles): Uint8Array {
  const sorted = Object.fromEntries(Object.keys(files).sort().map(name => [name, files[name]]));
  const zip = zipSync(sorted, { level: 9, mtime: new Date(1980, 0, 1) });
  const extracted = unzipSync(zip);
  assert.deepEqual(Object.keys(extracted), Object.keys(sorted));
  for (const name of Object.keys(sorted)) assert.deepEqual(Buffer.from(extracted[name]), Buffer.from(sorted[name]));
  return zip;
}

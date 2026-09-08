import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { readPackage, checkFiles } from '../../scripts/artifact';
import { test, expect, dist, extensionRoot } from './fixtures';
import { openShare } from './helpers';
import { download } from '../../../web/tests/e2e/helpers/html-export';

test('production ZIP has only checked runtime bytes and loads from its extracted root offline', async ({ install }, info) => {
  const files = await readPackage(dist);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  const zipPath = join(extensionRoot, 'artifacts', `foil-extension-${manifest.version}.zip`);
  const zip = await readFile(zipPath);
  const extracted = unzipSync(zip);
  expect(Object.keys(extracted).sort()).toEqual(Object.keys(files).sort());
  expect(Object.keys(extracted)).toContain('manifest.json');
  const directory = info.outputPath('zip-unpacked');
  for (const [name, bytes] of Object.entries(extracted)) {
    expect(Buffer.from(bytes)).toEqual(Buffer.from(files[name]));
    await mkdir(join(directory, name, '..'), { recursive: true });
    await writeFile(join(directory, name), bytes);
  }
  await readPackage(directory);
  const extension = await install(directory);
  const page = await extension.page();
  await openShare(page);
  await download(page, info, 'zip-first-offline-export');
  expect(extension.network.requests).toEqual([]);
  info.annotations.push({ type: 'package', description: `${zipPath}: ${Object.keys(files).length} files, ${zip.length} ZIP bytes` });
});

test('production package checks reject missing lazy code, reader data and broader capabilities', async () => {
  const files = await readPackage(dist);
  const crypto = Object.keys(files).find(name => /timecapsule-crypto.*\.js$/.test(name));
  expect(crypto).toBeDefined();
  for (const name of [crypto!, 'foil-standalone.js', 'background.js', 'icons/16.png']) {
    const damaged = { ...files };
    delete damaged[name];
    await expect(checkFiles(damaged)).rejects.toThrow(/Missing/);
  }
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  for (const permissions of [['clipboardRead'], ['tabs'], ['activeTab']]) {
    await expect(checkFiles({ ...files, 'manifest.json': new TextEncoder().encode(JSON.stringify({ ...manifest, permissions })) })).rejects.toThrow();
  }
  await expect(checkFiles({ ...files, 'foil-standalone.js': new TextEncoder().encode('export default {"script":"","styles":""};') })).rejects.toThrow();
});

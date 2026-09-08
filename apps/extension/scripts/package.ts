import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readPackage, createPackageZip } from './artifact';

const files = await readPackage(fileURLToPath(new URL('../dist/', import.meta.url)));
const { version } = JSON.parse(new TextDecoder().decode(files['manifest.json']));
const directory = new URL('../artifacts/', import.meta.url);
await mkdir(directory, { recursive: true });
const destination = new URL(`foil-extension-${version}.zip`, directory);
const zip = createPackageZip(files);
await writeFile(destination, zip);
console.log(`Packaged ${Object.keys(files).length} runtime files (${zip.length} bytes): ${fileURLToPath(destination)}`);

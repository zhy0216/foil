import { fileURLToPath } from 'node:url';
import { readPackage } from './artifact';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const files = await readPackage(directory);
console.log(`Checked ${Object.keys(files).length} runtime files in ${directory}`);

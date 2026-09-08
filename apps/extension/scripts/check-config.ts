import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { resolveShareBaseUrl } from '../src/config';

// Build and watch both use production mode. Vite gives shell variables priority
// over .env files; validate the same value before emitting any package files.
const env = loadEnv('production', fileURLToPath(new URL('../', import.meta.url)), 'VITE_');
resolveShareBaseUrl(env.VITE_FOIL_SHARE_BASE_URL);

import { afterEach, expect, it, vi } from 'vitest';
import { loadStandaloneRuntime } from './standalone-runtime-loader';

const runtime = { script: '/* reader */', styles: 'body{color:blue}' };
const urls = [
  'http://localhost:3000/foil/foil-standalone.js',
  'http://localhost:3000/foil-standalone.js',
  'http://localhost:3000/packaged/foil-standalone.js',
];

afterEach(() => {
  for (const url of urls) vi.doUnmock(url);
  vi.unstubAllEnvs();
  history.replaceState(null, '', '/');
});

it.each([
  { base: '/foil/', path: '/foil/', url: urls[0] },
  { base: '/', path: '/', url: urls[1] },
  { base: './', path: '/packaged/index.html', url: urls[2] },
])('imports the resource at the document URL with base $base', async ({ base, path, url }) => {
  history.replaceState(null, '', path + '?query#fragment');
  vi.stubEnv('BASE_URL', base);
  vi.stubEnv('DEV', false);
  vi.doMock(url, () => ({ default: runtime }));
  await expect(loadStandaloneRuntime()).resolves.toEqual(runtime);
});

it('rejects invalid resources and allows retry without exposing the module error', async () => {
  vi.stubEnv('BASE_URL', '/');
  vi.stubEnv('DEV', false);
  vi.doMock(urls[1], () => ({ default: { script: 'private data', styles: '' } }));
  await expect(loadStandaloneRuntime()).rejects.toThrow('The HTML reading program could not be loaded. Please retry.');
  vi.doMock(urls[1], () => ({ default: runtime }));
  await expect(loadStandaloneRuntime()).resolves.toEqual(runtime);
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Strict CSP injected into the built index.html. Drand endpoints stay in
 *  `connect-src` so time-capsule unlock still works. We omit this in dev so
 *  Vite's HMR (which uses inline scripts + a ws connection) keeps working. */
const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://api.drand.sh https://drand.cloudflare.com https://api2.drand.sh https://api3.drand.sh; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none';">`;

function cspPlugin() {
  return {
    name: 'foil-csp-meta',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace('<head>', `<head>\n    ${cspMeta}`);
    },
  };
}

export default defineConfig({
  base: '/foil/',
  plugins: [react(), cspPlugin()],
  server: { port: 5173 },
  resolve: {
    alias: {
      // tlock-js imports Node's Buffer; the `buffer` npm package is its browser polyfill.
      buffer: 'buffer/',
    },
  },
  define: {
    global: 'globalThis',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

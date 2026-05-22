import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/foil/',
  plugins: [react()],
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
});

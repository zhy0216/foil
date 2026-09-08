import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { standalonePlugin } from '@foil/editor/build/standalone';
import { extensionPlugin } from './scripts/manifest';

export default defineConfig({
  base: './',
  plugins: [react(), standalonePlugin(), extensionPlugin()],
  resolve: { dedupe: ['react', 'react-dom'], alias: { buffer: 'buffer/' } },
  define: { global: 'globalThis' },
  build: {
    outDir: 'dist',
    target: ['es2020', 'edge88', 'chrome87'],
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background.ts', import.meta.url)),
      },
      output: {
        entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});

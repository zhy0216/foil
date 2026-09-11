// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build, type Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import { describe, expect, it } from 'vitest';

/* The reading surface must stay a self-contained browser bundle: no editor,
   storage, sharing or codec code, no external chunks, no Node builtins, no
   dynamic code execution (extension CSP is script-src 'self'), and it must
   inline into the standalone IIFE constraints used by build/standalone.ts. */

const root = fileURLToPath(new URL('../..', import.meta.url));

// The stable interface task 04 integrates against.
const entrySource = [
  `import { ReadingPreview, CopyMarkdownButton } from ${JSON.stringify(resolve(root, 'src/components/ReadingPreview.tsx'))};`,
  `import { parseReadingDocument, classifyLinkHref } from ${JSON.stringify(resolve(root, 'src/lib/reading-document.ts'))};`,
  `import { locateComments, planFragmentPieces } from ${JSON.stringify(resolve(root, 'src/lib/reading-source-map.ts'))};`,
  'export { ReadingPreview, CopyMarkdownButton, parseReadingDocument, classifyLinkHref, locateComments, planFragmentPieces };',
].join('\n');

const forbidden =
  /\/src\/(?:App\.tsx|components\/(?:Editor|DocSwitcher|Composer|ShareModal|SettingsModal)\.tsx|lib\/(?:doc-store|standalone-runtime-loader|url-codec|html-export|timecapsule[^/]*)\.ts)$/;
const parserPackages =
  /node_modules\/(?:\.bun\/)?(?:micromark|mdast|unist|decode-named-character-reference|character-entities|devlop|ccount|escape-string-regexp|markdown-table|zwitch|longest-streak)/;

async function bundleIife(entry: string): Promise<Rollup.OutputChunk> {
  const result = (await build({
    root,
    configFile: false,
    envFile: false,
    publicDir: false,
    mode: 'production',
    base: './',
    logLevel: 'warn',
    plugins: [react()],
    esbuild: { jsxDev: false },
    resolve: { dedupe: ['react', 'react-dom'] },
    define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      sourcemap: false,
      cssCodeSplit: false,
      modulePreload: false,
      target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
      lib: { entry, formats: ['iife'], name: 'FoilReading' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const output = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
  const chunks = output.filter((item): item is Rollup.OutputChunk => item.type === 'chunk');
  const assets = output.filter((item): item is Rollup.OutputAsset => item.type === 'asset');
  expect(chunks).toHaveLength(1);
  expect(assets).toHaveLength(0);
  expect(chunks[0].imports).toEqual([]);
  expect(chunks[0].dynamicImports).toEqual([]);
  return chunks[0];
}

describe('reading bundle boundary', () => {
  it('builds the reading interface as one self-contained CSP-safe IIFE', async () => {
    const tempDir = mkdtempSync(resolve(root, 'node_modules/.reading-build-'));
    const entry = resolve(tempDir, 'entry.ts');
    const baseline = resolve(tempDir, 'baseline.ts');
    writeFileSync(entry, entrySource);
    writeFileSync(baseline, "import React from 'react';\nexport const version = React.version;\n");
    let chunk: Rollup.OutputChunk;
    let baselineChunk: Rollup.OutputChunk;
    try {
      chunk = await bundleIife(entry);
      baselineChunk = await bundleIife(baseline);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
    expect(chunk.code).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    const modules = Object.keys(chunk.modules);
    for (const id of modules) {
      expect(id.startsWith('node:'), id).toBe(false);
      expect(forbidden.test(id), id).toBe(false);
      expect(id.includes('jsx-dev-runtime'), id).toBe(false);
      expect(/\/node_modules\/buffer\//.test(id), id).toBe(false);
    }
    const sizeOf = (matches: (id: string) => boolean) =>
      Object.entries(chunk.modules)
        .filter(([id]) => matches(id))
        .reduce((sum, [, mod]) => sum + mod.renderedLength, 0);
    const parserBytes = sizeOf((id) => parserPackages.test(id));
    const readingBytes = sizeOf((id) =>
      /\/src\/(?:components\/ReadingPreview\.tsx|lib\/reading-(?:document|source-map)\.ts)$/.test(id));
    const minifiedDelta = chunk.code.length - baselineChunk.code.length;
    console.info(
      `[reading-bundle] iife=${chunk.code.length}B react-baseline=${baselineChunk.code.length}B ` +
        `minified-reading+parser=${minifiedDelta}B pre-minify parser=${parserBytes}B reading=${readingBytes}B modules=${modules.length}`
    );
    expect(parserBytes).toBeGreaterThan(50_000);
    expect(parserBytes).toBeLessThan(500_000);
    expect(minifiedDelta).toBeGreaterThan(20_000);
    expect(minifiedDelta).toBeLessThan(150_000);
    expect(chunk.code.length).toBeLessThan(600_000);
  }, 240_000);
});

import { resolve } from 'node:path';
import { build, type InlineConfig, type Plugin, type Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import { parseStandaloneRuntime, STANDALONE_RESOURCE_FILE, type StandaloneRuntime } from '../src/lib/standalone-runtime';

const forbidden = /\/src\/(?:App\.tsx|components\/(?:Editor|DocSwitcher|Composer)\.tsx|lib\/(?:doc-store|standalone-runtime-loader)\.ts)$/;

/** In-memory nested builds explicitly exclude this plugin and vite.config.ts. */
export async function buildStandaloneRuntime(root: string): Promise<StandaloneRuntime> {
  async function bundle(entry: string, bootstrap: boolean) {
    const config: InlineConfig = {
      root, configFile: false, envFile: false, publicDir: false,
      mode: 'production', base: './', logLevel: 'warn',
      plugins: [react()],
      // The parent dev server keeps NODE_ENV=development. Force production JSX
      // here as well as React's NODE_ENV branch, without mutating that server.
      esbuild: { jsxDev: false },
      resolve: { alias: [{ find: /^buffer\/?$/, replacement: bootstrap ? 'buffer/' : resolve(root, 'src/standalone/buffer.ts') }] },
      define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
      build: {
        write: false, sourcemap: false, cssCodeSplit: false, modulePreload: false,
        target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
        lib: { entry: resolve(root, entry), formats: ['iife'], name: 'FoilStandalone' },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    };
    const result = await build(config) as Rollup.RollupOutput | Rollup.RollupOutput[];
    const output = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
    const chunks = output.filter((item): item is Rollup.OutputChunk => item.type === 'chunk');
    const assets = output.filter((item): item is Rollup.OutputAsset => item.type === 'asset');
    if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length ||
        assets.some(asset => !asset.fileName.endsWith('.css'))) {
      throw new Error('Standalone build must contain one inline script and CSS only');
    }
    const modules = Object.keys(chunks[0].modules);
    if (modules.some(id => forbidden.test(id) || id.includes('foil-standalone.js') || id.includes('jsx-dev-runtime'))) {
      throw new Error('Standalone build imported the editor, storage, website resource loader, or development JSX');
    }
    if (!bootstrap && modules.some(id => /\/node_modules\/buffer\//.test(id))) {
      throw new Error('Standalone program must reuse the bootstrap Buffer');
    }
    const styles = assets.map(asset => typeof asset.source === 'string'
      ? asset.source : new TextDecoder().decode(asset.source)).join('\n');
    // All fonts are system stacks; introducing any external CSS resource needs
    // an explicit implementation, not a silently non-self-contained file.
    if (/@import\b|url\s*\(/i.test(styles)) throw new Error('Standalone CSS requires an external resource');
    return { script: chunks[0].code, styles };
  }
  const bootstrap = await bundle('src/standalone/bootstrap.ts', true);
  const program = await bundle('src/standalone/main.tsx', false);
  // Two separate IIFEs guarantee Buffer initialization before tlock evaluation,
  // independently of Rollup's ordering of inlined dynamic imports.
  return parseStandaloneRuntime({ script: bootstrap.script + '\n' + program.script, styles: program.styles });
}

function resourceModule(runtime: StandaloneRuntime): string {
  return `export default ${JSON.stringify(runtime)};\n`;
}

export function standalonePlugin(): Plugin {
  let root = '', base = '/';
  return {
    name: 'foil-standalone-resources',
    configResolved(config) { root = config.root; base = config.base; },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: STANDALONE_RESOURCE_FILE,
        source: resourceModule(await buildStandaloneRuntime(root)) });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== base + STANDALONE_RESOURCE_FILE && path !== '/' + STANDALONE_RESOURCE_FILE) return next();
        try {
          // Rebuild on demand in dev: no stale cached template after source edits.
          const runtime = await buildStandaloneRuntime(root);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(resourceModule(runtime));
        } catch {
          res.statusCode = 500;
          res.end('HTML reading program could not be built');
        }
      });
    },
  };
}

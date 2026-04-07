/**
 * esbuild build script — bundles agent-gui-server
 *
 * Outputs:
 *   dist/index.js       — CLI entry (ESM, with shebang, directly executable)
 *   dist/lib.bundle.cjs — SDK/library entry (CJS, for Electron runtime require)
 *
 * All runtime dependencies are inlined into the bundle.
 * The packaged Electron client does not need a separate node_modules
 * for agent-gui-server.
 */

import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: [
    'sharp',
    '@nut-tree-fork/*',
    'clipboardy',
  ],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
};

// 1) CLI entry — ESM with shebang
await esbuild.build({
  ...commonOptions,
  entryPoints: ['src/index.ts'],
  format: 'esm',
  outfile: 'dist/index.js',
  banner: { js: '#!/usr/bin/env node' },
  define: {
    'process.env.__GUI_AGENT_PKG_NAME__': JSON.stringify(pkg.name),
    'process.env.__GUI_AGENT_PKG_VERSION__': JSON.stringify(pkg.version),
  },
});

console.log(`[build] dist/index.js built (${pkg.name}@${pkg.version})`);

// 2) SDK/library entry — CJS bundle for Electron runtime require()
await esbuild.build({
  ...commonOptions,
  entryPoints: ['src/lib.ts'],
  format: 'cjs',
  outfile: 'dist/lib.bundle.cjs',
});

console.log(`[build] dist/lib.bundle.cjs built (CJS SDK bundle)`);

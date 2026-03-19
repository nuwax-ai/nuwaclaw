/**
 * esbuild build script — bundles agent-gui-server into a single executable file
 *
 * Output: dist/index.js (with shebang, directly executable)
 *
 * All runtime dependencies are inlined into the bundle.
 * The packaged Electron client does not need a separate node_modules
 * for agent-gui-server.
 */

import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: { js: '#!/usr/bin/env node' },
  // 原生模块不能被 bundle，运行时需要在 node_modules 中可用
  external: [
    'sharp',
    '@nut-tree-fork/*',
    'clipboardy',
  ],
  define: {
    'process.env.__GUI_AGENT_PKG_NAME__': JSON.stringify(pkg.name),
    'process.env.__GUI_AGENT_PKG_VERSION__': JSON.stringify(pkg.version),
  },
  sourcemap: false,
  minify: false,
  legalComments: 'none',
});

console.log(`[build] dist/index.js built (${pkg.name}@${pkg.version})`);

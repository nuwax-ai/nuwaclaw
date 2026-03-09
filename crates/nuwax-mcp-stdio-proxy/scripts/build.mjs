/**
 * esbuild 构建脚本 — 将 nuwax-mcp-stdio-proxy 打成单文件 bundle
 *
 * 产物: dist/index.js (含 shebang, 可直接执行)
 *
 * 所有运行时依赖 (@modelcontextprotocol/sdk 及其 90+ 传递依赖)
 * 全部内联到 bundle 中，打包后的 Electron 客户端不再需要
 * 为 proxy 单独安装 node_modules。
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
  define: {
    'process.env.__MCP_PROXY_PKG_NAME__': JSON.stringify(pkg.name),
    'process.env.__MCP_PROXY_PKG_VERSION__': JSON.stringify(pkg.version),
  },
  // Node.js builtins are external (child_process, http, stream, etc.)
  // esbuild --platform=node handles this automatically
  sourcemap: false,
  minify: false, // Keep readable for debugging
  legalComments: 'none',
});

console.log(`[build] ✅ dist/index.js built (${pkg.name}@${pkg.version})`);

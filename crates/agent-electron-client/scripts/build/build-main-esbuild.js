#!/usr/bin/env node
/**
 * 用 esbuild 把 main 进程(含 preload)bundle 成自包含的 CJS bundle。
 *
 * 目的:把 @nuwax-ai/agent-kit 等纯 JS 依赖直接打进 dist/main/main.js,
 * 避免 electron-builder asar 拒绝 pnpm 符号链接到 appDir 外的 node_modules。
 *
 * 原生模块 / electron / 动态 require 的包仍走 external,运行时从 node_modules 解析。
 *
 * 入口:
 *   src/main/main.ts             -> dist/main/main.js
 *   src/preload/index.ts         -> dist/preload/index.js
 *   src/preload/webviewPerfBridge.ts -> dist/preload/webviewPerfBridge.js
 * outbase=src 保持输出目录结构(匹配 main.ts 里 path.join(__dirname,'..','preload','index.js'))。
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isDev = process.env.NODE_ENV !== 'production';
const root = path.resolve(__dirname, '..', '..');

const ALIASES = [
  ['@main/', 'src/main/'],
  ['@preload/', 'src/preload/'],
  ['@shared/', 'src/shared/'],
];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json'];

/** 解析一个 base 路径到具体文件:先试 base.ext,再试 base/index.ext。 */
function resolveFileOrDir(base) {
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    const idx = path.join(base, 'index' + ext);
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

/** 自定义 resolver:处理 tsconfig paths 别名 + 相对路径 + directory/index。 */
const resolvePlugin = {
  name: 'tsconfig-paths-and-dir-index',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const p = args.path;
      // 跳过 bare 模块名(node_modules / external),交给 esbuild 默认
      if (!p.startsWith('.') && !p.startsWith('@')) {
        return null;
      }
      // 别名:@main/* @preload/* @shared/*
      for (const [prefix, target] of ALIASES) {
        if (p.startsWith(prefix)) {
          const resolved = resolveFileOrDir(
            path.resolve(root, target, p.slice(prefix.length)),
          );
          if (resolved) return { path: resolved };
        }
      }
      // 相对路径
      if (p.startsWith('.')) {
        const resolved = resolveFileOrDir(path.resolve(args.resolveDir, p));
        if (resolved) return { path: resolved };
      }
      return null;
    });
  },
};

const external = [
  'electron',
  'electron-updater',
  'better-sqlite3',
  'sqlite-vec',
  'tar',
  'auto-launch',
  // mcp-proxy 经 dynamic require 加载,保留 external
  '@nuwax-ai/mcp-proxy-ts',
  '@nuwax-ai/mcp-proxy-ts/*',
];

esbuild
  .build({
    entryPoints: [
      'src/main/main.ts',
      'src/preload/index.ts',
      'src/preload/webviewPerfBridge.ts',
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    outbase: 'src',
    outdir: 'dist',
    sourcemap: isDev ? 'inline' : false,
    sourcesContent: false,
    legalComments: 'none',
    resolveExtensions: EXTENSIONS,
    external,
    define: {
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    },
    plugins: [resolvePlugin],
  })
  .then(() => {
    const tag = isDev ? 'dev' : 'prod';
    console.log(`[build:main] esbuild bundle done (${tag})`);
  })
  .catch((err) => {
    console.error('[build:main] esbuild failed:', err);
    process.exit(1);
  });

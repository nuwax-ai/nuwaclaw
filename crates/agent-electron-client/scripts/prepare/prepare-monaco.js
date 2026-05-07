#!/usr/bin/env node
/**
 * 将 monaco-editor 的静态资源（min/vs）复制到 public/ 下，确保 Electron 打包后可离线加载。
 *
 * 目标产物：
 *   public/monaco/vs/**
 *
 * 运行时：
 *   渲染进程通过 @monaco-editor/react 的 loader.config({ paths: { vs: "./monaco/vs" } })
 *   指向该目录。
 */
/* eslint-disable no-console */
'use strict';

const path = require('path');
const fs = require('fs');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const srcVsDir = path.join(projectRoot, 'node_modules', 'monaco-editor', 'min', 'vs');
const destVsDir = path.join(projectRoot, 'public', 'monaco', 'vs');

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function main() {
  if (!fs.existsSync(srcVsDir)) {
    console.error('[prepare-monaco] 未找到 monaco-editor 资源目录:');
    console.error(`  ${srcVsDir}`);
    console.error('[prepare-monaco] 请先执行 npm install');
    process.exit(1);
  }

  // 清理旧产物，避免残留导致加载异常
  if (fs.existsSync(destVsDir)) {
    fs.rmSync(destVsDir, { recursive: true, force: true });
  }

  console.log('[prepare-monaco] 复制 monaco 静态资源...');
  copyDirRecursive(srcVsDir, destVsDir);

  // 基本校验：loader 需要 loader.js
  const loaderJs = path.join(destVsDir, 'loader.js');
  if (!fs.existsSync(loaderJs)) {
    console.warn('[prepare-monaco] ⚠️ 缺少 vs/loader.js，monaco 可能无法加载');
  }

  console.log('[prepare-monaco] ✓ public/monaco/vs 已准备完成');
}

main();


#!/usr/bin/env node
/**
 * 构建前准备 nuwax-mcp-stdio-proxy
 *
 * v1.2.0+ 使用 esbuild 将所有依赖打成单文件 bundle（dist/index.js ~800KB），
 * 不再需要 npm install 安装依赖树。
 *
 * 本脚本仅复制 dist/index.js 和 package.json 到 resources/mcp-proxy/。
 * 打包时 electron-builder 的 extraResources 将 resources/mcp-proxy → .app/Contents/Resources/nuwax-mcp-stdio-proxy
 */

const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const srcPkgDir = path.join(projectRoot, 'node_modules', 'nuwax-mcp-stdio-proxy');
const outputDir = path.join(projectRoot, 'resources', 'mcp-proxy');

function main() {
  console.log('[prepare-mcp-proxy] 准备 nuwax-mcp-stdio-proxy bundle...');

  // 检查源包是否存在
  if (!fs.existsSync(srcPkgDir)) {
    console.error(`[prepare-mcp-proxy] ❌ 源包不存在: ${srcPkgDir}`);
    console.error('[prepare-mcp-proxy] 请先运行 npm install');
    process.exit(1);
  }

  // 检查 bundle 文件存在
  const bundleSrc = path.join(srcPkgDir, 'dist', 'index.js');
  if (!fs.existsSync(bundleSrc)) {
    console.error(`[prepare-mcp-proxy] ❌ bundle 不存在: ${bundleSrc}`);
    console.error('[prepare-mcp-proxy] 需要 nuwax-mcp-stdio-proxy >= 1.2.0');
    process.exit(1);
  }

  // 清理并重建输出目录
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(outputDir, 'dist'), { recursive: true });

  // 复制 bundle
  fs.copyFileSync(bundleSrc, path.join(outputDir, 'dist', 'index.js'));

  // 复制 package.json
  fs.copyFileSync(
    path.join(srcPkgDir, 'package.json'),
    path.join(outputDir, 'package.json'),
  );

  const bundleSize = fs.statSync(path.join(outputDir, 'dist', 'index.js')).size;
  console.log(`[prepare-mcp-proxy] ✅ 完成 — bundle ${(bundleSize / 1024).toFixed(0)} KB`);
}

main();

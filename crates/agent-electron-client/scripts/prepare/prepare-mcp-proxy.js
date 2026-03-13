#!/usr/bin/env node
/**
 * 从 node_modules 复制 nuwax-mcp-stdio-proxy 到 resources/
 *
 * 前提：
 *   1. pnpm install 已执行（workspace 链接生效）
 *   2. nuwax-mcp-stdio-proxy 已构建（npm run build）
 *
 * 产物（3 个文件）：
 *   resources/nuwax-mcp-stdio-proxy/
 *     ├── dist/index.js       — CLI bundle（esbuild 单文件，含 shebang）
 *     ├── dist/lib.bundle.js  — 库 bundle（PersistentMcpBridge 等导出）
 *     └── package.json        — 精简版（name/version/bin/main）
 *
 * 打包时 electron-builder extraResources 会打包到
 *   .app/Contents/Resources/nuwax-mcp-stdio-proxy/
 */

const path = require('path');
const fs = require('fs');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const srcDir = path.join(projectRoot, 'node_modules', 'nuwax-mcp-stdio-proxy');
const destDir = path.join(projectRoot, 'resources', 'nuwax-mcp-stdio-proxy');

function main() {
  // 1. 验证 node_modules 中存在 nuwax-mcp-stdio-proxy
  if (!fs.existsSync(path.join(srcDir, 'package.json'))) {
    console.error(`[prepare-mcp-proxy] node_modules 中未找到 nuwax-mcp-stdio-proxy`);
    console.error('[prepare-mcp-proxy] 请先执行 pnpm install');
    process.exit(1);
  }

  const srcPkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'));
  console.log(`[prepare-mcp-proxy] 源码版本: ${srcPkg.name}@${srcPkg.version}`);

  // 2. 验证必要文件存在
  const srcIndexJs = path.join(srcDir, 'dist', 'index.js');
  const srcLibJs = path.join(srcDir, 'dist', 'lib.js');

  if (!fs.existsSync(srcIndexJs)) {
    console.error(`[prepare-mcp-proxy] CLI 入口不存在: ${srcIndexJs}`);
    console.error('[prepare-mcp-proxy] 请先在 crates/nuwax-mcp-stdio-proxy 中执行 npm run build');
    process.exit(1);
  }

  if (!fs.existsSync(srcLibJs)) {
    console.error(`[prepare-mcp-proxy] 库入口不存在: ${srcLibJs}`);
    console.error('[prepare-mcp-proxy] 请先在 crates/nuwax-mcp-stdio-proxy 中执行 npm run build');
    process.exit(1);
  }

  // 3. 检查目标是否已是最新版本
  const destPkgPath = path.join(destDir, 'package.json');
  if (fs.existsSync(destPkgPath)) {
    try {
      const destPkg = JSON.parse(fs.readFileSync(destPkgPath, 'utf8'));
      if (destPkg.version === srcPkg.version) {
        const destIndexJs = path.join(destDir, 'dist', 'index.js');
        const destLibJs = path.join(destDir, 'dist', 'lib.bundle.js');
        if (fs.existsSync(destIndexJs) && fs.existsSync(destLibJs)) {
          console.log(`[prepare-mcp-proxy] ${srcPkg.version} 已是最新，跳过`);
          return;
        }
      }
    } catch {
      // 目标损坏，重新复制
    }
  }

  // 4. 构建 lib bundle（使用 esbuild）
  console.log('[prepare-mcp-proxy] 构建 lib bundle (esbuild)...');
  const esbuildBin = path.join(srcDir, 'node_modules', '.bin', 'esbuild');

  // 如果 proxy 包中没有 esbuild，使用项目根目录的 esbuild
  const esbuildToUse = fs.existsSync(esbuildBin)
    ? esbuildBin
    : path.join(projectRoot, 'node_modules', '.bin', 'esbuild');

  // Windows 兼容
  const esbuildCmd = process.platform === 'win32' && !esbuildToUse.endsWith('.cmd')
    ? esbuildToUse + '.cmd'
    : esbuildToUse;

  const libEntry = srcLibJs;
  const libBundlePath = path.join(srcDir, 'dist', 'lib.bundle.js');

  const { execSync } = require('child_process');
  try {
    execSync(
      `"${esbuildCmd}" "${libEntry}" --bundle --platform=node --target=node22 --format=cjs --outfile="${libBundlePath}" --legal-comments=none`,
      { cwd: srcDir, stdio: 'inherit' },
    );
  } catch (e) {
    console.error('[prepare-mcp-proxy] esbuild 打包失败，尝试直接复制 lib.js');
    // 如果 esbuild 失败，直接使用 lib.js 作为 lib.bundle.js
    if (fs.existsSync(libEntry)) {
      fs.copyFileSync(libEntry, libBundlePath);
    } else {
      console.error('[prepare-mcp-proxy] lib.js 也不存在，无法继续');
      process.exit(1);
    }
  }

  // 5. 复制到 resources/nuwax-mcp-stdio-proxy/
  console.log('[prepare-mcp-proxy] 复制到 resources/nuwax-mcp-stdio-proxy/...');

  // 清理目标目录
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(path.join(destDir, 'dist'), { recursive: true });

  // 复制 dist/index.js (CLI bundle)
  const destIndexJs = path.join(destDir, 'dist', 'index.js');
  fs.copyFileSync(srcIndexJs, destIndexJs);
  fs.chmodSync(destIndexJs, 0o755);
  console.log(`  dist/index.js (${(fs.statSync(destIndexJs).size / 1024).toFixed(0)} KB)`);

  // 复制 dist/lib.bundle.js (library bundle)
  const destLibJs = path.join(destDir, 'dist', 'lib.bundle.js');
  fs.copyFileSync(libBundlePath, destLibJs);
  console.log(`  dist/lib.bundle.js (${(fs.statSync(destLibJs).size / 1024).toFixed(0)} KB)`);

  // 6. 生成精简版 package.json
  const slimPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    bin: { 'nuwax-mcp-stdio-proxy': './dist/index.js' },
    main: './dist/lib.bundle.js',
  };
  fs.writeFileSync(destPkgPath, JSON.stringify(slimPkg, null, 2) + '\n');
  console.log('  package.json (slim)');

  console.log(`[prepare-mcp-proxy] ✓ resources/nuwax-mcp-stdio-proxy/ (${srcPkg.version})`);
}

main();

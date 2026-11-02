#!/usr/bin/env node
/**
 * 从 node_modules 复制 @nuwax-ai/nuwax-codex-acp-ts（TS adapter）到 resources/。
 *
 * adapter `dist/index.js` 是 esbuild 自包含 bundle（@agentclientprotocol/sdk /
 * diff / open / vscode-jsonrpc / zod 全部内联），外部 require 仅 node 内置 +
 * `nuwax-codex`（adapter 读 nuwax-codex/package.json 的 version）。
 * 自 v1.2.5 起，原生二进制由 adapter postinstall 下载到包根的
 * `vendor/nuwax-codex/<ver>/`（非隐藏目录，便于 electron-builder / after-sign 重签）。
 *
 * 产物（resources/nuwax-codex-acp-ts/）：
 *   ├── dist/index.js                       adapter bundle（自包含；CJS via createRequire）
 *   ├── package.json                        精简（name/version/bin/main）
 *   ├── node_modules/nuwax-codex/package.json   adapter require.resolve 目标 + 读 version
 *   └── vendor/nuwax-codex/<ver>/nuwax-codex     原生二进制（postinstall 下载）
 *
 * 运行时 adapter spawn 链：spawn(node, [<resources>/nuwax-codex-acp-ts/dist/index.js])
 *   → adapter require("nuwax-codex/package.json").version
 *   → resolveCodexBinaryPath: <pkgRoot>/vendor/nuwax-codex/<ver>/nuwax-codex
 *     = <resources>/nuwax-codex-acp-ts/vendor/nuwax-codex/<ver>/nuwax-codex
 *
 * 前提：pnpm install 已执行 + adapter postinstall 已跑（pnpm.onlyBuiltDependencies
 * 含 adapter，根 package.json 已配）。打包时 electron-builder extraResources 会打包到
 * .app/Contents/Resources/nuwax-codex-acp-ts/。
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const { getProjectRoot } = require('../utils/project-paths');

const PKG_NAME = '@nuwax-ai/nuwax-codex-acp-ts';
const BUNDLED_DIR_NAME = 'nuwax-codex-acp-ts';

const projectRoot = getProjectRoot();

function main() {
  // 1. 定位 adapter 真实路径（pnpm symlink → require.resolve）
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  let adapterPkgPath;
  try {
    adapterPkgPath = projectRequire.resolve(`${PKG_NAME}/package.json`);
  } catch {
    console.error(`[prepare-codex-acp-ts] node_modules 中未找到 ${PKG_NAME}`);
    console.error('[prepare-codex-acp-ts] 请先执行 pnpm install');
    process.exit(1);
  }
  const srcDir = path.dirname(adapterPkgPath);
  const srcPkg = JSON.parse(fs.readFileSync(adapterPkgPath, 'utf8'));
  console.log(`[prepare-codex-acp-ts] 源: ${srcPkg.name}@${srcPkg.version}`);

  const srcIndexJs = path.join(srcDir, 'dist', 'index.js');
  if (!fs.existsSync(srcIndexJs)) {
    console.error(`[prepare-codex-acp-ts] dist/index.js 不存在: ${srcIndexJs}`);
    process.exit(1);
  }

  // 2. 读取 nuwax-codex 版本（adapter 运行时 require 的 version 目标）
  const adapterRequire = createRequire(srcIndexJs);
  let nuwaxCodexPkgPath;
  try {
    nuwaxCodexPkgPath = adapterRequire.resolve('nuwax-codex/package.json');
  } catch {
    console.error('[prepare-codex-acp-ts] adapter 的 nuwax-codex 依赖未找到');
    console.error('[prepare-codex-acp-ts] 请确认 adapter postinstall 已跑（pnpm.onlyBuiltDependencies）');
    process.exit(1);
  }
  const nuwaxCodexPkg = JSON.parse(fs.readFileSync(nuwaxCodexPkgPath, 'utf8'));
  const nuwaxCodexVer = nuwaxCodexPkg.version;
  const binaryName = process.platform === 'win32' ? 'nuwax-codex.exe' : 'nuwax-codex';

  // adapter resolveCodexBinaryPath（v1.2.5+）: <pkgRoot>/vendor/nuwax-codex/<ver>/<binaryName>
  const vendorBinary = path.join(srcDir, 'vendor', 'nuwax-codex', nuwaxCodexVer, binaryName);
  if (!fs.existsSync(vendorBinary)) {
    console.error(`[prepare-codex-acp-ts] codex 二进制不存在: ${vendorBinary}`);
    console.error('[prepare-codex-acp-ts] 请确认 adapter postinstall 已跑（下载 vendor 二进制）');
    process.exit(1);
  }

  // 3. 复制到 resources/nuwax-codex-acp-ts/
  const destDir = path.join(projectRoot, 'resources', BUNDLED_DIR_NAME);
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true });
  fs.mkdirSync(path.join(destDir, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(destDir, 'node_modules', 'nuwax-codex'), { recursive: true });
  fs.mkdirSync(path.join(destDir, 'vendor', 'nuwax-codex', nuwaxCodexVer), { recursive: true });

  // dist/index.js（adapter bundle）
  const destIndexJs = path.join(destDir, 'dist', 'index.js');
  fs.copyFileSync(srcIndexJs, destIndexJs);
  fs.chmodSync(destIndexJs, 0o755);
  console.log(`  dist/index.js (${(fs.statSync(destIndexJs).size / 1024 / 1024).toFixed(1)} MB)`);

  // node_modules/nuwax-codex/package.json（adapter require.resolve 目标 + 读 version）
  fs.copyFileSync(
    nuwaxCodexPkgPath,
    path.join(destDir, 'node_modules', 'nuwax-codex', 'package.json'),
  );

  // vendor/nuwax-codex/<ver>/nuwax-codex（二进制）
  const destBinary = path.join(destDir, 'vendor', 'nuwax-codex', nuwaxCodexVer, binaryName);
  fs.copyFileSync(vendorBinary, destBinary);
  fs.chmodSync(destBinary, 0o755);
  // macOS ad-hoc 签名（arm64 运行所需占位签名；正式 Developer ID 签名由 after-sign.js 覆盖）
  if (process.platform === 'darwin') {
    try {
      require('child_process').execSync(
        `codesign --force --sign - "${destBinary}"`,
        { stdio: 'pipe' },
      );
      console.log(`  codesign (ad-hoc): ${binaryName}`);
    } catch (err) {
      console.warn(
        `[prepare-codex-acp-ts] codesign failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  console.log(`  vendor/nuwax-codex/${nuwaxCodexVer}/${binaryName} (${(fs.statSync(vendorBinary).size / 1024 / 1024).toFixed(0)} MB)`);

  // 精简 package.json
  const slimPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    bin: { 'nuwax-codex-acp-ts': './dist/index.js' },
    main: './dist/index.js',
  };
  fs.writeFileSync(path.join(destDir, 'package.json'), JSON.stringify(slimPkg, null, 2) + '\n');

  console.log(`[prepare-codex-acp-ts] ✓ resources/${BUNDLED_DIR_NAME}/ (${srcPkg.version})`);
}

main();

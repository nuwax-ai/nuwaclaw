#!/usr/bin/env node
/**
 * 多平台 nuwax-lanproxy 集成：构建前按当前平台准备 resources/lanproxy/bin/
 *
 * 源：resources/lanproxy/binaries/ 下的多平台二进制
 *     文件名格式：nuwax-lanproxy-<rust-target>[.exe]
 *
 * 目标：resources/lanproxy/bin/nuwax-lanproxy (或 .exe)
 *
 * 打包时 electron-builder 的 extraResources 会打包
 *   resources/lanproxy → .app/Contents/Resources/lanproxy
 * 运行时 getLanproxyBinPath() 使用 Resources/lanproxy/bin/nuwax-lanproxy
 *
 * 平台映射 (Node → Rust target)：
 *   darwin-arm64  → aarch64-apple-darwin
 *   darwin-x64    → x86_64-apple-darwin
 *   win32-x64     → x86_64-pc-windows-msvc
 *   linux-x64     → x86_64-unknown-linux-gnu
 *   linux-arm64   → aarch64-unknown-linux-gnu (fallback to armv7)
 *   linux-arm     → arm-unknown-linux-gnueabi
 */

const path = require('path');
const fs = require('fs');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const srcBinDir = path.join(projectRoot, 'resources', 'lanproxy', 'binaries');
const destBinDir = path.join(projectRoot, 'resources', 'lanproxy', 'bin');

// Node platform-arch → Rust target triple
const PLATFORM_MAP = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-ia32': 'i686-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-arm': 'arm-unknown-linux-gnueabi',
};

// Fallback mappings when primary binary is not available
const FALLBACK_MAP = {
  'linux-arm64': ['armv7-unknown-linux-gnueabihf', 'arm-unknown-linux-gnueabi'],
  'darwin-arm64': ['universal-apple-darwin'],
};

function getPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function main() {
  const key = getPlatformKey();
  const target = PLATFORM_MAP[key];

  if (!target) {
    console.error(`[prepare-lanproxy] 不支持的平台: ${key}`);
    console.error(`[prepare-lanproxy] 支持的平台: ${Object.keys(PLATFORM_MAP).join(', ')}`);
    process.exit(1);
  }

  const isWin = process.platform === 'win32';
  const srcName = `nuwax-lanproxy-${target}${isWin ? '.exe' : ''}`;
  const destName = `nuwax-lanproxy${isWin ? '.exe' : ''}`;

  let srcPath = path.join(srcBinDir, srcName);
  const destPath = path.join(destBinDir, destName);

  // 检查源文件，尝试 fallback
  if (!fs.existsSync(srcPath)) {
    const fallbackTargets = FALLBACK_MAP[key];
    if (fallbackTargets) {
      for (const fallback of fallbackTargets) {
        const fallbackPath = path.join(srcBinDir, `nuwax-lanproxy-${fallback}${isWin ? '.exe' : ''}`);
        if (fs.existsSync(fallbackPath)) {
          console.warn(`[prepare-lanproxy] ${key}: ${srcName} 不存在，使用 fallback: ${fallback}`);
          if (key === 'linux-arm64') {
            console.warn(`[prepare-lanproxy] ⚠️  ARM32 binary on ARM64 may not work on all systems`);
          }
          srcPath = fallbackPath;
          break;
        }
      }
    }
  }

  // 如果源文件仍不存在，创建空目录并继续
  if (!fs.existsSync(srcPath)) {
    console.warn(`[prepare-lanproxy] 源文件不存在: ${srcPath}，将跳过 lanproxy 二进制（安装包可正常产出，运行时内网穿透不可用）`);
    fs.mkdirSync(destBinDir, { recursive: true });
    return;
  }

  // 如果目标已存在且大小一致，跳过
  if (fs.existsSync(destPath)) {
    const srcStat = fs.statSync(srcPath);
    const destStat = fs.statSync(destPath);
    if (srcStat.size === destStat.size) {
      console.log(`[prepare-lanproxy] ${key} → ${destName} (已是最新，跳过)`);
      return;
    }
  }

  // 复制
  const srcBasename = path.basename(srcPath);
  console.log(`[prepare-lanproxy] ${key} → ${srcBasename}`);
  fs.mkdirSync(destBinDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  fs.chmodSync(destPath, 0o755);
  console.log(`[prepare-lanproxy] ✓ ${destPath} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

main();

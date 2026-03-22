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
 * 运行时 getLanproxyBinPath() 优先用 lanproxy/binaries/<平台名>，其次 bin/nuwax-lanproxy[.exe]
 *
 * 平台映射 (Node → Rust target)：
 *   darwin-arm64  → aarch64-apple-darwin
 *   darwin-x64    → x86_64-apple-darwin
 *   win32-x64     → x86_64-pc-windows-msvc
 *   linux-x64     → x86_64-unknown-linux-gnu
 *   linux-arm64   → aarch64-unknown-linux-gnu
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
};

// Fallback for macOS arm64 (universal binary)
function getFallbackPath(key) {
  if (key === 'darwin-arm64') {
    return 'nuwax-lanproxy-universal-apple-darwin';
  }
  return null;
}

function getPlatformKey() {
  const a = process.env.TARGET_ARCH || process.arch;
  return `${process.platform}-${a}`;
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

  // macOS arm64: 尝试 universal binary 作为 fallback
  if (!fs.existsSync(srcPath)) {
    const fallbackName = getFallbackPath(key);
    if (fallbackName) {
      const fallbackPath = path.join(srcBinDir, fallbackName);
      if (fs.existsSync(fallbackPath)) {
        console.log(`[prepare-lanproxy] ${key} → ${fallbackName} (fallback)`);
        srcPath = fallbackPath;
      }
    }
  }

  // 如果源文件仍不存在，创建空目录并继续
  if (!fs.existsSync(srcPath)) {
    console.warn(`[prepare-lanproxy] 源文件不存在: ${srcPath}，将跳过 lanproxy 二进制（安装包可正常产出，运行时内网穿透不可用）`);
    fs.mkdirSync(destBinDir, { recursive: true });
    return;
  }

  // 如果目标已存在且大小一致，检查架构匹配
  const platformKeyFile = path.join(destBinDir, '.platform-key');
  if (fs.existsSync(destPath)) {
    if (fs.existsSync(platformKeyFile)) {
      const existingKey = fs.readFileSync(platformKeyFile, 'utf-8').trim();
      if (existingKey !== key) {
        console.log(`[prepare-lanproxy] 架构不匹配: 已有 ${existingKey}, 需要 ${key}, 清理并重新复制`);
        fs.rmSync(destBinDir, { recursive: true, force: true });
      } else {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (srcStat.size === destStat.size) {
          console.log(`[prepare-lanproxy] ${key} → ${destName} (已是最新，跳过)`);
          return;
        }
      }
    } else {
      // No .platform-key — legacy check by size only
      const srcStat = fs.statSync(srcPath);
      const destStat = fs.statSync(destPath);
      if (srcStat.size === destStat.size) {
        console.log(`[prepare-lanproxy] ${key} → ${destName} (已是最新，跳过)`);
        return;
      }
    }
  }

  // 复制
  const srcBasename = path.basename(srcPath);
  console.log(`[prepare-lanproxy] ${key} → ${srcBasename}`);
  fs.mkdirSync(destBinDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  fs.chmodSync(destPath, 0o755);
  fs.writeFileSync(platformKeyFile, key, 'utf-8');
  console.log(`[prepare-lanproxy] ✓ ${destPath} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`[prepare-lanproxy] 已写入 .platform-key: ${key}`);
}

main();

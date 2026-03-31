#!/usr/bin/env node
/**
 * nuwaxcode 多平台集成：准备 resources/nuwaxcode/{platform}/bin/
 *
 * 两种模式：
 * 1) 本地 dist 复制（设置 NUWAXCODE_DIST_DIR 环境变量，开发调试用）
 *    NUWAXCODE_DIST_DIR=~/workspace/nuwaxcode/packages/opencode/dist npm run prepare:nuwaxcode
 * 2) GitHub Release 下载（默认，CI/正式构建用）
 *    npm run prepare:nuwaxcode
 *
 * 打包时 electron-builder extraResources 将 resources/nuwaxcode 打包到应用内
 * 运行时 getNuwaxcodeBundledBinPath() 解析对应平台二进制
 *
 * 用法：
 *   node scripts/prepare/prepare-nuwaxcode.js              # 当前平台
 *   node scripts/prepare/prepare-nuwaxcode.js --all        # 全平台
 *
 * 环境变量：
 *   NUWAXCODE_DIST_DIR     — nuwaxcode 本地构建产物目录（设置后走本地复制模式）
 *   NUWAXCODE_REPO         — GitHub 仓库（默认 nuwax-ai/nuwaxcode）
 *   GITHUB_TOKEN           — GitHub token（私有仓库或提高速率限制用）
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const NUWAXCODE_VERSION = '1.1.67';
const NUWAXCODE_REPO = process.env.NUWAXCODE_REPO || 'nuwax-ai/nuwaxcode';

const projectRoot = getProjectRoot();
const resDir = path.join(projectRoot, 'resources', 'nuwaxcode');
const cacheDir = path.join(projectRoot, 'scripts', 'resources', 'nuwaxcode-cache');

// Node platform-arch → dist 文件夹名 / Release asset 名
const PLATFORM_MAP = {
  'darwin-arm64': 'nuwaxcode-darwin-arm64',
  'darwin-x64': 'nuwaxcode-darwin-x64',
  'linux-arm64': 'nuwaxcode-linux-arm64',
  'linux-arm64-musl': 'nuwaxcode-linux-arm64-musl',
  'linux-x64': 'nuwaxcode-linux-x64',
  'linux-x64-musl': 'nuwaxcode-linux-x64-musl',
  'win32-x64': 'nuwaxcode-windows-x64',
};

// 资源目录名需与运行时 getNuwaxcodeBundledBinPath() 一致
const RESOURCE_PLATFORM_KEY_MAP = {
  'win32-x64': 'windows-x64',
};

function getPlatformKey() {
  const a = process.env.TARGET_ARCH || process.arch;
  return `${process.platform}-${a}`;
}

function getResourcePlatformKey(key) {
  return RESOURCE_PLATFORM_KEY_MAP[key] || key;
}

function isWindows(key) {
  return key.startsWith('win32');
}

function getBinaryName(key) {
  return isWindows(key) ? 'nuwaxcode.exe' : 'nuwaxcode';
}

// ==================== 模式 1: 本地 dist 复制 ====================

function copyFromDist(key) {
  const nuwaxcodeDist = process.env.NUWAXCODE_DIST_DIR || path.join(
    process.env.HOME || '/root',
    'workspace/nuwaxcode/packages/opencode/dist',
  );
  const distName = PLATFORM_MAP[key];
  if (!distName) {
    console.error(`[prepare-nuwaxcode] 不支持的平台: ${key}`);
    return false;
  }

  const resourceKey = getResourcePlatformKey(key);
  const binary = getBinaryName(key);
  const srcPath = path.join(nuwaxcodeDist, distName, 'bin', binary);
  const destDir = path.join(resDir, resourceKey, 'bin');
  const destPath = path.join(destDir, binary);

  if (!fs.existsSync(srcPath)) {
    console.warn(`[prepare-nuwaxcode] ${key}: 构建产物不存在 ${srcPath}`);
    return false;
  }

  // 检查是否已是最新（大小一致 + 版本匹配）
  if (fs.existsSync(destPath)) {
    const versionFile = path.join(resDir, '.version');
    if (fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf-8').trim() === NUWAXCODE_VERSION) {
      const srcSize = fs.statSync(srcPath).size;
      const destSize = fs.statSync(destPath).size;
      if (srcSize === destSize) {
        console.log(`[prepare-nuwaxcode] ${key} ✓ (已是最新，跳过)`);
        return true;
      }
    }
  }

  // 复制
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  fs.chmodSync(destPath, 0o755);

  const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
  console.log(`[prepare-nuwaxcode] ${key} ✓ 从本地 dist 复制 (${sizeMB} MB)`);

  // macOS ad-hoc 签名
  codesign(destPath, key);

  return true;
}

// ==================== 模式 2: GitHub Release 下载 ====================

/**
 * 下载文件到缓存目录
 */
function download(url, preferredFilename) {
  return new Promise((resolve, reject) => {
    const filename = preferredFilename || path.basename(url.split('?')[0]) || 'download';
    const file = path.join(cacheDir, filename);

    // 缓存检查
    if (fs.existsSync(file)) {
      try {
        const stats = fs.statSync(file);
        if (stats.size > 100 * 1024) {
          console.log(`[prepare-nuwaxcode] 使用缓存: ${filename} (${Math.round(stats.size / 1024 / 1024)} MB)`);
          resolve(file);
          return;
        }
      } catch (_) {}
      try { fs.unlinkSync(file); } catch (_) {}
    }

    const headers = { 'User-Agent': 'NuwaClaw-Build' };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    fs.mkdirSync(cacheDir, { recursive: true });
    const doRequest = (reqUrl, redirects) => {
      if (redirects > 10) return reject(new Error('Too many redirects'));
      https.get(reqUrl, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const loc = res.headers.location;
          const nextUrl = loc.startsWith('http') ? loc : new URL(loc, reqUrl).href;
          doRequest(nextUrl, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          try { fs.unlinkSync(file); } catch (_) {}
          return reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
        }
        const stream = fs.createWriteStream(file);
        res.pipe(stream);
        stream.on('finish', () => { stream.close(); resolve(file); });
        stream.on('error', (e) => {
          stream.close();
          try { fs.unlinkSync(file); } catch (_) {}
          reject(e);
        });
      }).on('error', reject);
    };
    doRequest(url, 0);
  });
}

/**
 * 从 GitHub Release 下载并解压
 */
async function downloadFromRelease(key) {
  const distName = PLATFORM_MAP[key];
  if (!distName) {
    console.error(`[prepare-nuwaxcode] 不支持的平台: ${key}`);
    return false;
  }

  const resourceKey = getResourcePlatformKey(key);
  const binary = getBinaryName(key);
  const destDir = path.join(resDir, resourceKey, 'bin');
  const destPath = path.join(destDir, binary);

  // 检查是否已是最新（版本匹配 + 文件存在）
  const versionFile = path.join(resDir, '.version');
  if (fs.existsSync(destPath) && fs.existsSync(versionFile)) {
    if (fs.readFileSync(versionFile, 'utf-8').trim() === NUWAXCODE_VERSION) {
      const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
      console.log(`[prepare-nuwaxcode] ${key} ✓ (已是最新 ${sizeMB} MB，跳过下载)`);
      return true;
    }
  }

  // Release asset: nuwaxcode-{platform}-{arch}.tar.gz
  const assetName = `${distName}.tar.gz`;
  const downloadUrl = `https://github.com/${NUWAXCODE_REPO}/releases/download/v${NUWAXCODE_VERSION}/${assetName}`;

  console.log(`[prepare-nuwaxcode] ${key}: 下载 ${assetName} ...`);

  try {
    const archivePath = await download(downloadUrl, assetName);

    // 解压到临时目录
    const extractDir = path.join(cacheDir, `extract-${key}`);
    if (fs.existsSync(extractDir)) {
      try { fs.rmSync(extractDir, { recursive: true }); } catch (_) {}
    }
    fs.mkdirSync(extractDir, { recursive: true });
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { stdio: 'pipe' });

    // 查找二进制文件：可能在 package/bin/ 或 bin/ 下
    const binaryPath = findBinary(extractDir, binary);
    if (!binaryPath) {
      console.error(`[prepare-nuwaxcode] ${key}: 解压后未找到 ${binary}`);
      return false;
    }

    // 复制到目标
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(binaryPath, destPath);
    fs.chmodSync(destPath, 0o755);

    const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
    console.log(`[prepare-nuwaxcode] ${key} ✓ 从 GitHub Release 下载 (${sizeMB} MB)`);

    // macOS ad-hoc 签名
    codesign(destPath, key);

    return true;
  } catch (err) {
    console.error(`[prepare-nuwaxcode] ${key}: 下载失败: ${err.message}`);
    console.error(`[prepare-nuwaxcode] 请确认 GitHub Release 存在: https://github.com/${NUWAXCODE_REPO}/releases/tag/v${NUWAXCODE_VERSION}`);
    return false;
  }
}

/**
 * 在解压目录中递归查找二进制文件
 */
function findBinary(dir, binaryName) {
  // 直接在 dir/bin/ 下
  const direct = path.join(dir, 'bin', binaryName);
  if (fs.existsSync(direct)) return direct;

  // 在 dir/package/bin/ 下（npm tarball 结构）
  const pkgBin = path.join(dir, 'package', 'bin', binaryName);
  if (fs.existsSync(pkgBin)) return pkgBin;

  // 递归搜索（最多 3 层）
  return _findRecursive(dir, binaryName, 3);
}

function _findRecursive(dir, binaryName, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === binaryName) return fullPath;
      if (entry.isDirectory()) {
        const found = _findRecursive(fullPath, binaryName, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

// ==================== 通用 ====================

function codesign(binaryPath, key) {
  if (process.platform === 'darwin') {
    try {
      execSync(`codesign --force --sign - "${binaryPath}"`, { stdio: 'pipe' });
    } catch {
      console.warn(`[prepare-nuwaxcode] ${key} 签名失败（不影响功能）`);
    }
  }
}

async function main() {
  const allPlatforms = process.argv.includes('--all') || process.argv.includes('--all-platforms');
  const useLocalDist = !!process.env.NUWAXCODE_DIST_DIR;
  const mode = useLocalDist ? '本地 dist 复制' : 'GitHub Release 下载';

  fs.mkdirSync(resDir, { recursive: true });

  const keys = allPlatforms ? Object.keys(PLATFORM_MAP) : [getPlatformKey()];

  console.log(`[prepare-nuwaxcode] 模式: ${mode}`);
  console.log(`[prepare-nuwaxcode] 版本: v${NUWAXCODE_VERSION}`);
  console.log(`[prepare-nuwaxcode] 平台: ${keys.join(', ')}`);

  if (!allPlatforms && !PLATFORM_MAP[keys[0]]) {
    console.error(`[prepare-nuwaxcode] 不支持的平台: ${keys[0]}`);
    console.error(`[prepare-nuwaxcode] 支持的平台: ${Object.keys(PLATFORM_MAP).join(', ')}`);
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;

  for (const key of keys) {
    const success = useLocalDist ? copyFromDist(key) : await downloadFromRelease(key);
    if (success) {
      ok++;
    } else {
      fail++;
    }
  }

  if (ok > 0) {
    // 写入版本标记
    fs.writeFileSync(path.join(resDir, '.version'), NUWAXCODE_VERSION, 'utf-8');
    console.log(`[prepare-nuwaxcode] ✓ 版本: ${NUWAXCODE_VERSION}`);
  }

  console.log(`[prepare-nuwaxcode] 完成: ${ok} 成功, ${fail} 失败`);

  if (fail > 0 && !allPlatforms) {
    process.exit(1);
  }
}

main();

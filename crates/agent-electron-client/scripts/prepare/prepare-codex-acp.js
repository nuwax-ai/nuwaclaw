#!/usr/bin/env node
/**
 * codex-acp 多平台集成：准备 resources/codex-acp/{platform}/bin/
 *
 * 从 GitHub Release 下载预编译的 codex-acp Rust 二进制。
 *
 * 用法：
 *   node scripts/prepare/prepare-codex-acp.js              # 当前平台
 *   node scripts/prepare/prepare-codex-acp.js --all        # 全平台
 *
 * 环境变量：
 *   CODEX_ACP_VERSION    — 版本号（默认 0.4.2）
 *   CODEX_ACP_REPO       — GitHub 仓库（默认 cola-io/codex-acp）
 *   GITHUB_TOKEN         — GitHub token（提高速率限制）
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const { execFileSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const CODEX_ACP_VERSION = process.env.CODEX_ACP_VERSION || '0.4.2';
const CODEX_ACP_REPO = process.env.CODEX_ACP_REPO || 'cola-io/codex-acp';

const projectRoot = getProjectRoot();
const resDir = path.join(projectRoot, 'resources', 'codex-acp');
const cacheDir = path.join(projectRoot, 'scripts', 'resources', 'codex-acp-cache');

// Node platform-arch → Rust target triple → asset suffix
const PLATFORM_MAP = {
  'darwin-arm64': { target: 'aarch64-apple-darwin', ext: 'tar.gz' },
  'linux-x64':    { target: 'x86_64-unknown-linux-gnu', ext: 'tar.gz' },
  'win32-x64':    { target: 'x86_64-pc-windows-msvc', ext: 'zip' },
};

// 资源目录名需与运行时 getCodexAcpBundledBinPath() 一致
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
  return isWindows(key) ? 'codex-acp.exe' : 'codex-acp';
}

// ==================== 下载 & 解压 ====================

function sha256File(filePath) {
  try {
    return execFileSync('shasum', ['-a', '256', filePath], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split(/\s+/)[0];
  } catch {
    const crypto = require('crypto');
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

function download(url, preferredFilename, options = {}) {
  const force = !!options.force;
  return new Promise((resolve, reject) => {
    const filename = preferredFilename || path.basename(url.split('?')[0]) || 'download';
    const file = path.join(cacheDir, filename);

    if (!force && fs.existsSync(file)) {
      try {
        const stats = fs.statSync(file);
        if (stats.size > 1024) {
          console.log(`[prepare-codex-acp] 使用缓存: ${filename} (${Math.round(stats.size / 1024 / 1024)} MB)`);
          resolve(file);
          return;
        }
      } catch (_) {}
      try { fs.unlinkSync(file); } catch (_) {}
    }

    if (force && fs.existsSync(file)) {
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

function findBinary(dir, binaryName) {
  const direct = path.join(dir, 'bin', binaryName);
  if (fs.existsSync(direct)) return direct;
  const pkgBin = path.join(dir, 'package', 'bin', binaryName);
  if (fs.existsSync(pkgBin)) return pkgBin;
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

async function downloadFromRelease(key) {
  const info = PLATFORM_MAP[key];
  if (!info) {
    console.error(`[prepare-codex-acp] 不支持的平台: ${key}`);
    return false;
  }

  const resourceKey = getResourcePlatformKey(key);
  const binary = getBinaryName(key);
  const destDir = path.join(resDir, resourceKey, 'bin');
  const destPath = path.join(destDir, binary);

  // 检查是否已是最新
  const versionFile = path.join(resDir, '.version');
  if (fs.existsSync(destPath) && fs.existsSync(versionFile)) {
    if (fs.readFileSync(versionFile, 'utf-8').trim() === CODEX_ACP_VERSION) {
      const shaFile = path.join(resDir, `.sha256-${resourceKey}`);
      if (fs.existsSync(shaFile)) {
        const expectedHash = fs.readFileSync(shaFile, 'utf-8').trim();
        const currentHash = sha256File(destPath);
        if (currentHash === expectedHash) {
          const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
          console.log(`[prepare-codex-acp] ${key} ✓ (已是最新 ${sizeMB} MB)`);
          return true;
        }
      }
    }
  }

  const assetName = `codex-acp-v${CODEX_ACP_VERSION}-${info.target}.${info.ext}`;
  const downloadUrl = `https://github.com/${CODEX_ACP_REPO}/releases/download/v${CODEX_ACP_VERSION}/${assetName}`;

  console.log(`[prepare-codex-acp] ${key}: 下载 ${assetName} ...`);

  try {
    const archivePath = await download(downloadUrl, assetName);

    const extractDir = path.join(cacheDir, `extract-${key}`);
    if (fs.existsSync(extractDir)) {
      try { fs.rmSync(extractDir, { recursive: true }); } catch (_) {}
    }
    fs.mkdirSync(extractDir, { recursive: true });

    if (info.ext === 'zip') {
      // Windows: use unzip
      const { execFileSync: efs } = require('child_process');
      efs('unzip', ['-q', archivePath, '-d', extractDir], { stdio: 'pipe' });
    } else {
      // tar.gz
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'pipe' });
    }

    const binaryPath = findBinary(extractDir, binary);
    if (!binaryPath) {
      console.error(`[prepare-codex-acp] ${key}: 解压后未找到 ${binary}`);
      return false;
    }

    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(binaryPath, destPath);
    fs.chmodSync(destPath, 0o755);

    // macOS ad-hoc 签名
    if (process.platform === 'darwin') {
      try {
        require('child_process').execSync(`codesign --force --sign - "${destPath}"`, { stdio: 'pipe' });
      } catch {}
    }

    const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
    const hash = sha256File(destPath);
    console.log(`[prepare-codex-acp] ${key} ✓ 下载完成 (${sizeMB} MB, SHA256=${hash.slice(0, 16)}...)`);

    fs.writeFileSync(path.join(resDir, `.sha256-${resourceKey}`), hash, 'utf-8');
    return true;
  } catch (err) {
    console.error(`[prepare-codex-acp] ${key}: 下载失败: ${err.message}`);
    console.error(`[prepare-codex-acp] 请确认 GitHub Release 存在: https://github.com/${CODEX_ACP_REPO}/releases/tag/v${CODEX_ACP_VERSION}`);
    return false;
  }
}

async function main() {
  const allPlatforms = process.argv.includes('--all') || process.argv.includes('--all-platforms');

  fs.mkdirSync(resDir, { recursive: true });

  const keys = allPlatforms ? Object.keys(PLATFORM_MAP) : [getPlatformKey()];

  console.log(`[prepare-codex-acp] 版本: v${CODEX_ACP_VERSION}`);
  console.log(`[prepare-codex-acp] 平台: ${keys.join(', ')}`);

  if (!allPlatforms && !PLATFORM_MAP[keys[0]]) {
    console.error(`[prepare-codex-acp] 不支持的平台: ${keys[0]}`);
    console.error(`[prepare-codex-acp] 支持的平台: ${Object.keys(PLATFORM_MAP).join(', ')}`);
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;

  for (const key of keys) {
    const success = await downloadFromRelease(key);
    if (success) ok++;
    else fail++;
  }

  if (ok > 0) {
    fs.writeFileSync(path.join(resDir, '.version'), CODEX_ACP_VERSION, 'utf-8');
  }

  console.log(`[prepare-codex-acp] 完成: ${ok} 成功, ${fail} 失败`);

  if (fail > 0 && !allPlatforms) {
    process.exit(1);
  }
}

main();

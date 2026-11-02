#!/usr/bin/env node
/**
 * 多平台 ripgrep 集成：构建前按当前平台准备 resources/ripgrep/bin/
 *
 * 1) 若已存在 resources/ripgrep/<platform-arch>/bin/，则复制到 resources/ripgrep/bin/
 * 2) 否则从 GitHub Releases (BurntSushi/ripgrep) 下载当前平台包，解压到 <platform-arch>/ 再复制到 bin/
 *
 * 打包时 electron-builder 的 extraResources 会打包 resources/ripgrep → .app/Contents/Resources/ripgrep
 * 运行时 getRipgrepBinPath() 使用 Resources/ripgrep/bin/rg 或 rg.exe
 *
 * 平台 key：darwin-arm64 | darwin-x64 | win32-x64 | win32-arm64 | linux-x64 | linux-arm64
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const RG_VERSION = '14.1.1';

const projectRoot = getProjectRoot();
const rgRoot = path.join(projectRoot, 'resources', 'ripgrep');
const cacheDir = path.join(rgRoot, '.cache');

// Node 与 Electron 一致：darwin | win32 | linux；x64 | arm64
function getPlatformKey() {
  const p = process.platform;
  const a = process.env.TARGET_ARCH || process.arch;
  return `${p}-${a}`;
}

// 当前平台对应的 ripgrep 官方 release 资源文件名（不含 .tar.gz / .zip）
const RG_ASSET_SUFFIX = {
  'darwin-arm64': 'ripgrep-14.1.1-aarch64-apple-darwin',
  'darwin-x64': 'ripgrep-14.1.1-x86_64-apple-darwin',
  'win32-x64': 'ripgrep-14.1.1-x86_64-pc-windows-msvc',
  'win32-arm64': 'ripgrep-14.1.1-aarch64-pc-windows-msvc',
  'linux-x64': 'ripgrep-14.1.1-x86_64-unknown-linux-musl',
  'linux-arm64': 'ripgrep-14.1.1-aarch64-unknown-linux-gnu',
};

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function copyToDestBin(key) {
  const srcBin = path.join(rgRoot, key, 'bin');
  const destBin = path.join(rgRoot, 'bin');
  if (!fs.existsSync(srcBin)) return false;
  if (!fs.existsSync(destBin)) fs.mkdirSync(destBin, { recursive: true });
  for (const f of fs.readdirSync(srcBin)) {
    const src = path.join(srcBin, f);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(destBin, f));
      console.log(`[prepare-ripgrep] ${key} -> bin/${f}`);
    }
  }
  return true;
}

/**
 * 下载文件到 cache 目录。使用 preferredFilename 避免重定向后 URL 过长导致 ENAMETOOLONG。
 * @param {string} url - 下载地址
 * @param {string} [preferredFilename] - 保存文件名
 */
function download(url, preferredFilename) {
  return new Promise((resolve, reject) => {
    const filename = preferredFilename || path.basename(url.split('?')[0]) || 'download';
    const file = path.join(cacheDir, filename);

    // 检查缓存是否存在且有效（Windows: > 1MB）
    if (fs.existsSync(file)) {
      try {
        const stats = fs.statSync(file);
        const minSize = process.platform === 'win32' ? 1024 * 1024 : 100 * 1024;
        if (stats.size > minSize) {
          console.log(`[prepare-ripgrep] 使用缓存: ${filename} (${Math.round(stats.size / 1024 / 1024)} MB)`);
          resolve(file);
          return;
        }
      } catch (e) {
        console.log(`[prepare-ripgrep] 缓存文件异常，删除后重新下载`);
        try { fs.unlinkSync(file); } catch (_) {}
      }
    }

    const stream = fs.createWriteStream(file);
    https.get(url, { headers: { 'User-Agent': 'Nuwax-Agent-Build' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const loc = res.headers.location;
        if (!loc) {
          stream.destroy();
          try { fs.unlinkSync(file); } catch (_) {}
          return reject(new Error(`HTTP ${res.statusCode} redirect with no Location header`));
        }
        stream.destroy();
        try { fs.unlinkSync(file); } catch (_) {}
        return download(loc.startsWith('http') ? loc : new URL(loc, url).href, preferredFilename).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        stream.destroy();
        try { fs.unlinkSync(file); } catch (_) {}
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      res.pipe(stream);
      res.on('error', (e) => {
        stream.destroy();
        try { fs.unlinkSync(file); } catch (_) {}
        reject(e);
      });
      stream.on('finish', () => { stream.close(); resolve(file); });
      stream.on('error', (e) => {
        stream.destroy();
        try { fs.unlinkSync(file); } catch (_) {}
        reject(e);
      });
    }).on('error', (e) => {
      stream.destroy();
      try { fs.unlinkSync(file); } catch (_) {}
      reject(e);
    });
  });
}

function extractArchive(archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = path.extname(archivePath).toLowerCase();
  const isZip = ext === '.zip';
  if (isZip) {
    if (process.platform === 'win32') {
      try {
        execSync(`tar -xf "${archivePath}" -C "${outDir}"`, { stdio: 'inherit' });
      } catch (e) {
        console.log('[prepare-ripgrep] tar 解压失败，尝试 PowerShell...');
        const psPath = archivePath.replace(/'/g, "''");
        const psDest = outDir.replace(/'/g, "''");
        execSync(
          `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${psPath}' -DestinationPath '${psDest}' -Force"`,
          { stdio: 'inherit' },
        );
      }
    } else {
      try {
        execSync(`unzip -o -q "${archivePath}" -d "${outDir}"`, { stdio: 'inherit' });
      } catch (e) {
        execSync(`tar -xf "${archivePath}" -C "${outDir}"`, { stdio: 'inherit' });
      }
    }
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${outDir}"`, { stdio: 'inherit' });
  }
}

/**
 * ripgrep 解压后结构为 ripgrep-{version}-{target}/rg（二进制）
 * 将 rg 移动到 <key>/bin/rg
 */
function moveExtractedToKey(extractDir, key) {
  const entries = fs.readdirSync(extractDir);
  const targetRoot = path.join(rgRoot, key);
  const rgBinName = process.platform === 'win32' ? 'rg.exe' : 'rg';

  if (entries.length === 1) {
    const inner = path.join(extractDir, entries[0]);
    if (fs.statSync(inner).isDirectory()) {
      // ripgrep archive: inner = ripgrep-{version}-{target}/
      copyDirRecursive(inner, targetRoot);
    } else {
      fs.mkdirSync(path.join(targetRoot, 'bin'), { recursive: true });
      fs.copyFileSync(inner, path.join(targetRoot, 'bin', entries[0]));
    }
  } else {
    copyDirRecursive(extractDir, targetRoot);
  }

  // 确保 bin 目录存在，将根目录的 rg 移动到 bin/
  const binDir = path.join(targetRoot, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  const rgExe = path.join(targetRoot, rgBinName);
  if (fs.existsSync(rgExe)) {
    fs.renameSync(rgExe, path.join(binDir, rgBinName));
  }
}

async function downloadAndPrepare(key, suffix, version) {
  const isZip = process.platform === 'win32';
  const ext = isZip ? '.zip' : '.tar.gz';
  const assetName = suffix + ext;
  const downloadUrl = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${assetName}`;

  console.log(`[prepare-ripgrep] 下载 ripgrep ${version} (${assetName}) ...`);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const archivePath = await download(downloadUrl, assetName);
  const extractDir = path.join(cacheDir, `rg-extract-${key}`);
  if (fs.existsSync(extractDir)) {
    try { fs.rmSync(extractDir, { recursive: true }); } catch (_) {}
  }
  extractArchive(archivePath, extractDir);
  moveExtractedToKey(extractDir, key);
  if (!copyToDestBin(key)) {
    throw new Error('解压后未找到 bin 目录，请检查包结构');
  }
}

async function main() {
  const key = getPlatformKey();
  const srcDir = path.join(rgRoot, key);
  const destBin = path.join(rgRoot, 'bin');
  const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const destRg = path.join(destBin, rgName);

  const platformKeyFile = path.join(destBin, '.platform-key');

  console.log(`[prepare-ripgrep] 平台: ${key}, 源码目录: ${srcDir}, 目标目录: ${destBin}`);

  // 检查 .platform-key 是否匹配，不匹配则清理并重新下载
  if (fs.existsSync(destRg)) {
    if (fs.existsSync(platformKeyFile)) {
      const existingKey = fs.readFileSync(platformKeyFile, 'utf-8').trim();
      if (existingKey === key) {
        console.log(`[prepare-ripgrep] ripgrep 已存在且架构匹配 (${key}), 跳过下载`);
        return;
      }
      console.log(`[prepare-ripgrep] 架构不匹配: 已有 ${existingKey}, 需要 ${key}, 清理并重新下载`);
    } else {
      console.log(`[prepare-ripgrep] ripgrep 已存在但缺少 .platform-key, 无法确认架构, 清理并重新下载`);
    }
    fs.rmSync(destBin, { recursive: true, force: true });
  }

  // 如果源码目录存在但 bin 不完整，尝试复制
  if (fs.existsSync(srcDir) && copyToDestBin(key)) {
    if (fs.existsSync(destRg)) {
      fs.writeFileSync(platformKeyFile, key, 'utf-8');
      console.log(`[prepare-ripgrep] 使用已有 ripgrep (${key}), 已复制到 bin/ 并写入 .platform-key`);
      return;
    }
  }

  const suffix = RG_ASSET_SUFFIX[key];
  if (!suffix) {
    console.warn(`[prepare-ripgrep] 未支持的平台: ${key}`);
    return;
  }

  const version = RG_VERSION;
  console.log(`[prepare-ripgrep] 使用 ripgrep 版本: ${version}`);
  try {
    await downloadAndPrepare(key, suffix, version);
    // Write .platform-key marker after successful download
    if (fs.existsSync(destBin)) {
      fs.writeFileSync(platformKeyFile, key, 'utf-8');
      console.log(`[prepare-ripgrep] 已写入 .platform-key: ${key}`);
    }
  } catch (err) {
    console.error('[prepare-ripgrep] 下载或解压失败:', err.message);
    process.exit(1);
  }
}

main();

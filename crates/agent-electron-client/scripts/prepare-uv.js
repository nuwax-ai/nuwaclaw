#!/usr/bin/env node
/**
 * 多平台 uv 集成：构建前按当前平台准备 resources/uv/bin/
 *
 * 1) 若已存在 resources/uv/<platform-arch>/bin/，则复制到 resources/uv/bin/
 * 2) 否则从 GitHub Releases (astral-sh/uv) 下载当前平台包，解压到 <platform-arch>/ 再复制到 bin/
 *
 * 打包时 electron-builder 的 extraResources 会打包 resources/uv → .app/Contents/Resources/uv
 * 运行时 getUvBinPath() 使用 Resources/uv/bin/uv 或 uv.exe
 *
 * 平台 key：darwin-arm64 | darwin-x64 | win32-x64 | win32-arm64 | linux-x64 | linux-arm64
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const uvRoot = path.join(projectRoot, 'resources', 'uv');
const cacheDir = path.join(uvRoot, '.cache');

// Node 与 Electron 一致：darwin | win32 | linux；x64 | arm64
function getPlatformKey() {
  const p = process.platform;
  const a = process.arch === 'x64' ? 'x64' : process.arch;
  return `${p}-${a}`;
}

/** 从 GitHub API 获取 astral-sh/uv 最新 release 版本号（如 0.10.4） */
function fetchLatestUvVersion() {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/astral-sh/uv/releases/latest',
      headers: { 'User-Agent': 'Nuwax-Agent-Build' },
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', (ch) => { data += ch; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const tag = json.tag_name || '';
          resolve(tag.replace(/^v/, ''));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 当前平台对应的 uv 官方 release 资源文件名（不含 .tar.gz / .zip）
const UV_ASSET_SUFFIX = {
  'darwin-arm64': 'uv-aarch64-apple-darwin',
  'darwin-x64': 'uv-x86_64-apple-darwin',
  'win32-x64': 'uv-x86_64-pc-windows-msvc',
  'win32-arm64': 'uv-aarch64-pc-windows-msvc',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu',
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
  const srcBin = path.join(uvRoot, key, 'bin');
  const destBin = path.join(uvRoot, 'bin');
  if (!fs.existsSync(srcBin)) return false;
  if (!fs.existsSync(destBin)) fs.mkdirSync(destBin, { recursive: true });
  for (const f of fs.readdirSync(srcBin)) {
    const src = path.join(srcBin, f);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(destBin, f));
      console.log(`[prepare-uv] ${key} -> bin/${f}`);
    }
  }
  return true;
}

/**
 * 下载文件到 cache 目录。使用 preferredFilename 避免重定向后 URL 过长导致 ENAMETOOLONG。
 * @param {string} url - 下载地址
 * @param {string} [preferredFilename] - 保存文件名（建议传入，如 uv-aarch64-apple-darwin.tar.gz）
 */
function download(url, preferredFilename) {
  return new Promise((resolve, reject) => {
    const filename = preferredFilename || path.basename(url.split('?')[0]) || 'download';
    const file = path.join(cacheDir, filename);
    const stream = fs.createWriteStream(file);
    https.get(url, { headers: { 'User-Agent': 'Nuwax-Agent-Build' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const loc = res.headers.location;
        return download(loc.startsWith('http') ? loc : new URL(loc, url).href, preferredFilename).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        stream.close();
        fs.unlink(file, () => {});
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(file); });
      stream.on('error', reject);
    }).on('error', reject);
  });
}

function extractArchive(archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = path.extname(archivePath).toLowerCase();
  const isZip = ext === '.zip';
  if (isZip) {
    if (process.platform === 'win32') {
      // Windows: tar 对 D:\ 路径解析有问题，用 PowerShell Expand-Archive 解压 .zip
      const psPath = archivePath.replace(/'/g, "''");
      const psDest = outDir.replace(/'/g, "''");
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${psPath}' -DestinationPath '${psDest}' -Force"`,
        { stdio: 'inherit' },
      );
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

function moveExtractedToKey(extractDir, key) {
  const entries = fs.readdirSync(extractDir);
  const targetRoot = path.join(uvRoot, key);
  if (entries.length === 1) {
    const inner = path.join(extractDir, entries[0]);
    if (fs.statSync(inner).isDirectory()) {
      copyDirRecursive(inner, targetRoot);
    } else {
      fs.mkdirSync(path.join(targetRoot, 'bin'), { recursive: true });
      fs.copyFileSync(inner, path.join(targetRoot, 'bin', entries[0]));
    }
  } else {
    copyDirRecursive(extractDir, targetRoot);
  }
  // Windows zip 可能是顶层 uv.exe，无 bin 子目录
  const binDir = path.join(targetRoot, 'bin');
  const uvExe = path.join(targetRoot, 'uv.exe');
  const uvBin = path.join(targetRoot, 'uv');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
    if (fs.existsSync(uvExe)) fs.renameSync(uvExe, path.join(binDir, 'uv.exe'));
    else if (fs.existsSync(uvBin)) fs.renameSync(uvBin, path.join(binDir, 'uv'));
  }
}

async function downloadAndPrepare(key, suffix, version) {
  const isZip = process.platform === 'win32';
  const ext = isZip ? '.zip' : '.tar.gz';
  const assetName = suffix + ext;
  const downloadUrl = `https://github.com/astral-sh/uv/releases/download/${version}/${assetName}`;

  console.log(`[prepare-uv] 下载 uv ${version} (${assetName}) ...`);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const archivePath = await download(downloadUrl, assetName);
  const extractDir = path.join(cacheDir, `uv-extract-${key}`);
  if (fs.existsSync(extractDir)) {
    try { fs.rmSync(extractDir, { recursive: true }); } catch (_) {}
  }
  extractArchive(archivePath, extractDir);
  moveExtractedToKey(extractDir, key);
  if (!copyToDestBin(key)) {
    console.warn('[prepare-uv] 解压后未找到 bin 目录，请检查包结构');
  }
}

async function main() {
  const key = getPlatformKey();
  const srcDir = path.join(uvRoot, key);

  if (fs.existsSync(srcDir) && copyToDestBin(key)) {
    return;
  }

  const suffix = UV_ASSET_SUFFIX[key];
  if (!suffix) {
    console.warn(`[prepare-uv] 未支持的平台: ${key}`);
    return;
  }

// 未设置时使用 GitHub 最新 release；设置 UV_VERSION 可固定版本
  let version = process.env.UV_VERSION;
  if (!version) {
    try {
      version = await fetchLatestUvVersion();
      console.log(`[prepare-uv] 使用最新版本: ${version}`);
    } catch (e) {
      console.warn('[prepare-uv] 获取最新版本失败，回退 0.10.0:', e.message);
      version = '0.10.0';
    }
  }
  try {
    await downloadAndPrepare(key, suffix, version);
  } catch (err) {
    console.error('[prepare-uv] 下载或解压失败:', err.message);
    process.exit(1);
  }
}

main();

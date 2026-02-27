#!/usr/bin/env node
/**
 * Node.js 24 集成（仅 Windows 客户端）
 *
 * 仅在 Windows 构建时执行：准备 resources/node/<platform-arch>/，供运行时 PATH 使用。
 * macOS/Linux 使用系统 Node，不打包内置 Node。
 *
 * 参考 LobsterAI 方案：https://github.com/netease-youdao/LobsterAI
 *
 * 1) 若已存在 resources/node/<platform-arch>/，则跳过
 * 2) 否则从 nodejs.org 下载 Windows 包，解压到 <platform-arch>/
 *
 * 平台 key（仅 Windows）：win32-x64 | win32-arm64
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const nodeRoot = path.join(projectRoot, 'resources', 'node');

// Node.js 版本
const NODE_VERSION = '24.0.0';

// 平台 key
function getPlatformKey() {
  const p = process.platform;
  const a = process.arch === 'x64' ? 'x64' : process.arch ===('arm64') ? 'arm64' : process.arch;
  return `${p}-${a}`;
}

// Node.js 官方 release 资源文件名
const NODE_ASSET_SUFFIX = {
  'darwin-arm64': 'node-v${VERSION}-darwin-arm64.tar.xz',
  'darwin-x64': 'node-v${VERSION}-darwin-x64.tar.xz',
  'win32-x64': 'node-v${VERSION}-win-x64.zip',
  'win32-arm64': 'node-v${VERSION}-win-arm64.zip',
  'linux-x64': 'node-v${VERSION}-linux-x64.tar.xz',
  'linux-arm64': 'node-v${VERSION}-linux-arm64.tar.xz',
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

/**
 * 下载文件
 */
function download(url, filename) {
  return new Promise((resolve, reject) => {
    const file = path.join(nodeRoot, '.cache', filename);
    
    if (fs.existsSync(file)) {
      console.log(`[prepare-node] 使用缓存: ${filename}`);
      resolve(file);
      return;
    }
    
    fs.mkdirSync(path.dirname(file), { recursive: true });
    
    const stream = fs.createWriteStream(file);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const loc = res.headers.location;
        const fullUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        stream.close();
        fs.unlink(file, () => {});
        return download(fullUrl, filename).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        stream.close();
        fs.unlink(file, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(file); });
      stream.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 解压
 */
function extractArchive(archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = path.extname(archivePath).toLowerCase();
  
  if (ext === '.zip') {
    if (process.platform === 'win32') {
      const psPath = archivePath.replace(/'/g, "''");
      const psDest = outDir.replace(/'/g, "''");
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${psPath}' -DestinationPath '${psDest}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`unzip -o -q "${archivePath}" -d "${outDir}"`, { stdio: 'inherit' });
    }
  } else {
    execSync(`tar -xJf "${archivePath}" -C "${outDir}"`, { stdio: 'inherit' });
  }
}

async function prepareNode(key, suffix) {
  const cacheDir = path.join(nodeRoot, '.cache');
  const platformDir = path.join(nodeRoot, key);
  
  // 检查是否已存在
  if (fs.existsSync(platformDir)) {
    console.log(`[prepare-node] Node.js ${NODE_VERSION} (${key}) 已存在，跳过`);
    return;
  }
  
  const filename = suffix.replace('${VERSION}', NODE_VERSION);
  const downloadUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${filename}`;
  
  console.log(`[prepare-node] 下载 Node.js ${NODE_VERSION} (${filename})...`);
  
  try {
    const archivePath = await download(downloadUrl, filename);
    const extractDir = path.join(cacheDir, `node-extract-${key}`);
    
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    
    console.log(`[prepare-node] 解压...`);
    extractArchive(archivePath, extractDir);
    
    // 移动到目标目录
    const entries = fs.readdirSync(extractDir);
    if (entries.length === 1) {
      const inner = path.join(extractDir, entries[0]);
      if (fs.statSync(inner).isDirectory()) {
        copyDirRecursive(inner, platformDir);
      }
    }
    
    console.log(`[prepare-node] Node.js ${NODE_VERSION} (${key}) 准备完成!`);
    
  } catch (err) {
    console.error(`[prepare-node] 下载或解压失败:`, err.message);
    process.exit(1);
  }
}

async function main() {
  // 仅 Windows 客户端需要内置 Node.js 24；macOS/Linux 使用系统 Node
  if (process.platform !== 'win32') {
    console.log('[prepare-node] 非 Windows 平台跳过（仅 Windows 客户端集成 Node.js 24）');
    return;
  }

  const key = getPlatformKey();
  const suffix = NODE_ASSET_SUFFIX[key];

  if (!suffix) {
    console.warn(`[prepare-node] 未支持的平台: ${key}`);
    return;
  }

  // 创建目录
  fs.mkdirSync(nodeRoot, { recursive: true });

  await prepareNode(key, suffix);
}

main();

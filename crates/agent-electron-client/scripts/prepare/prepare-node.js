#!/usr/bin/env node
/**
 * Node.js 24 集成（所有平台）
 *
 * 为所有平台准备 resources/node/<platform-arch>/，供运行时使用。
 *
 * 参考 LobsterAI 方案：https://github.com/netease-youdao/LobsterAI
 *
 * 1) 若已存在 resources/node/<platform-arch>/，则跳过
 * 2) 否则从 nodejs.org 下载对应平台的包，解压到 <platform-arch>/
 * 3) 可选：验证下载文件的 SHA256 校验和
 *
 * 平台 key：darwin-x64, darwin-arm64, win32-x64, win32-arm64, linux-x64, linux-arm64
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const nodeRoot = path.join(projectRoot, 'resources', 'node');

// Node.js 版本
const NODE_VERSION = '24.14.0';

// 是否验证 SHA256（可通过环境变量禁用：SKIP_SHA256=1 npm run prepare:node）
const SKIP_SHA256 = process.env.SKIP_SHA256 === '1';

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
 * 计算文件的 SHA256 哈希值
 */
function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 获取 Node.js 官方 SHASUMS256.txt 内容
 */
async function fetchShasums(urlOverride) {
  const url = urlOverride || `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const loc = res.headers.location;
        const fullUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchShasums(fullUrl).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 验证下载文件的 SHA256
 */
async function verifySha256(filePath, filename) {
  if (SKIP_SHA256) {
    console.log('[prepare-node] SHA256 校验已跳过 (SKIP_SHA256=1)');
    return true;
  }

  try {
    console.log('[prepare-node] 验证 SHA256 校验和...');
    const shasums = await fetchShasums();
    const expectedHash = shasums
      .split('\n')
      .find(line => line.endsWith(filename))
      ?.split(/\s+/)[0];

    if (!expectedHash) {
      console.warn('[prepare-node] ⚠️ 未找到对应的 SHA256 校验和，跳过验证');
      return true;
    }

    const actualHash = await computeSha256(filePath);
    if (actualHash !== expectedHash) {
      console.error(`[prepare-node] ❌ SHA256 校验失败!`);
      console.error(`[prepare-node]   期望: ${expectedHash}`);
      console.error(`[prepare-node]   实际: ${actualHash}`);
      return false;
    }

    console.log('[prepare-node] ✅ SHA256 校验通过');
    return true;
  } catch (err) {
    console.warn('[prepare-node] ⚠️ SHA256 校验失败（网络问题?）:', err.message);
    // 网络问题时允许继续
    return true;
  }
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

/**
 * 复制目录，保留符号链接
 */
function copyDirRecursiveWithSymlinks(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const stat = fs.lstatSync(s);
    if (stat.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(s);
      fs.symlinkSync(linkTarget, d);
    } else if (stat.isDirectory()) {
      copyDirRecursiveWithSymlinks(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
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

    // 验证 SHA256
    const sha256Valid = await verifySha256(archivePath, filename);
    if (!sha256Valid) {
      fs.unlinkSync(archivePath);
      console.error('[prepare-node] 下载文件已删除，请重试');
      process.exit(1);
    }

    const extractDir = path.join(cacheDir, `node-extract-${key}`);

    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

    console.log(`[prepare-node] 解压...`);
    extractArchive(archivePath, extractDir);

    // 移动到目标目录（保留符号链接）
    const entries = fs.readdirSync(extractDir);
    if (entries.length === 1) {
      const inner = path.join(extractDir, entries[0]);
      if (fs.statSync(inner).isDirectory()) {
        copyDirRecursiveWithSymlinks(inner, platformDir);
      }
    }

    // 清理不需要的文件以减小包体积
    // 1. 删除 include 目录（C++ 头文件，运行时不需要）
    const includeDir = path.join(platformDir, 'include');
    if (fs.existsSync(includeDir)) {
      fs.rmSync(includeDir, { recursive: true, force: true });
      console.log(`[prepare-node] 已删除 include/ 目录（运行时不需要）`);
    }

    // 2. 删除 CHANGELOG.md, LICENSE, README.md（可选，减小体积）
    ['CHANGELOG.md', 'LICENSE', 'README.md'].forEach(file => {
      const filePath = path.join(platformDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    // Windows: 统一目录结构，将 node.exe 移动到 bin/ 目录
    // 这样所有平台都使用 resources/node/<platform>/bin/node 结构
    if (key.startsWith('win32-')) {
      const nodeExe = path.join(platformDir, 'node.exe');
      const binDir = path.join(platformDir, 'bin');
      if (fs.existsSync(nodeExe) && !fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
        fs.renameSync(nodeExe, path.join(binDir, 'node.exe'));
        // 移动相关文件到 bin/
        ['npm.cmd', 'npx.cmd', 'corepack.cmd', 'npm', 'npx', 'corepack'].forEach(cmd => {
          const src = path.join(platformDir, cmd);
          if (fs.existsSync(src)) {
            fs.renameSync(src, path.join(binDir, cmd));
          }
        });
        // 移动 node_modules 到 bin/ 目录（npm.cmd 期望 node_modules 在同一目录）
        const nodeModulesSrc = path.join(platformDir, 'node_modules');
        const nodeModulesDest = path.join(binDir, 'node_modules');
        if (fs.existsSync(nodeModulesSrc) && !fs.existsSync(nodeModulesDest)) {
          fs.renameSync(nodeModulesSrc, nodeModulesDest);
        }
        console.log(`[prepare-node] 已将 Windows Node.js 重组为 bin/ 结构`);
      }
    }

    console.log(`[prepare-node] Node.js ${NODE_VERSION} (${key}) 准备完成!`);

  } catch (err) {
    console.error(`[prepare-node] 下载或解压失败:`, err.message);
    process.exit(1);
  }
}

async function main() {
  // 所有平台都需要内置 Node.js 24，不依赖用户系统安装
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

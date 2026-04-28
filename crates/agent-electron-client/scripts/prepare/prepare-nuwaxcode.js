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
const { execSync, execFileSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const NUWAXCODE_VERSION = '1.1.80';
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

/**
 * 兼容 release 二进制命名差异：
 * - 历史格式: nuwaxcode / nuwaxcode.exe
 * - 新格式:   opencode  / opencode.exe
 *
 * 说明：
 * 1) 运行时入口仍统一为 resources/.../bin/nuwaxcode(.exe)
 * 2) 这里仅放宽“解压后查找源二进制”的候选名，不改变运行时对外约定
 */
function getBinaryCandidates(key) {
  const preferred = getBinaryName(key);
  const fallback = isWindows(key) ? 'opencode.exe' : 'opencode';
  return [preferred, fallback];
}

/**
 * 清理目标 bin 目录，避免旧版本资源文件残留。
 *
 * 背景：
 * - 历史上这里是“增量覆盖复制”，当新包删除了某些文件（例如 assets/models.json）
 *   而旧包中仍存在时，旧文件会继续留在目标目录，造成“看似升级成功但实际混入旧资源”。
 *
 * 规则：
 * - 每次准备二进制前先删后建，保证目标目录仅包含当前包内容。
 * - 使用 force:true，确保目录不存在时也不会抛错。
 */
function resetDestBinDir(destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
}

/**
 * 即便命中版本与 SHA，也执行一次“目录重铺”。
 *
 * 原因：
 * - 过去采用增量覆盖复制，可能在目标目录留下旧版本 assets 残留。
 * - 仅靠二进制 SHA 命中无法发现“额外残留文件”。
 *
 * 处理：
 * - 命中后不提前 return，而是继续走解压/复制流程（优先使用本地缓存包），
 *   通过 resetDestBinDir() 达到“先清理后落盘”的确定性结果。
 */
const FORCE_REFRESH_ON_MATCH = true;

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

  // 检查是否已是最新（SHA256 一致 + 版本匹配）
  // 注意：codesign 会修改二进制，所以用保存的 .sha256 记录比对 dest（签名后），
  // 而非比对 src（未签名）vs dest（已签名）
  if (fs.existsSync(destPath)) {
    const versionFile = path.join(resDir, '.version');
    if (fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf-8').trim() === NUWAXCODE_VERSION) {
      const shaFile = path.join(resDir, `.sha256-${resourceKey}`);
      if (fs.existsSync(shaFile)) {
        const expectedHash = fs.readFileSync(shaFile, 'utf-8').trim();
        const currentHash = sha256File(destPath);
        if (currentHash === expectedHash) {
          // 额外校验：二进制内部版本号可能与 .version 不一致（曾发生过标记更新但二进制未更新）
          const innerVersion = verifyBinaryVersion(destPath, NUWAXCODE_VERSION, key, currentHash);
          if (innerVersion && innerVersion !== NUWAXCODE_VERSION) {
            console.warn(
              `[prepare-nuwaxcode] ${key}: 版本标记为 ${NUWAXCODE_VERSION} 但二进制为 ${innerVersion}，将重新复制覆盖`,
            );
          } else {
            console.log(
              `[prepare-nuwaxcode] ${key} ✓ (已是最新, SHA256=${currentHash.slice(0, 16)}...)`
              + (FORCE_REFRESH_ON_MATCH ? '，将执行目录重铺以清理残留文件' : ''),
            );
            if (!FORCE_REFRESH_ON_MATCH) return true;
          }
        }
        console.warn(`[prepare-nuwaxcode] ${key}: SHA256 不匹配，需重新复制 (saved=${expectedHash.slice(0, 16)}... current=${currentHash.slice(0, 16)}...)`);
      }
    }
  }

  // 复制前先清理目标目录，确保不会夹带旧版本 assets 残留文件。
  resetDestBinDir(destDir);

  // 复制整个 bin 目录（包含二进制 + assets 等）
  const srcBinDir = path.join(nuwaxcodeDist, distName, 'bin');
  fs.cpSync(srcBinDir, destDir, { recursive: true });
  fs.chmodSync(destPath, 0o755);

  const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
  console.log(`[prepare-nuwaxcode] ${key} ✓ 从本地 dist 复制 (${sizeMB} MB)`);

  // macOS ad-hoc 签名
  codesign(destPath, key);

  // 计算 SHA256（签名后），用于打印 + 保存
  const hash = sha256File(destPath);

  // 验证二进制内部版本号 + 打印 SHA256
  verifyBinaryVersion(destPath, NUWAXCODE_VERSION, key, hash);

  // 保存 SHA256 记录，下次可精确跳过
  fs.writeFileSync(path.join(resDir, `.sha256-${resourceKey}`), hash, 'utf-8');

  return true;
}

// ==================== 模式 2: GitHub Release 下载 ====================

/**
 * 下载文件到缓存目录
 * @param {{ force?: boolean }} [options] force=true 时忽略已有缓存（解压失败/缓存截断时用）
 */
function download(url, preferredFilename, options = {}) {
  const force = !!options.force;
  return new Promise((resolve, reject) => {
    const filename = preferredFilename || path.basename(url.split('?')[0]) || 'download';
    const file = path.join(cacheDir, filename);

    // 缓存检查（仅看大小，不校验 gzip；损坏时需 force 重下）
    if (!force && fs.existsSync(file)) {
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

  // 检查是否已是最新（版本匹配 + SHA256 一致）
  const versionFile = path.join(resDir, '.version');
  if (fs.existsSync(destPath) && fs.existsSync(versionFile)) {
    if (fs.readFileSync(versionFile, 'utf-8').trim() === NUWAXCODE_VERSION) {
      // 额外校验：比对已缓存 tar.gz 与当前 dest 的 SHA256 是否记录一致
      // 防止 release 被 force-push 后 .version 匹配但二进制已过期
      const shaFile = path.join(resDir, `.sha256-${getResourcePlatformKey(key)}`);
      if (fs.existsSync(shaFile)) {
        const expectedHash = fs.readFileSync(shaFile, 'utf-8').trim();
        const currentHash = sha256File(destPath);
        if (currentHash === expectedHash) {
          // 关键：即使命中 SHA256 + .version，也必须校验二进制内部版本号，
          // 否则一旦资源目录里的二进制未更新但标记文件被更新，会导致永远跳过下载。
          const innerVersion = verifyBinaryVersion(destPath, NUWAXCODE_VERSION, key, currentHash);
          if (innerVersion && innerVersion !== NUWAXCODE_VERSION) {
            console.warn(
              `[prepare-nuwaxcode] ${key}: 版本标记为 ${NUWAXCODE_VERSION} 但二进制为 ${innerVersion}，将强制重新下载覆盖`,
            );
          } else {
            const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
            console.log(
              `[prepare-nuwaxcode] ${key} ✓ (已是最新 ${sizeMB} MB, SHA256=${currentHash.slice(0, 16)}...)`
              + (FORCE_REFRESH_ON_MATCH ? '，将执行目录重铺以清理残留文件' : ''),
            );
            if (!FORCE_REFRESH_ON_MATCH) return true;
          }
        }
        console.warn(`[prepare-nuwaxcode] ${key}: SHA256 不匹配，需重新下载 (expected=${expectedHash.slice(0, 16)}... current=${currentHash.slice(0, 16)}...)`);
      } else {
        // 无 SHA256 记录时也做一次内部版本校验：避免“标记已更新、二进制未更新”被掩盖
        const innerVersion = verifyBinaryVersion(destPath, NUWAXCODE_VERSION, key, null);
        if (innerVersion && innerVersion !== NUWAXCODE_VERSION) {
          console.warn(
            `[prepare-nuwaxcode] ${key}: 版本标记为 ${NUWAXCODE_VERSION} 但二进制为 ${innerVersion}，将重新下载覆盖`,
          );
        } else {
          const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
          console.log(
            `[prepare-nuwaxcode] ${key} ✓ (版本匹配 ${sizeMB} MB，无 SHA256 记录)`
            + (FORCE_REFRESH_ON_MATCH ? '，将执行目录重铺以清理残留文件' : '，跳过下载'),
          );
          if (!FORCE_REFRESH_ON_MATCH) return true;
        }
      }
    }
  }

  // Release asset: nuwaxcode-{platform}-{arch}.tar.gz
  const assetName = `${distName}.tar.gz`;
  const downloadUrl = `https://github.com/${NUWAXCODE_REPO}/releases/download/v${NUWAXCODE_VERSION}/${assetName}`;

  console.log(`[prepare-nuwaxcode] ${key}: 下载 ${assetName} ...`);

  // Windows：PATH 里常见的是 System32 的 bsdtar，它不认 MSYS 的 /d/a/... 路径，
  // 只认盘符路径（D:\... 或 D:/...）。Git for Windows 的 GNU tar 也接受 D:/...。
  const toTarPath = (p) => {
    if (process.platform !== 'win32') return p;
    const match = /^([A-Za-z]):[\\/](.*)$/.exec(p);
    if (!match) return p.replace(/\\/g, '/');
    const drive = match[1];
    const rest = match[2].replace(/\\/g, '/');
    return `${drive}:/${rest}`;
  };

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const force = attempt > 0;
      if (force) {
        console.warn(
          `[prepare-nuwaxcode] ${key}: 归档解压失败（常见于缓存被截断），将删除缓存并重新下载 ${assetName}`,
        );
      }

      const archivePath = await download(downloadUrl, assetName, { force });

      // 解压到临时目录
      const extractDir = path.join(cacheDir, `extract-${key}`);
      if (fs.existsSync(extractDir)) {
        try { fs.rmSync(extractDir, { recursive: true }); } catch (_) {}
      }
      fs.mkdirSync(extractDir, { recursive: true });

      const tarArchivePath = toTarPath(archivePath);
      const tarExtractDir = toTarPath(extractDir);

      // 使用参数数组调用 tar，避免在 Windows/MSYS 下对 C:\ 路径的错误解析。
      // --force-local 仅在 win32 且 tar 支持时使用（macOS BSD tar 不支持该选项）。
      const tarArgs = ['-xzf', tarArchivePath, '-C', tarExtractDir];
      if (process.platform === 'win32') {
        try {
          const tarHelp = execFileSync('tar', ['--help'], { encoding: 'utf-8', stdio: 'pipe' });
          if (typeof tarHelp === 'string' && tarHelp.includes('--force-local')) {
            tarArgs.unshift('--force-local');
          }
        } catch (_) {}
      }

      try {
        execFileSync('tar', tarArgs, { stdio: 'pipe' });
      } catch (tarErr) {
        if (attempt === 1) throw tarErr;
        continue;
      }

      // 查找二进制文件：
      // 1) 旧包结构通常是 bin/nuwaxcode
      // 2) 新包结构可能是根目录单文件 opencode
      const binaryCandidates = getBinaryCandidates(key);
      const binaryPath = findBinary(extractDir, binaryCandidates);
      if (!binaryPath) {
        if (attempt === 1) {
          console.error(
            `[prepare-nuwaxcode] ${key}: 解压后未找到可执行文件（候选: ${binaryCandidates.join(', ')}）`,
          );
          return false;
        }
        continue;
      }

      // 复制前先清理目标目录，避免旧版本 assets 文件被“增量复制”保留下来。
      resetDestBinDir(destDir);

      const extractedBinDir = path.dirname(binaryPath);
      const extractedBaseName = path.basename(binaryPath);

      // 复制策略：
      // A. 命中标准名（nuwaxcode）时，复制整个 bin 目录，尽量保留同目录 assets
      // B. 命中别名（opencode）时，按目标标准名落盘，保证后续路径稳定
      if (extractedBaseName === binary) {
        fs.cpSync(extractedBinDir, destDir, { recursive: true });
      } else {
        fs.copyFileSync(binaryPath, destPath);
      }
      fs.chmodSync(destPath, 0o755);

      const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
      console.log(`[prepare-nuwaxcode] ${key} ✓ 从 GitHub Release 下载 (${sizeMB} MB)`);

      // macOS ad-hoc 签名
      codesign(destPath, key);

      // 计算 SHA256（签名后），用于打印 + 保存
      const hash = sha256File(destPath);

      // 验证二进制内部版本号 + 打印 SHA256
      const innerVersion = verifyBinaryVersion(destPath, NUWAXCODE_VERSION, key, hash);
      if (innerVersion && innerVersion !== NUWAXCODE_VERSION) {
        // 常见于：本地缓存的 tar.gz 仍是旧内容（例如同名资产被替换、或缓存命中导致一直用旧包）
        // 第一次发现不一致时，删除缓存并强制重新下载再试一次。
        if (attempt === 0) {
          console.warn(
            `[prepare-nuwaxcode] ${key}: 检测到二进制版本不一致，将删除缓存并强制重新下载 ${assetName} 再验证一次`,
          );
          continue;
        }
      }

      // 保存 SHA256 记录，下次可精确跳过
      fs.writeFileSync(path.join(resDir, `.sha256-${resourceKey}`), hash, 'utf-8');

      return true;
    }
  } catch (err) {
    console.error(`[prepare-nuwaxcode] ${key}: 下载失败: ${err.message}`);
    console.error(`[prepare-nuwaxcode] 请确认 GitHub Release 存在: https://github.com/${NUWAXCODE_REPO}/releases/tag/v${NUWAXCODE_VERSION}`);
    return false;
  }
}

/**
 * 在解压目录中递归查找二进制文件
 */
function findBinary(dir, binaryNames) {
  const names = Array.isArray(binaryNames) ? binaryNames : [binaryNames];

  // 先走最常见目录：bin/ 与 package/bin/
  for (const name of names) {
    const direct = path.join(dir, 'bin', name);
    if (fs.existsSync(direct)) return direct;

    const pkgBin = path.join(dir, 'package', 'bin', name);
    if (fs.existsSync(pkgBin)) return pkgBin;
  }

  // 新 release 可能是“根目录单文件”
  for (const name of names) {
    const rootFile = path.join(dir, name);
    if (fs.existsSync(rootFile)) return rootFile;
  }

  // 最后兜底递归搜索（最多 3 层）
  for (const name of names) {
    const found = _findRecursive(dir, name, 3);
    if (found) return found;
  }
  return null;
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

/**
 * 计算文件 SHA256
 */
function sha256File(filePath) {
  try {
    return execFileSync('shasum', ['-a', '256', filePath], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split(/\s+/)[0];
  } catch {
    // Windows 或无 shasum 时，用 Node.js crypto
    const crypto = require('crypto');
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

/**
 * 验证二进制内部版本号是否与期望版本匹配
 * nuwaxcode 的 release tag 可能与二进制内部版本不一致，
 * 需要检测以避免 .version 标记与实际二进制不符。
 */
function verifyBinaryVersion(binaryPath, expectedVersion, key, hash) {
  // 打印 SHA256（由调用方传入，避免重复计算）
  if (hash) {
    console.log(`[prepare-nuwaxcode] ${key}: SHA256=${hash}`);
  }

  try {
    const output = execFileSync(binaryPath, ['-v'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (output !== expectedVersion) {
      console.warn(
        `[prepare-nuwaxcode] ${key}: ⚠️ 二进制内部版本 ${output} 与期望版本 ${expectedVersion} 不一致（release tag 版本与二进制版本不同步）`,
      );
    }
    return output;
  } catch (e) {
    // 二进制可能不支持 -v 或无法在本平台执行（交叉编译场景），跳过校验
    console.warn(`[prepare-nuwaxcode] ${key}: 无法验证二进制版本（${e.message}），跳过校验`);
    return null;
  }
}

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

#!/usr/bin/env node
/**
 * Git 集成（仅 Windows 客户端）
 *
 * 仅在 Windows 构建时执行：准备 resources/git/（PortableGit + bash），供端口检查等脚本使用。
 * macOS/Linux 使用系统 git/bash，不打包内置 Git。
 *
 * 参考 LobsterAI 方案：scripts/setup-mingit.js（workspace/lobsterAI）
 *
 * - Windows：下载 PortableGit（.7z.exe）并用 7zip-bin 解压，或使用本地归档/缓存
 * - 非 Windows：默认跳过；可通过 --required 或 NUWAX_SETUP_GIT_FORCE=1 在 macOS 上为 Windows 打包做准备
 *
 * 环境变量：
 *   NUWAX_PORTABLE_GIT_ARCHIVE - 本地离线归档路径（CI 推荐预先下载后设置）
 *   NUWAX_GIT_URL              - 下载地址覆盖（镜像等）
 *   NUWAX_SETUP_GIT_FORCE=1    - 非 Windows 主机也执行准备（用于在 macOS 上打 Windows 包）
 *
 * CLI：
 *   --required - 若无法准备则失败（CI 中建议配合 NUWAX_PORTABLE_GIT_ARCHIVE 使用）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { getProjectRoot } = require('../utils/project-paths');

// 与 LobsterAI 保持一致
const GIT_VERSION = '2.47.1';
const PORTABLE_GIT_FILE = `PortableGit-${GIT_VERSION}-64-bit.7z.exe`;
const DEFAULT_PORTABLE_GIT_URL =
  `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/${PORTABLE_GIT_FILE}`;

const PROJECT_ROOT = getProjectRoot();
const GIT_ROOT = path.join(PROJECT_ROOT, 'resources', 'git');
const CACHE_DIR = path.join(GIT_ROOT, '.cache');
const DEFAULT_ARCHIVE_PATH = path.join(CACHE_DIR, PORTABLE_GIT_FILE);

// 需要删除的目录（与 LobsterAI 一致，减小体积）
const DIRS_TO_PRUNE = [
  'doc',
  'ReleaseNotes.html',
  'README.portable',
  path.join('mingw64', 'doc'),
  path.join('mingw64', 'share', 'doc'),
  path.join('mingw64', 'share', 'gtk-doc'),
  path.join('mingw64', 'share', 'man'),
  path.join('mingw64', 'share', 'gitweb'),
  path.join('mingw64', 'share', 'git-gui'),
  path.join('mingw64', 'libexec', 'git-core', 'git-gui'),
  path.join('mingw64', 'libexec', 'git-core', 'git-gui--askpass'),
  path.join('usr', 'share', 'doc'),
  path.join('usr', 'share', 'man'),
  path.join('usr', 'share', 'vim'),
  path.join('usr', 'share', 'perl5'),
  path.join('usr', 'lib', 'perl5'),
];

function parseArgs(argv) {
  return {
    required: argv.includes('--required'),
  };
}

function resolveInputPath(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function isNonEmptyFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function getDirSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(full);
    } else {
      size += fs.statSync(full).size;
    }
  }
  return size;
}

/** 解析 7zip-bin 可执行路径（与 LobsterAI 一致） */
function resolve7zaPath() {
  let path7za;
  try {
    ({ path7za } = require('7zip-bin'));
  } catch (error) {
    throw new Error(
      '缺少依赖 "7zip-bin"，请先 npm install 后重试。' +
      `原始错误: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!path7za || !fs.existsSync(path7za)) {
    throw new Error(`7zip-bin 可执行文件未找到: ${path7za || '(空路径)'}`);
  }
  return path7za;
}

/**
 * 查找 PortableGit 的 bash.exe 路径（与 LobsterAI findPortableGitBash 一致）
 * @param {string} [baseDir=GIT_ROOT]
 * @returns {string|null}
 */
function findPortableGitBash(baseDir = GIT_ROOT) {
  const candidates = [
    path.join(baseDir, 'bin', 'bash.exe'),
    path.join(baseDir, 'usr', 'bin', 'bash.exe'),
    path.join(baseDir, 'mingw64', 'bin', 'bash.exe'),
    path.join(baseDir, 'mingw64', 'usr', 'bin', 'bash.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** 使用 fetch + stream 下载归档（与 LobsterAI 一致，Node 18+） */
async function downloadArchive(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 (${response.status} ${response.statusText}): ${url}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tmpFile = `${destination}.download`;
  try {
    const stream = fs.createWriteStream(tmpFile);
    await pipeline(Readable.fromWeb(response.body), stream);
    if (!isNonEmptyFile(tmpFile)) {
      throw new Error('下载的归档为空。');
    }
    fs.renameSync(tmpFile, destination);
  } catch (error) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // ignore
    }
    throw error;
  }
}

function pruneUnneededFiles() {
  let prunedCount = 0;
  for (const relPath of DIRS_TO_PRUNE) {
    const fullPath = path.join(GIT_ROOT, relPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      prunedCount++;
    } catch (error) {
      console.warn(
        `[prepare-git] 删除失败: ${relPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  console.log(`[prepare-git] 已删除 ${prunedCount} 个不需要的目录/文件`);
}

/**
 * 使用 7zip-bin 解压 .7z.exe 到临时目录，再将内容移动到 GIT_ROOT
 * 归档内通常有一层根目录（如 PortableGit 或 mingw64），需把其内容移到 GIT_ROOT
 */
function extractArchive(archivePath) {
  const sevenZip = resolve7zaPath();
  const extractDir = path.join(GIT_ROOT, '.extract');

  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });

  console.log(`[prepare-git] 使用 7zip-bin 解压: ${archivePath}`);
  const result = spawnSync(sevenZip, ['x', archivePath, `-o${extractDir}`, '-y'], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`7z 解压失败，退出码 ${result.status}`);
  }

  // 将解压出的第一层目录内容移到 GIT_ROOT（归档根可能是 PortableGit 或 mingw64 等）
  const entries = fs.readdirSync(extractDir);
  if (entries.length === 1) {
    const single = path.join(extractDir, entries[0]);
    if (fs.statSync(single).isDirectory()) {
      const subEntries = fs.readdirSync(single);
      for (const e of subEntries) {
        const src = path.join(single, e);
        const dest = path.join(GIT_ROOT, e);
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        fs.renameSync(src, dest);
      }
    } else {
      fs.renameSync(single, path.join(GIT_ROOT, entries[0]));
    }
  } else {
    for (const entry of entries) {
      const src = path.join(extractDir, entry);
      const dest = path.join(GIT_ROOT, entry);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.renameSync(src, dest);
    }
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
}

/**
 * 解析归档来源：环境变量本地文件 → 缓存文件 → 下载
 * @param {boolean} required - 若为 true 且无法得到归档则抛错
 */
async function resolveArchive(required) {
  const envArchive = resolveInputPath(process.env.NUWAX_PORTABLE_GIT_ARCHIVE);
  if (envArchive) {
    if (!isNonEmptyFile(envArchive)) {
      throw new Error(
        `NUWAX_PORTABLE_GIT_ARCHIVE 指向无效文件: ${envArchive}`
      );
    }
    console.log(`[prepare-git] 使用本地归档 NUWAX_PORTABLE_GIT_ARCHIVE: ${envArchive}`);
    return { archivePath: envArchive, source: 'env-archive' };
  }

  if (isNonEmptyFile(DEFAULT_ARCHIVE_PATH)) {
    console.log(`[prepare-git] 使用缓存: ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'cache' };
  }

  const urlFromEnv =
    typeof process.env.NUWAX_GIT_URL === 'string'
      ? process.env.NUWAX_GIT_URL.trim()
      : '';
  const downloadUrl = urlFromEnv || DEFAULT_PORTABLE_GIT_URL;

  try {
    console.log(`[prepare-git] 下载 PortableGit: ${downloadUrl}`);
    await downloadArchive(downloadUrl, DEFAULT_ARCHIVE_PATH);
    const fileSizeMB = (fs.statSync(DEFAULT_ARCHIVE_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`[prepare-git] 已下载 (${fileSizeMB} MB): ${DEFAULT_ARCHIVE_PATH}`);
    return { archivePath: DEFAULT_ARCHIVE_PATH, source: 'download' };
  } catch (error) {
    if (required) {
      throw new Error(
        '无法获取 PortableGit 归档。' +
        '可设置 NUWAX_PORTABLE_GIT_ARCHIVE 为本地离线包路径，或 NUWAX_GIT_URL 为可访问镜像。' +
        `原始错误: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    console.warn(
      '[prepare-git] PortableGit 归档不可用，已跳过（未使用 --required）。' +
      `原因: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * 确保 PortableGit 已准备（与 LobsterAI ensurePortableGit 逻辑一致）
 * @param {{ required?: boolean }} [options]
 */
async function ensurePortableGit(options = {}) {
  const required = Boolean(options.required);
  const isWindows = process.platform === 'win32';
  const force = process.env.NUWAX_SETUP_GIT_FORCE === '1';
  const shouldRun = isWindows || required || force;

  if (!shouldRun) {
    console.log(
      '[prepare-git] 非 Windows 主机跳过（可用 --required 或 NUWAX_SETUP_GIT_FORCE=1 强制为 Windows 打包做准备）'
    );
    return { ok: true, skipped: true, bashPath: null };
  }

  const existingBash = findPortableGitBash();
  if (existingBash) {
    console.log(`[prepare-git] PortableGit 已就绪: ${existingBash}`);
    return { ok: true, skipped: false, bashPath: existingBash };
  }

  const archive = await resolveArchive(required);
  if (!archive) {
    return { ok: true, skipped: true, bashPath: null };
  }

  extractArchive(archive.archivePath);
  const resolvedBash = findPortableGitBash();
  if (!resolvedBash) {
    throw new Error(
      'PortableGit 解压完成但未找到 bash.exe。' +
      `已检查: ${path.join(GIT_ROOT, 'bin', 'bash.exe')} 与 usr/bin、mingw64 等。`
    );
  }

  pruneUnneededFiles();

  const finalSize = getDirSize(GIT_ROOT);
  console.log(`[prepare-git] PortableGit 准备完成: ${resolvedBash}`);
  console.log(`[prepare-git] 总大小: ~${(finalSize / 1024 / 1024).toFixed(1)} MB`);

  return { ok: true, skipped: false, bashPath: resolvedBash };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensurePortableGit({ required: args.required });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[prepare-git] 错误:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  ensurePortableGit,
  findPortableGitBash,
  GIT_VERSION,
  GIT_ROOT,
};

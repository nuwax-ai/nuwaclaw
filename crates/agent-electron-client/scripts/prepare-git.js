#!/usr/bin/env node
/**
 * 多平台 Git 集成：构建前按当前平台准备 resources/git/
 *
 * 参考 LobsterAI 方案：https://github.com/netease-youdao/LobsterAI
 * 
 * Windows: 下载 PortableGit 并精简
 * macOS/Linux: 不需要打包，使用系统 git
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const gitRoot = path.join(projectRoot, 'resources', 'git');

const GIT_VERSION = '2.47.1';
const PORTABLE_GIT_FILE = `PortableGit-${GIT_VERSION}-64-bit.7z.exe`;
const DEFAULT_GIT_URL = `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.1/${PORTABLE_GIT_FILE}`;

// 需要删除的目录（体积）
const D精简IRS_TO_PRUNE = [
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

function getPlatformKey() {
  return process.platform;
}

function download(url, filename) {
  return new Promise((resolve, reject) => {
    const cacheDir = path.join(gitRoot, '.cache');
    const file = path.join(cacheDir, filename);
    
    if (fs.existsSync(file)) {
      // 检查缓存文件是否有效（大于 10MB）
      const stats = fs.statSync(file);
      if (stats.size > 10 * 1024 * 1024) {
        console.log(`[prepare-git] 使用缓存: ${filename}`);
        resolve(file);
        return;
      } else {
        // 缓存文件无效，删除后重新下载
        console.log(`[prepare-git] 缓存文件无效 (${stats.size} bytes)，重新下载`);
        fs.unlinkSync(file);
      }
    }
    
    fs.mkdirSync(cacheDir, { recursive: true });
    
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

function extractArchive(archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = path.extname(archivePath).toLowerCase();
  
  if (ext === '.zip') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${outDir}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`tar -xf "${archivePath}" -C "${outDir}"`, { stdio: 'inherit' });
  }
}

function pruneUnneededFiles() {
  let prunedCount = 0;
  for (const relPath of DIRS_TO_PRUNE) {
    const fullPath = path.join(gitRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      prunedCount++;
    } catch (e) {
      console.warn(`[prepare-git] 删除失败: ${relPath}`);
    }
  }
  console.log(`[prepare-git] 删除了 ${prunedCount} 个不需要的目录/文件`);
}

async function main() {
  const platform = getPlatformKey();
  
  // macOS/Linux 不需要打包 git
  if (platform !== 'win32') {
    console.log(`[prepare-git] ${platform} 不需要打包 git，使用系统自带`);
    return;
  }
  
  // 检查是否已存在
  const gitBin = path.join(gitRoot, 'bin', 'bash.exe');
  if (fs.existsSync(gitBin)) {
    console.log(`[prepare-git] Git 已存在，跳过`);
    return;
  }
  
  const url = process.env.NUWAX_GIT_URL || DEFAULT_GIT_URL;
  console.log(`[prepare-git] 下载 PortableGit ${GIT_VERSION}...`);
  
  try {
    const archivePath = await download(url, PORTABLE_GIT_FILE);
    const extractDir = path.join(gitRoot, '.extract');
    
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    
    console.log(`[prepare-git] 解压...`);
    extractArchive(archivePath, extractDir);
    
    // 移动文件
    const entries = fs.readdirSync(extractDir);
    for (const entry of entries) {
      const src = path.join(extractDir, entry);
      const dest = path.join(gitRoot, entry);
      if (fs.statSync(src).isDirectory()) {
        fs.renameSync(src, dest);
      } else {
        fs.renameSync(src, dest);
      }
    }
    
    // 清理临时目录
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    
    // 精简不需要的文件
    console.log(`[prepare-git] 精简不需要的文件...`);
    pruneUnneededFiles();
    
    console.log(`[prepare-git] Git 准备完成!`);
    
  } catch (err) {
    console.error(`[prepare-git] 失败:`, err.message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
/**
 * 多平台 ttyd 集成：构建前按当前平台准备 resources/ttyd/bin/
 *
 * 源：resources/ttyd/binaries/<platform-key>/ttyd[.exe]
 *     （每平台一个目录；macOS 由 scripts/prepare/build-ttyd-mac.sh 源码编译产出，
 *      Linux/Windows 取 ttyd 官方 release 的预编译二进制）
 *
 * 目标：resources/ttyd/bin/ttyd (或 ttyd.exe)
 *
 * 打包时 electron-builder 的 extraResources 会把
 *   resources/ttyd → .app/Contents/Resources/ttyd
 * 运行时 getTtydBinPath() 优先用 ttyd/binaries/<platform-key>，其次 ttyd/bin/ttyd[.exe]。
 *
 * 平台映射 (Node platform-arch → 目录名)：
 *   darwin-arm64  → darwin-arm64
 *   darwin-x64    → darwin-x64
 *   win32-x64     → win32-x64
 *   linux-x64     → linux-x64
 *   linux-arm64   → linux-arm64
 *
 * 注意：ttyd 官方不提供 macOS 二进制，且当前仓库可能仅内置部分平台的二进制。
 *      缺失当前平台二进制时本脚本「非致命跳过」（仍产出安装包，运行时该平台 ttyd 不可用），
 *      以免阻塞 prepare:all / CI。
 */

const path = require('path');
const fs = require('fs');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const srcBinDir = path.join(projectRoot, 'resources', 'ttyd', 'binaries');
const destBinDir = path.join(projectRoot, 'resources', 'ttyd', 'bin');

// Node platform-arch → binaries/ 下的目录名
const PLATFORM_MAP = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'win32-x64': 'win32-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
};

function getPlatformKey() {
  const a = process.env.TARGET_ARCH || process.arch;
  return `${process.platform}-${a}`;
}

function main() {
  const key = getPlatformKey();
  const dirName = PLATFORM_MAP[key];
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'ttyd.exe' : 'ttyd';

  if (!dirName) {
    console.warn(
      `[prepare-ttyd] 未知平台 ${key}，跳过 ttyd（安装包可正常产出，运行时 Web 终端不可用）`,
    );
    fs.mkdirSync(destBinDir, { recursive: true });
    return;
  }

  const srcPath = path.join(srcBinDir, dirName, exeName);
  const destPath = path.join(destBinDir, exeName);

  // 当前平台二进制不存在时非致命跳过（官方无 mac 二进制、仓库可能只内置部分平台）
  if (!fs.existsSync(srcPath)) {
    console.warn(
      `[prepare-ttyd] 源文件不存在: ${srcPath}，跳过 ttyd 二进制` +
        `（安装包可正常产出，运行时该平台 Web 终端不可用；` +
        `macOS 可运行 scripts/prepare/build-ttyd-mac.sh 生成）`,
    );
    fs.mkdirSync(destBinDir, { recursive: true });
    return;
  }

  // 目标已存在且同架构同大小则跳过
  const platformKeyFile = path.join(destBinDir, '.platform-key');
  if (fs.existsSync(destPath)) {
    let sameKey = false;
    if (fs.existsSync(platformKeyFile)) {
      sameKey = fs.readFileSync(platformKeyFile, 'utf-8').trim() === key;
    }
    if (sameKey) {
      const srcStat = fs.statSync(srcPath);
      const destStat = fs.statSync(destPath);
      if (srcStat.size === destStat.size) {
        console.log(`[prepare-ttyd] ${key} → ${exeName} (已是最新，跳过)`);
        return;
      }
    }
    // 架构不匹配或大小变化：原子覆盖而非 rmSync+copy，避免并发 prepare 抢占时
    // 把 destBinDir 里的半成品清掉。先写到 .tmp 再 rename（POSIX 保证 rename 原子）。
    if (fs.existsSync(platformKeyFile) && !sameKey) {
      console.log(`[prepare-ttyd] 架构不匹配，原子覆盖`);
    }
  }

  fs.mkdirSync(destBinDir, { recursive: true });
  const destTmp = `${destPath}.tmp`;
  fs.copyFileSync(srcPath, destTmp);
  fs.chmodSync(destTmp, 0o755);
  fs.renameSync(destTmp, destPath);
  // 同样用 .tmp + rename 写 .platform-key，避免读到半截字符串。
  const keyTmp = `${platformKeyFile}.tmp`;
  fs.writeFileSync(keyTmp, key, 'utf-8');
  fs.renameSync(keyTmp, platformKeyFile);
  console.log(
    `[prepare-ttyd] ✓ ${destPath} (${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB)`,
  );
  console.log(`[prepare-ttyd] 已写入 .platform-key: ${key}`);
}

main();

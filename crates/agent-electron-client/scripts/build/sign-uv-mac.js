#!/usr/bin/env node
/**
 * macOS 专用：对 resources/uv 下所有可执行文件做 Developer ID 签名（含 hardened runtime、timestamp），
 * 以满足 Apple 公证要求。仅在 process.platform === 'darwin' 时执行。
 *
 * 依赖环境变量：APPLE_SIGNING_IDENTITY（Developer ID Application 证书的 identity，如 SHA-1 或名称）。
 * 若未设置或非 macOS，则跳过。
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const uvRoot = path.join(projectRoot, 'resources', 'uv');

function isExecutable(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    const mode = st.mode;
    return (mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function findExecutables(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        findExecutables(full, list);
      } else if (st.isFile() && isExecutable(full)) {
        list.push(full);
      }
    } catch (_) {}
  }
  return list;
}

function main() {
  if (process.platform !== 'darwin') {
    return;
  }
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (!identity) {
    console.warn('[sign-uv-mac] 未设置 APPLE_SIGNING_IDENTITY，跳过 uv 签名');
    return;
  }
  const executables = findExecutables(uvRoot);
  if (executables.length === 0) {
    console.log('[sign-uv-mac] resources/uv 下无可执行文件，跳过');
    return;
  }
  for (const file of executables) {
    const relative = path.relative(projectRoot, file);
    try {
      execSync(
        `codesign --force --options runtime --timestamp -s "${identity}" "${file}"`,
        { stdio: 'inherit' }
      );
      console.log('[sign-uv-mac] 已签名:', relative);
    } catch (e) {
      console.error('[sign-uv-mac] 签名失败:', relative, e.message);
      process.exit(1);
    }
  }
}

main();

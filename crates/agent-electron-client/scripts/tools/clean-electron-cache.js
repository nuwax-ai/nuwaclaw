#!/usr/bin/env node
/**
 * 清理 Electron / electron-builder 缓存，用于修复「zip: not a valid zip file」等因缓存损坏导致的打包失败。
 * 清理后重新执行 build:electron 会重新下载对应平台的 Electron。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const dirs =
  process.platform === 'darwin'
    ? [
        path.join(home, 'Library', 'Caches', 'electron'),
        path.join(home, 'Library', 'Caches', 'electron-builder'),
      ]
    : process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA || home, 'electron', 'Cache'),
          path.join(process.env.LOCALAPPDATA || home, 'electron-builder', 'Cache'),
        ]
      : [
          path.join(home, '.cache', 'electron'),
          path.join(home, '.cache', 'electron-builder'),
        ];

for (const dir of dirs) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      console.log('[clean-electron-cache] 已删除:', dir);
    }
  } catch (e) {
    console.warn('[clean-electron-cache] 删除失败:', dir, e.message);
  }
}

console.log('[clean-electron-cache] 完成，可重新执行 npm run build:electron -- --win');

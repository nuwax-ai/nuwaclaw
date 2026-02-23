#!/usr/bin/env node
/**
 * 打包前将 file: 依赖 vendors/nuwaxcode-sdk 复制到 node_modules/@nuwax-ai/sdk，
 * 避免 electron-builder 解析符号链接时报错「must be under app directory」。
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const from = path.join(projectRoot, '../../vendors/nuwaxcode-sdk');
const to = path.join(projectRoot, 'node_modules/@nuwax-ai/sdk');

if (!fs.existsSync(from)) {
  console.warn('[prepare-sdk] vendors/nuwaxcode-sdk 不存在，跳过');
  process.exit(0);
}
if (fs.existsSync(to)) {
  fs.rmSync(to, { recursive: true, force: true });
}
fs.cpSync(from, to, { recursive: true });
console.log('[prepare-sdk] 已复制 nuwaxcode-sdk 到 node_modules/@nuwax-ai/sdk');

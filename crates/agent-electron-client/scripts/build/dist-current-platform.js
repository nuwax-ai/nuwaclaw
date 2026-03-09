#!/usr/bin/env node
/**
 * 仅打包当前平台（用于本地无签名构建，避免 node-gyp 交叉编译失败）。
 * 多平台打包请在 CI 上按系统分别执行 dist:mac / dist:win / dist:linux。
 */
const { spawn } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const platform = process.platform;
const unsignedEnv = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  APPLE_SIGNING_IDENTITY: '',
  APPLE_API_KEY: '',
  APPLE_API_KEY_ID: '',
  APPLE_ISSUER_ID: '',
};

let target = '';
if (platform === 'darwin') target = '--mac';
else if (platform === 'win32') target = '--win';
else target = '--linux';

const child = spawn(
  'npm',
  ['run', 'build:electron', '--', target],
  {
    stdio: 'inherit',
    shell: true,
    env: unsignedEnv,
    cwd: getProjectRoot(),
  }
);
child.on('exit', (code) => process.exit(code ?? 0));

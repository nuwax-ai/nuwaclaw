#!/usr/bin/env node
/**
 * 仅打包当前平台（用于本地无签名构建，避免 node-gyp 交叉编译失败）。
 * 多平台打包请在 CI 上按系统分别执行 dist:mac / dist:win / dist:linux。
 *
 * Windows：跳过 electron-builder 自动发现证书，并跳过 afterSign 对 resources 内
 * 成百上千个 Git DLL 的逐个 signtool 签名（否则本地打包会看似“卡住”数十分钟）。
 * 需要正式签名包时请用 CI 或 dist:win（勿设 SKIP_WINDOWS_AFTER_SIGN）。
 */
const { spawn } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const platform = process.platform;
const unsignedEnv = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  CSC_LINK: '',
  WIN_CSC_LINK: '',
  APPLE_SIGNING_IDENTITY: '',
  APPLE_API_KEY: '',
  APPLE_API_KEY_ID: '',
  APPLE_ISSUER_ID: '',
};

if (platform === 'win32') {
  unsignedEnv.SKIP_WINDOWS_AFTER_SIGN = '1';
  unsignedEnv.WINDOWS_CERTIFICATE_SHA1 = '';
  unsignedEnv.WINDOWS_CERTIFICATE_PATH = '';
}

let target = '';
if (platform === 'darwin') target = '--mac';
else if (platform === 'win32') target = '--win';
else target = '--linux';

// 本地打包：跳过 publish（不发布），加快构建速度
const child = spawn(
  'npm',
  ['run', 'build:electron', '--', target, '-p', 'never'],
  {
    stdio: 'inherit',
    shell: true,
    env: unsignedEnv,
    cwd: getProjectRoot(),
  }
);
child.on('exit', (code) => process.exit(code ?? 0));

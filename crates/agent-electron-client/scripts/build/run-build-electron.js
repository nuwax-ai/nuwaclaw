#!/usr/bin/env node
/**
 * electron-builder 入口：先 build，再按需 prepare:all，最后打包。
 * CI 在独立 step 已执行 prepare:all 时设置 SKIP_PREPARE=1，避免重复 prepare（含 git pull）。
 */
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const skipPrepare =
  process.env.SKIP_PREPARE === '1' || process.env.SKIP_PREPARE === 'true';

if (!skipPrepare) {
  console.log('[build:electron] running prepare:all...');
  execSync('npm run prepare:all', { cwd: projectRoot, stdio: 'inherit' });
} else {
  console.log('[build:electron] SKIP_PREPARE=1, skipping prepare:all');
}

const extraArgs = process.argv.slice(2);
const cmd = `npx electron-builder --config.compression=maximum ${extraArgs.join(' ')}`;
console.log('[build:electron]', cmd);
execSync(cmd, { cwd: projectRoot, stdio: 'inherit' });

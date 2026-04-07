#!/usr/bin/env node
/**
 * 准备 nuwax-file-server 源码并复制到 resources/
 *
 * 逻辑：
 *   1. 若 sources/nuwax-file-server 不存在 → git clone + npm install + npm run build
 *   2. 若存在但无 node_modules → npm install + npm run build
 *   3. 否则跳过构建（认为已就绪）
 *   4. 复制到 resources/nuwax-file-server/
 *
 * 产物：
 *   resources/nuwax-file-server/
 *     ├── dist/
 *     ├── node_modules/
 *     └── package.json
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const electronClientRoot = projectRoot;

// 从 package.json 读取源码地址
const pkgJson = JSON.parse(fs.readFileSync(path.join(electronClientRoot, 'package.json'), 'utf8'));
const { url: GIT_REPO, branch: GIT_BRANCH } = pkgJson.bundledSources['nuwax-file-server'];

const SOURCE_DIR = path.join(electronClientRoot, 'sources', 'nuwax-file-server');
const destDir = path.join(electronClientRoot, 'resources', 'nuwax-file-server');

function exec(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function main() {
  // 1. 克隆或更新源码
  if (!fs.existsSync(path.join(SOURCE_DIR, '.git'))) {
    console.log('[prepare-nuwax-file-server] 克隆源码...');
    exec(`git clone --branch ${GIT_BRANCH} ${GIT_REPO} "${SOURCE_DIR}"`);
  } else {
    console.log('[prepare-nuwax-file-server] 更新源码...');
    exec(`cd "${SOURCE_DIR}" && git checkout ${GIT_BRANCH} && git pull`);
  }

  // 2. 检查构建产物是否存在
  const hasBuild = fs.existsSync(path.join(SOURCE_DIR, 'dist'));
  const hasNodeModules = fs.existsSync(path.join(SOURCE_DIR, 'node_modules'));

  if (!hasBuild || !hasNodeModules) {
    // 清理旧的 node_modules（若有）
    if (fs.existsSync(path.join(SOURCE_DIR, 'node_modules'))) {
      console.log('[prepare-nuwax-file-server] 清理旧的 node_modules...');
      exec(`rm -rf "${path.join(SOURCE_DIR, 'node_modules')}"`);
    }

    // 3. 安装依赖
    console.log('[prepare-nuwax-file-server] 安装依赖...');
    exec(`cd "${SOURCE_DIR}" && npm install --ignore-scripts`);

    // 4. 构建
    console.log('[prepare-nuwax-file-server] 构建项目...');
    exec(`cd "${SOURCE_DIR}" && npm run build`);
  } else {
    console.log('[prepare-nuwax-file-server] 构建产物已就绪，跳过构建');
  }

  // 5. 读取版本
  const srcPkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8'));
  console.log(`[prepare-nuwax-file-server] 源码版本: ${srcPkg.name}@${srcPkg.version}`);

  // 6. 清理并创建目标目录
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  // 7. 复制 dist/
  console.log('[prepare-nuwax-file-server] 复制 dist/...');
  exec(`cp -R "${path.join(SOURCE_DIR, 'dist')}" "${destDir}/"`);

  // 8. 复制 package.json
  fs.copyFileSync(
    path.join(SOURCE_DIR, 'package.json'),
    path.join(destDir, 'package.json')
  );

  // 9. 复制 node_modules/
  console.log('[prepare-nuwax-file-server] 复制 node_modules/...');
  exec(`cp -R "${path.join(SOURCE_DIR, 'node_modules')}" "${destDir}/"`);

  // 10. 复制 LICENSE
  const licenseSrc = path.join(SOURCE_DIR, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(destDir, 'LICENSE'));
  }

  console.log(`[prepare-nuwax-file-server] ✓ resources/nuwax-file-server/ (${srcPkg.version})`);
}

main();

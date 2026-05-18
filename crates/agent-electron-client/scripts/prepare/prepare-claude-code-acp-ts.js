#!/usr/bin/env node
/**
 * 准备 claude-code-acp-ts 源码并复制到 resources/
 *
 * 逻辑：
 *   1. 若 sources/claude-code-acp-ts 不存在 → git clone + npm install + npm run build
 *   2. 若存在但无 node_modules → npm install + npm run build
 *   3. 否则跳过构建（认为已就绪）
 *   4. 复制到 resources/claude-code-acp-ts/
 *
 * 产物：
 *   resources/claude-code-acp-ts/
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
const { url: GIT_REPO, branch: GIT_BRANCH } = pkgJson.bundledSources['claude-code-acp-ts'];

const SOURCE_DIR = path.join(electronClientRoot, 'sources', 'claude-code-acp-ts');
const destDir = path.join(electronClientRoot, 'resources', 'claude-code-acp-ts');

function exec(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function execGit(cmd, opts = {}) {
  return exec(`git ${cmd}`, opts);
}

function main() {
  // 0. 版本检查：若源码已存在且目标版本匹配，跳过全部工作
  const srcPkgPath = path.join(SOURCE_DIR, 'package.json');
  const destPkgPath = path.join(destDir, 'package.json');
  if (fs.existsSync(srcPkgPath) && fs.existsSync(destPkgPath)) {
    try {
      const srcPkg = JSON.parse(fs.readFileSync(srcPkgPath, 'utf8'));
      const destPkg = JSON.parse(fs.readFileSync(destPkgPath, 'utf8'));
      if (destPkg.version === srcPkg.version
        && fs.existsSync(path.join(destDir, 'dist'))
        && fs.existsSync(path.join(destDir, 'node_modules'))) {
        console.log(`[prepare-claude-code-acp-ts] ${destPkg.version} 已是最新，跳过`);
        return;
      }
    } catch { /* 版本文件损坏，继续执行 */ }
  }

  const hasBuild = fs.existsSync(path.join(SOURCE_DIR, 'dist'));
  const hasNodeModules = fs.existsSync(path.join(SOURCE_DIR, 'node_modules'));

  // 1. 克隆或更新源码（已有 dist 时跳过 git pull，避免 CI 二次 prepare 时 pull 失败）
  if (!fs.existsSync(path.join(SOURCE_DIR, '.git'))) {
    console.log('[prepare-claude-code-acp-ts] 克隆源码...');
    execGit(`clone --branch ${GIT_BRANCH} --depth 1 ${GIT_REPO} "${SOURCE_DIR}"`);
  } else if (!hasBuild || !hasNodeModules) {
    console.log('[prepare-claude-code-acp-ts] 更新源码...');
    let updated = false;
    // 重试 fetch + checkout 最多 3 次，网络抖动时有用
    for (let attempt = 1; attempt <= 3 && !updated; attempt++) {
      try {
        execGit(`fetch origin ${GIT_BRANCH} --depth=1`, { cwd: SOURCE_DIR });
        execGit(`checkout ${GIT_BRANCH}`, { cwd: SOURCE_DIR });
        execGit(`pull --ff-only origin ${GIT_BRANCH}`, { cwd: SOURCE_DIR });
        updated = true;
      } catch (err) {
        if (attempt === 3) {
          console.warn(
            `[prepare-claude-code-acp-ts] git 更新失败（已重试 ${attempt} 次），继续使用已有源码: ${err.message || err}`,
          );
        } else {
          console.warn(
            `[prepare-claude-code-acp-ts] git 更新失败（尝试 ${attempt}/3），1s 后重试...`,
          );
          execSync('sleep 1', { stdio: 'pipe' });
        }
      }
    }
  } else {
    console.log(
      '[prepare-claude-code-acp-ts] 源码与构建产物已就绪，跳过 git pull',
    );
  }

  // 2. 检查构建产物是否存在

  if (!hasBuild || !hasNodeModules) {
    // 清理旧的 node_modules（若有）
    if (fs.existsSync(path.join(SOURCE_DIR, 'node_modules'))) {
      console.log('[prepare-claude-code-acp-ts] 清理旧的 node_modules...');
      exec(`rm -rf "${path.join(SOURCE_DIR, 'node_modules')}"`);
    }

    // 3. 安装依赖
    console.log('[prepare-claude-code-acp-ts] 安装依赖...');
    exec(`cd "${SOURCE_DIR}" && npm install --ignore-scripts`);

    // 4. 构建
    // 注意：不用 npm run build，因为其 build 脚本可能是 ./node_modules/.bin/tsc（Unix 风格），Windows 不认识
    //改用 npx tsc 替代，可跨平台
    console.log('[prepare-claude-code-acp-ts] 构建项目...');
    exec(`cd "${SOURCE_DIR}" && npx tsc`);
  } else {
    console.log('[prepare-claude-code-acp-ts] 构建产物已就绪，跳过构建');
  }

  // 5. 读取版本
  const srcPkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8'));
  console.log(`[prepare-claude-code-acp-ts] 源码版本: ${srcPkg.name}@${srcPkg.version}`);

  // 6. 清理并创建目标目录
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  // 7. 复制 dist/
  console.log('[prepare-claude-code-acp-ts] 复制 dist/...');
  exec(`cp -R "${path.join(SOURCE_DIR, 'dist')}" "${destDir}/"`);

  // 8. 复制 package.json
  fs.copyFileSync(
    path.join(SOURCE_DIR, 'package.json'),
    path.join(destDir, 'package.json')
  );

  // 9. 复制 node_modules/
  console.log('[prepare-claude-code-acp-ts] 复制 node_modules/...');
  exec(`cp -R "${path.join(SOURCE_DIR, 'node_modules')}" "${destDir}/"`);

  // 10. 复制 LICENSE
  const licenseSrc = path.join(SOURCE_DIR, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(destDir, 'LICENSE'));
  }

  console.log(`[prepare-claude-code-acp-ts] ✓ resources/claude-code-acp-ts/ (${srcPkg.version})`);
}

main();

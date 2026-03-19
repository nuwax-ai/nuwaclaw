#!/usr/bin/env node
/**
 * 从 node_modules 复制 agent-gui-server 到 resources/
 *
 * 前提：
 *   1. pnpm install 已执行（workspace 链接生效）
 *   2. agent-gui-server 已构建（npm run build）
 *
 * 产物：
 *   resources/agent-gui-server/
 *     ├── dist/index.js        — esbuild bundle（原生依赖标记为 external）
 *     ├── node_modules/        — external 原生依赖（sharp, @nut-tree-fork/*, clipboardy）
 *     └── package.json         — 精简版（name/version/type/bin）
 *
 * 打包时 electron-builder extraResources 会打包到
 *   .app/Contents/Resources/agent-gui-server/
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const srcDir = path.join(projectRoot, 'node_modules', 'agent-gui-server');
const destDir = path.join(projectRoot, 'resources', 'agent-gui-server');

// esbuild 中标记为 external 的原生依赖（需要在运行时可用）
const NATIVE_EXTERNALS = ['sharp', '@nut-tree-fork/nut-js', 'clipboardy'];

function main() {
  // 1. 验证 node_modules 中存在 agent-gui-server
  if (!fs.existsSync(path.join(srcDir, 'package.json'))) {
    console.error('[prepare-gui-server] node_modules 中未找到 agent-gui-server');
    console.error('[prepare-gui-server] 请先执行 pnpm install');
    process.exit(1);
  }

  const srcPkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'));
  console.log(`[prepare-gui-server] 源码版本: ${srcPkg.name}@${srcPkg.version}`);

  // 2. 验证必要文件存在
  const srcIndexJs = path.join(srcDir, 'dist', 'index.js');
  if (!fs.existsSync(srcIndexJs)) {
    console.error(`[prepare-gui-server] CLI 入口不存在: ${srcIndexJs}`);
    console.error('[prepare-gui-server] 请先在 crates/agent-gui-server 中执行 npm run build');
    process.exit(1);
  }

  // 3. 检查目标是否已是最新版本
  const destPkgPath = path.join(destDir, 'package.json');
  if (fs.existsSync(destPkgPath)) {
    try {
      const destPkg = JSON.parse(fs.readFileSync(destPkgPath, 'utf8'));
      if (destPkg.version === srcPkg.version) {
        const destIndexJs = path.join(destDir, 'dist', 'index.js');
        if (fs.existsSync(destIndexJs)) {
          const srcSize = fs.statSync(srcIndexJs).size;
          const destSize = fs.statSync(destIndexJs).size;
          if (srcSize === destSize) {
            console.log(`[prepare-gui-server] ${srcPkg.version} 已是最新，跳过`);
            return;
          }
        }
      }
    } catch {
      // 目标损坏，重新复制
    }
  }

  // 4. 清理并创建目标目录
  console.log('[prepare-gui-server] 复制到 resources/agent-gui-server/...');
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(path.join(destDir, 'dist'), { recursive: true });

  // 5. 复制 dist/index.js (esbuild bundle)
  const destIndexJs = path.join(destDir, 'dist', 'index.js');
  fs.copyFileSync(srcIndexJs, destIndexJs);
  fs.chmodSync(destIndexJs, 0o755);
  console.log(`  dist/index.js (${(fs.statSync(destIndexJs).size / 1024).toFixed(0)} KB)`);

  // 6. 安装 external 原生依赖到 resources/agent-gui-server/node_modules/
  //    使用 npm install 确保原生模块为当前平台编译
  const depsToInstall = [];
  for (const dep of NATIVE_EXTERNALS) {
    const ver = srcPkg.dependencies?.[dep];
    if (ver) {
      depsToInstall.push(`${dep}@${ver.replace(/^[\^~]/, '')}`);
    }
  }

  if (depsToInstall.length > 0) {
    // 先写一个临时 package.json 让 npm install 工作
    const tmpPkg = { name: 'agent-gui-server-runtime', version: '0.0.0', private: true };
    fs.writeFileSync(destPkgPath, JSON.stringify(tmpPkg, null, 2) + '\n');

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    // CI 交叉编译支持：TARGET_ARCH 环境变量指定目标架构（如 macOS arm64 runner 构建 x64 包）
    // npm install 通过 --cpu 标志安装目标架构的原生模块
    const targetArch = process.env.TARGET_ARCH;
    const archFlag = targetArch ? ` --cpu=${targetArch}` : '';
    const archLabel = targetArch ? ` (target: ${targetArch})` : '';

    console.log(`  安装原生依赖${archLabel}: ${depsToInstall.join(', ')}...`);
    try {
      execSync(`${npmCmd} install --no-save${archFlag} ${depsToInstall.join(' ')}`, {
        cwd: destDir,
        stdio: 'pipe',
      });
      console.log('  node_modules/ (原生依赖安装完成)');
    } catch (e) {
      console.error('[prepare-gui-server] 原生依赖安装失败:', e.stderr?.toString() || e.message);
      process.exit(1);
    }
  }

  // 7. 生成最终精简版 package.json
  const slimPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    type: 'module',
    bin: { 'agent-gui-server': './dist/index.js' },
  };
  fs.writeFileSync(destPkgPath, JSON.stringify(slimPkg, null, 2) + '\n');
  console.log('  package.json (slim)');

  console.log(`[prepare-gui-server] ✓ resources/agent-gui-server/ (${srcPkg.version})`);
}

main();

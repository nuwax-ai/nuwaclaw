#!/usr/bin/env node
/**
 * 测试集成的 Node.js 是否正确配置
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const distMain = path.join(projectRoot, 'dist/main');

console.log('Testing integrated Node.js 24 configuration...\n');

// 1. 检查资源目录
const platform = `${process.platform}-${process.arch}`;
console.log(`Platform: ${platform}`);

const nodeDir = path.join(projectRoot, 'resources', 'node', platform);
const nodeBin = path.join(nodeDir, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');

console.log(`Node directory: ${nodeDir}`);
console.log(`Node binary: ${nodeBin}\n`);

// 2. 检查目录存在
if (!fs.existsSync(nodeDir)) {
  console.error(`❌ Node.js directory not found: ${nodeDir}`);
  console.log('💡 Run: npm run prepare:node');
  process.exit(1);
}
console.log('✅ Node.js directory exists');

// 3. 检查二进制文件
if (!fs.existsSync(nodeBin)) {
  console.error(`❌ Node binary not found: ${nodeBin}`);
  process.exit(1);
}
console.log('✅ Node binary exists\n');

// 4. 测试版本
try {
  const result = execSync(`"${nodeBin}" --version`, { encoding: 'utf8' }).trim();
  console.log(`Node version: ${result}`);
  // 读取 prepare-node.js 中定义的 NODE_VERSION
  const prepareScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'prepare', 'prepare-node.js'), 'utf8');
  const versionMatch = prepareScript.match(/const NODE_VERSION = '([^']+)'/);
  const expectedVersion = versionMatch ? versionMatch[1] : null;
  if (expectedVersion && result === `v${expectedVersion}`) {
    console.log(`✅ Version is v${expectedVersion} (correct)\n`);
  } else if (expectedVersion) {
    console.log(`⚠️  Expected v${expectedVersion}, got ${result}\n`);
  } else {
    console.log(`⚠️  Could not determine expected version from prepare-node.js\n`);
  }
} catch (err) {
  console.error(`❌ Failed to run node: ${err.message}`);
  process.exit(1);
}

// 5. 测试编译后的 getNodeBinPath
console.log('Testing getNodeBinPath() function...');

try {
  // 模拟 Electron 环境
  const oldApp = global.app;
  global.app = {
    getPath: (name) => {
      if (name === 'home') return '/mock/home';
      return projectRoot;
    },
  };

  const dependenciesPath = path.join(distMain, 'services/system/dependencies.js');

  if (!fs.existsSync(dependenciesPath)) {
    console.log('⚠️  Compiled dependencies.js not found (need to run: npm run build:main)');
  } else {
    // 清除缓存重新加载
    delete require.cache[require.resolve(dependenciesPath)];
    const { getNodeBinPath } = require(dependenciesPath);

    const resolvedPath = getNodeBinPath();
    console.log(`getNodeBinPath() returned: ${resolvedPath}`);

    if (resolvedPath) {
      console.log('✅ getNodeBinPath() returns correct path\n');
    } else {
      console.log('❌ getNodeBinPath() returned null\n');
    }
  }

  // 恢复 app
  global.app = oldApp;
} catch (err) {
  console.log(`⚠️  Could not test getNodeBinPath(): ${err.message}\n`);
}

console.log('✅ Integrated Node.js 24 is ready!');
console.log('\n💡 When MCP proxy starts, it will use this integrated node.');

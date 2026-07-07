#!/usr/bin/env node
/**
 * 准备 claude-code-acp-ts 源码并生成 resources/
 *
 * 逻辑：
 *   1. 若 sources/claude-code-acp-ts 不存在 → git clone + npm install + npm run build
 *   2. 若存在但无 node_modules → npm install + npm run build
 *   3. 否则跳过构建（认为已就绪）
 *   4. 在 staging 目录重新 install 运行时依赖
 *   5. 复制 staging 产物到 resources/claude-code-acp-ts/
 *
 * 产物：
 *   resources/claude-code-acp-ts/
 *     ├── dist/
 *     ├── node_modules/
 *     └── package.json
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const electronClientRoot = projectRoot;

// 从 package.json 读取源码地址
const pkgJson = JSON.parse(fs.readFileSync(path.join(electronClientRoot, 'package.json'), 'utf8'));
const { url: GIT_REPO, branch: GIT_BRANCH } = pkgJson.bundledSources['claude-code-acp-ts'];

const SOURCE_DIR = path.join(electronClientRoot, 'sources', 'claude-code-acp-ts');
const destDir = path.join(electronClientRoot, 'resources', 'claude-code-acp-ts');
const CLAUDE_AGENT_SDK_DIR = path.join(
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk',
);

function exec(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function execGit(cmd, opts = {}) {
  return exec(`git ${cmd}`, opts);
}

function copyDir(srcDir, dstDir) {
  exec(`cp -R "${srcDir}" "${dstDir}"`);
}

/**
 * 将 CI/local build 传入的目标架构统一映射到 claude-agent-sdk 平台包名。
 *
 * 这里不能依赖 npm 在 optionalDependencies 上的自动平台选择：
 * - prepare 脚本常在 Apple Silicon 机器上执行
 * - 但同一台机器会构建 macOS x64 安装包
 * - 如果直接复用宿主机装出来的 node_modules，就会把 darwin-arm64 错打进 x64 包
 */
function resolveClaudeAgentSdkPlatformPackage({
  platform = process.platform,
  targetArch = process.env.TARGET_ARCH || process.arch,
} = {}) {
  const normalizedArch = String(targetArch).trim().toLowerCase();

  if (platform === 'darwin') {
    if (normalizedArch === 'x64') {
      return '@anthropic-ai/claude-agent-sdk-darwin-x64';
    }
    if (normalizedArch === 'arm64') {
      return '@anthropic-ai/claude-agent-sdk-darwin-arm64';
    }
  }

  if (platform === 'win32') {
    if (normalizedArch === 'x64') {
      return '@anthropic-ai/claude-agent-sdk-win32-x64';
    }
    if (normalizedArch === 'arm64') {
      return '@anthropic-ai/claude-agent-sdk-win32-arm64';
    }
  }

  if (platform === 'linux') {
    if (normalizedArch === 'x64') {
      return '@anthropic-ai/claude-agent-sdk-linux-x64';
    }
    if (normalizedArch === 'arm64') {
      return '@anthropic-ai/claude-agent-sdk-linux-arm64';
    }
  }

  throw new Error(
    `[prepare-claude-code-acp-ts] 不支持的目标平台组合: ${platform}/${normalizedArch}`,
  );
}

function getInstalledClaudeAgentSdkPlatformPackages(baseDir) {
  const anthropicDir = path.join(baseDir, 'node_modules', '@anthropic-ai');
  if (!fs.existsSync(anthropicDir)) return [];

  return fs.readdirSync(anthropicDir)
    .filter((name) => name.startsWith('claude-agent-sdk-'))
    .map((name) => `@anthropic-ai/${name}`)
    .sort();
}

/**
 * 在 prepare 阶段显式修正 Claude Agent SDK 的平台子包。
 *
 * npm 在 optionalDependencies 上的自动安装结果依赖“执行安装命令的宿主机架构”，
 * 不是“最终 electron-builder 目标架构”。所以即便我们在干净的 staging 目录里重新 install，
 * 仍然要显式删除错误平台包并补装目标平台包，避免 cross-arch 构建污染。
 */
function ensureClaudeAgentSdkPlatformPackage(baseDir, platformPackage) {
  const installedBefore = getInstalledClaudeAgentSdkPlatformPackages(baseDir);
  const stalePackages = installedBefore.filter((name) => name !== platformPackage);

  for (const pkgName of stalePackages) {
    const pkgDir = path.join(
      baseDir,
      'node_modules',
      '@anthropic-ai',
      pkgName.replace('@anthropic-ai/', ''),
    );
    if (fs.existsSync(pkgDir)) {
      console.log(`[prepare-claude-code-acp-ts] 删除错误平台包: ${pkgName}`);
      fs.rmSync(pkgDir, { recursive: true, force: true });
    }
  }

  const expectedDir = path.join(
    baseDir,
    'node_modules',
    '@anthropic-ai',
    platformPackage.replace('@anthropic-ai/', ''),
  );
  if (!fs.existsSync(expectedDir)) {
    console.log(
      `[prepare-claude-code-acp-ts] 补装目标平台包: ${platformPackage}`,
    );
    exec(`cd "${baseDir}" && npm install --no-save --ignore-scripts ${platformPackage}`);
  }
}

function verifyClaudeAgentSdkPlatformPackage(baseDir, platformPackage) {
  const sdkPkgPath = path.join(baseDir, CLAUDE_AGENT_SDK_DIR, 'package.json');
  if (!fs.existsSync(sdkPkgPath)) {
    throw new Error(
      `[prepare-claude-code-acp-ts] 缺少主包 @anthropic-ai/claude-agent-sdk: ${sdkPkgPath}`,
    );
  }

  const installed = getInstalledClaudeAgentSdkPlatformPackages(baseDir);
  if (!installed.includes(platformPackage)) {
    throw new Error(
      `[prepare-claude-code-acp-ts] 目标平台包缺失: expected=${platformPackage}, actual=${installed.join(', ') || '(none)'}`,
    );
  }

  const extras = installed.filter((name) => name !== platformPackage);
  if (extras.length > 0) {
    throw new Error(
      `[prepare-claude-code-acp-ts] 检测到多余平台包: expected=${platformPackage}, extras=${extras.join(', ')}`,
    );
  }
}

function buildRuntimePackageJson(sourcePackageJson) {
  return {
    name: sourcePackageJson.name,
    version: sourcePackageJson.version,
    description: sourcePackageJson.description,
    main: sourcePackageJson.main,
    types: sourcePackageJson.types,
    bin: sourcePackageJson.bin,
    type: sourcePackageJson.type,
    exports: sourcePackageJson.exports,
    engines: sourcePackageJson.engines,
    dependencies: sourcePackageJson.dependencies || {},
  };
}

function createStagingDir() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), 'prepare-claude-code-acp-ts-'),
  );
}

/**
 * 用独立 staging 目录重新安装运行时依赖，而不是直接复制源码目录 node_modules。
 *
 * 这样 resources/ 里的依赖集合只反映“打包产物实际需要的运行时内容”，不会把源码目录中
 * 的开发依赖、宿主机构建痕迹或历史缓存一股脑带进安装包。
 */
function prepareRuntimeBundle({
  sourceDir,
  stagingDir,
  sourcePackageJson,
  targetPlatformPackage,
}) {
  fs.mkdirSync(stagingDir, { recursive: true });

  copyDir(path.join(sourceDir, 'dist'), `${stagingDir}/`);

  const runtimePackageJson = buildRuntimePackageJson(sourcePackageJson);
  fs.writeFileSync(
    path.join(stagingDir, 'package.json'),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    'utf8',
  );

  const licenseSrc = path.join(sourceDir, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(stagingDir, 'LICENSE'));
  }

  console.log('[prepare-claude-code-acp-ts] 在 staging 目录安装运行时依赖...');
  exec(`cd "${stagingDir}" && npm install --omit=dev --ignore-scripts`);

  ensureClaudeAgentSdkPlatformPackage(stagingDir, targetPlatformPackage);
  verifyClaudeAgentSdkPlatformPackage(stagingDir, targetPlatformPackage);
}

function main() {
  const targetPlatformPackage = resolveClaudeAgentSdkPlatformPackage();
  console.log(
    `[prepare-claude-code-acp-ts] 目标 Claude SDK 平台包: ${targetPlatformPackage}`,
  );

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
        verifyClaudeAgentSdkPlatformPackage(destDir, targetPlatformPackage);
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

    // 对 optionalDependencies 做二次校正，确保 cross-arch 打包时携带的是目标平台包。
    ensureClaudeAgentSdkPlatformPackage(SOURCE_DIR, targetPlatformPackage);
    verifyClaudeAgentSdkPlatformPackage(SOURCE_DIR, targetPlatformPackage);

    // 4. 构建
    // 注意：不用 npm run build，因为其 build 脚本可能是 ./node_modules/.bin/tsc（Unix 风格），Windows 不认识
    //改用 npx tsc 替代，可跨平台
    console.log('[prepare-claude-code-acp-ts] 构建项目...');
    exec(`cd "${SOURCE_DIR}" && npx tsc`);
  } else {
    console.log('[prepare-claude-code-acp-ts] 构建产物已就绪，跳过构建');
    // 即便复用已有 node_modules，也要再次校正/校验一次，避免错误缓存被直接复用。
    ensureClaudeAgentSdkPlatformPackage(SOURCE_DIR, targetPlatformPackage);
    verifyClaudeAgentSdkPlatformPackage(SOURCE_DIR, targetPlatformPackage);
  }

  // 5. 读取版本并在独立 staging 目录重建 runtime bundle
  const srcPkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8'));
  console.log(`[prepare-claude-code-acp-ts] 源码版本: ${srcPkg.name}@${srcPkg.version}`);

  const stagingDir = createStagingDir();
  try {
    prepareRuntimeBundle({
      sourceDir: SOURCE_DIR,
      stagingDir,
      sourcePackageJson: srcPkg,
      targetPlatformPackage,
    });

    // 6. 清理并创建目标目录
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    fs.mkdirSync(destDir, { recursive: true });

    // 7. 复制 staging 产物
    console.log('[prepare-claude-code-acp-ts] 复制 staging runtime bundle...');
    copyDir(path.join(stagingDir, 'dist'), `${destDir}/`);
    copyDir(path.join(stagingDir, 'node_modules'), `${destDir}/`);
    fs.copyFileSync(
      path.join(stagingDir, 'package.json'),
      path.join(destDir, 'package.json'),
    );

    const stagedLicense = path.join(stagingDir, 'LICENSE');
    if (fs.existsSync(stagedLicense)) {
      fs.copyFileSync(stagedLicense, path.join(destDir, 'LICENSE'));
    }

    verifyClaudeAgentSdkPlatformPackage(destDir, targetPlatformPackage);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  console.log(`[prepare-claude-code-acp-ts] ✓ resources/claude-code-acp-ts/ (${srcPkg.version})`);
}

module.exports = {
  resolveClaudeAgentSdkPlatformPackage,
  getInstalledClaudeAgentSdkPlatformPackages,
  ensureClaudeAgentSdkPlatformPackage,
  verifyClaudeAgentSdkPlatformPackage,
  buildRuntimePackageJson,
};

if (require.main === module) {
  main();
}

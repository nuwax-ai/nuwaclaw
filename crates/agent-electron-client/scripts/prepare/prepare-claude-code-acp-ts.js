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
 * macOS x64 交叉编译（arm64 宿主机 + TARGET_ARCH=x64）时，额外用 npm pack 替换
 * Claude SDK 平台子包；其他平台保持原有 npm install + 整包复制流程，不做特殊处理。
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
const DARWIN_X64_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk-darwin-x64';

function exec(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function execGit(cmd, opts = {}) {
  return exec(`git ${cmd}`, opts);
}

/**
 * 是否需要在打包产物中修正 Claude SDK 为 darwin-x64。
 *
 * 仅覆盖一种已知问题场景：GitHub Actions 在 Apple Silicon (arm64) runner 上
 * 交叉构建 macOS Intel (x64) 安装包。此时 npm optionalDependencies 会装上 darwin-arm64。
 *
 * Windows / Linux / macOS arm64 原生构建均返回 false，走原有复制逻辑。
 */
function needsDarwinX64CrossArchBundling({
  platform = process.platform,
  hostArch = process.arch,
  targetArch = process.env.TARGET_ARCH || process.arch,
} = {}) {
  const normalizedTarget = String(targetArch).trim().toLowerCase();
  const normalizedHost = String(hostArch).trim().toLowerCase();
  return platform === 'darwin'
    && normalizedTarget === 'x64'
    && normalizedHost === 'arm64';
}

function getInstalledClaudeAgentSdkPlatformPackages(baseDir) {
  const anthropicDir = path.join(baseDir, 'node_modules', '@anthropic-ai');
  if (!fs.existsSync(anthropicDir)) return [];

  return fs.readdirSync(anthropicDir)
    .filter((name) => name.startsWith('claude-agent-sdk-'))
    .map((name) => `@anthropic-ai/${name}`)
    .sort();
}

function resolveClaudeAgentSdkPlatformPackageVersion(baseDir, platformPackage) {
  const sdkPkgPath = path.join(baseDir, CLAUDE_AGENT_SDK_DIR, 'package.json');
  const sdkPkg = JSON.parse(fs.readFileSync(sdkPkgPath, 'utf8'));
  const version = sdkPkg.optionalDependencies?.[platformPackage];
  if (!version) {
    throw new Error(
      `[prepare-claude-code-acp-ts] 未在 claude-agent-sdk optionalDependencies 中找到 ${platformPackage}`,
    );
  }
  return version;
}

/**
 * 跨架构安装 Claude SDK 平台子包（仅 macOS x64 交叉编译使用）。
 *
 * arm64 runner 上不能 npm install darwin-x64（EBADPLATFORM），
 * 改用 npm pack 拉 tarball 再解压。
 */
function installClaudeAgentSdkPlatformPackage(baseDir, platformPackage, version) {
  const shortName = platformPackage.replace('@anthropic-ai/', '');
  const pkgDir = path.join(baseDir, 'node_modules', '@anthropic-ai', shortName);
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-agent-sdk-pack-'));

  try {
    const spec = `${platformPackage}@${version}`;
    console.log(`[prepare-claude-code-acp-ts] 下载平台包 tarball: ${spec}`);
    const packOutput = execSync(
      `npm pack "${spec}" --pack-destination "${packDir}"`,
      {
        cwd: baseDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'inherit'],
      },
    ).trim();
    const tarballName = packOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    if (!tarballName) {
      throw new Error(
        `[prepare-claude-code-acp-ts] npm pack 未返回 tarball 文件名: ${platformPackage}`,
      );
    }

    const tarballPath = path.join(packDir, tarballName);
    if (!fs.existsSync(tarballPath)) {
      throw new Error(
        `[prepare-claude-code-acp-ts] tarball 不存在: ${tarballPath}`,
      );
    }

    fs.mkdirSync(path.dirname(pkgDir), { recursive: true });
    if (fs.existsSync(pkgDir)) {
      fs.rmSync(pkgDir, { recursive: true, force: true });
    }
    fs.mkdirSync(pkgDir, { recursive: true });
    execSync(`tar -xzf "${tarballPath}" -C "${pkgDir}" --strip-components=1`, {
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
  }
}

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
    const version = resolveClaudeAgentSdkPlatformPackageVersion(
      baseDir,
      platformPackage,
    );
    console.log(
      `[prepare-claude-code-acp-ts] 补装目标平台包: ${platformPackage}@${version}`,
    );
    installClaudeAgentSdkPlatformPackage(baseDir, platformPackage, version);
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

function maybeFixDarwinX64BundledSdk(baseDir) {
  if (!needsDarwinX64CrossArchBundling()) {
    return;
  }

  console.log(
    '[prepare-claude-code-acp-ts] macOS x64 交叉编译：校正 Claude SDK 平台包为 darwin-x64',
  );
  ensureClaudeAgentSdkPlatformPackage(baseDir, DARWIN_X64_SDK_PACKAGE);
  verifyClaudeAgentSdkPlatformPackage(baseDir, DARWIN_X64_SDK_PACKAGE);
}

function main() {
  const crossArchDarwinX64 = needsDarwinX64CrossArchBundling();
  if (crossArchDarwinX64) {
    console.log(
      '[prepare-claude-code-acp-ts] 检测到 macOS x64 交叉编译 (host=arm64, target=x64)',
    );
  }

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
        if (crossArchDarwinX64) {
          verifyClaudeAgentSdkPlatformPackage(destDir, DARWIN_X64_SDK_PACKAGE);
        }
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

  // 2. 安装依赖并构建（所有平台共用）
  if (!hasBuild || !hasNodeModules) {
    if (fs.existsSync(path.join(SOURCE_DIR, 'node_modules'))) {
      console.log('[prepare-claude-code-acp-ts] 清理旧的 node_modules...');
      exec(`rm -rf "${path.join(SOURCE_DIR, 'node_modules')}"`);
    }

    console.log('[prepare-claude-code-acp-ts] 安装依赖...');
    exec(`cd "${SOURCE_DIR}" && npm install --ignore-scripts`);

    console.log('[prepare-claude-code-acp-ts] 构建项目...');
    exec(`cd "${SOURCE_DIR}" && npx tsc`);
  } else {
    console.log('[prepare-claude-code-acp-ts] 构建产物已就绪，跳过构建');
  }

  const srcPkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf8'));
  console.log(`[prepare-claude-code-acp-ts] 源码版本: ${srcPkg.name}@${srcPkg.version}`);

  // 3. 复制到 resources/
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  console.log('[prepare-claude-code-acp-ts] 复制 dist/...');
  exec(`cp -R "${path.join(SOURCE_DIR, 'dist')}" "${destDir}/"`);

  fs.copyFileSync(
    path.join(SOURCE_DIR, 'package.json'),
    path.join(destDir, 'package.json'),
  );

  console.log('[prepare-claude-code-acp-ts] 复制 node_modules/...');
  exec(`cp -R "${path.join(SOURCE_DIR, 'node_modules')}" "${destDir}/"`);

  const licenseSrc = path.join(SOURCE_DIR, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(destDir, 'LICENSE'));
  }

  // 4. 仅 macOS x64 交叉编译：在最终产物里替换 Claude SDK 平台包
  maybeFixDarwinX64BundledSdk(destDir);

  console.log(`[prepare-claude-code-acp-ts] ✓ resources/claude-code-acp-ts/ (${srcPkg.version})`);
}

module.exports = {
  needsDarwinX64CrossArchBundling,
  DARWIN_X64_SDK_PACKAGE,
  resolveClaudeAgentSdkPlatformPackageVersion,
  getInstalledClaudeAgentSdkPlatformPackages,
  ensureClaudeAgentSdkPlatformPackage,
  verifyClaudeAgentSdkPlatformPackage,
};

if (require.main === module) {
  main();
}

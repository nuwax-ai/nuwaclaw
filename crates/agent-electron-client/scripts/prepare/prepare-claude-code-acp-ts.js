#!/usr/bin/env node
/**
 * 准备 claude-code-acp-ts 源码并复制到 resources/
 *
 * 逻辑：
 *   1. 按 package.json bundledSources.claude-code-acp-ts.tag 克隆或 fetch 该 tag
 *   2. 提交变化，或缺少 dist / node_modules 时：npm install + npx tsc
 *   3. 复制到 resources/claude-code-acp-ts/
 *
 * 源码钉在 tag 上，不跟踪分支。换版本只改 package.json 里的 tag。
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
const { url: GIT_REPO, tag: GIT_TAG } = pkgJson.bundledSources['claude-code-acp-ts'];
if (!GIT_REPO || !GIT_TAG) {
  throw new Error(
    '[prepare-claude-code-acp-ts] package.json bundledSources.claude-code-acp-ts 需要 url 与 tag',
  );
}

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
 * 读取 git 命令的 stdout。
 * 用提交号判断工作区是否已经停在目标 tag 上，不能走会把输出打进日志的 exec()。
 */
function gitOutput(args, cwd) {
  return execSync(`git ${args}`, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

/**
 * 把 sources/claude-code-acp-ts 对齐到配置的 tag。
 *
 * tag 不是分支，没有可 fast-forward 的 origin/<tag>，`git pull` 对不上。
 * 这里显式 fetch 这一个 tag，再 detached checkout 到它指向的提交。
 * `--force` 覆盖本地同名 tag：发布方若移动了 tag，下一次 prepare 才能跟上新指向。
 *
 * @returns {'cloned'|'updated'|'unchanged'|'fetch-failed'}
 */
function syncSourceToTag() {
  if (!fs.existsSync(path.join(SOURCE_DIR, '.git'))) {
    console.log(`[prepare-claude-code-acp-ts] 克隆 tag ${GIT_TAG}...`);
    fs.mkdirSync(path.dirname(SOURCE_DIR), { recursive: true });
    // --branch 对 tag 同样有效；--depth 1 只取该 tag 指向的提交。
    execGit(`clone --branch "${GIT_TAG}" --depth 1 "${GIT_REPO}" "${SOURCE_DIR}"`);
    return 'cloned';
  }

  console.log(`[prepare-claude-code-acp-ts] 拉取 tag ${GIT_TAG}...`);
  let fetched = false;
  for (let attempt = 1; attempt <= 3 && !fetched; attempt++) {
    try {
      execGit(`fetch --force --depth=1 origin tag "${GIT_TAG}"`, { cwd: SOURCE_DIR });
      fetched = true;
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
  if (!fetched) return 'fetch-failed';

  // ^{commit} 把附注 tag 剥到提交。轻量 tag 同样适用。
  const head = gitOutput('rev-parse --verify "HEAD^{commit}"', SOURCE_DIR);
  const tagCommit = gitOutput('rev-parse --verify "FETCH_HEAD^{commit}"', SOURCE_DIR);
  if (head === tagCommit) {
    console.log(`[prepare-claude-code-acp-ts] 已在 tag ${GIT_TAG} (${head.slice(0, 8)})`);
    return 'unchanged';
  }

  console.log(
    `[prepare-claude-code-acp-ts] 检出 tag ${GIT_TAG} (${tagCommit.slice(0, 8)})，当前为 ${head.slice(0, 8)}`,
  );
  // --force：这个目录只是构建缓存，本地改动不保留，避免脏工作区挡住切 tag。
  execGit('checkout --detach --force FETCH_HEAD', { cwd: SOURCE_DIR });
  return 'updated';
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

  // 先对齐 tag，再决定要不要构建。
  // 旧逻辑在 dist 已存在时跳过 git，本机若还停在旧分支，会一直用旧提交。
  const syncResult = syncSourceToTag();
  const sourceChanged = syncResult === 'cloned' || syncResult === 'updated';

  const srcPkgPath = path.join(SOURCE_DIR, 'package.json');
  const destPkgPath = path.join(destDir, 'package.json');
  // 提交没变时，产物版本与源码一致就可以整次跳过。
  // 提交变了即使 package.json version 字符串相同也要重建：tag 可能被移动过。
  if (!sourceChanged && fs.existsSync(srcPkgPath) && fs.existsSync(destPkgPath)) {
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

  // 安装依赖并构建（所有平台共用）
  if (sourceChanged || !hasBuild || !hasNodeModules) {
    if (sourceChanged) {
      const distDir = path.join(SOURCE_DIR, 'dist');
      if (fs.existsSync(distDir)) {
        // tsc 只覆盖它再次发出的文件，提交切换后旧 dist 里多余文件会留下来。
        console.log('[prepare-claude-code-acp-ts] 源码提交已变，清理旧的 dist...');
        fs.rmSync(distDir, { recursive: true, force: true });
      }
    }
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

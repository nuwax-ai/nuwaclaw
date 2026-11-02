#!/usr/bin/env node
/**
 * electron-builder 入口：先 build，再按需 prepare:all，最后打包。
 * CI 在独立 step 已执行 prepare:all 时设置 SKIP_PREPARE=1，避免重复 prepare（含 git pull）。
 *
 * 交叉编译时 prepare 脚本必须知道“目标架构”，不能只看宿主机 process.arch。
 * - CI：workflow 通过 TARGET_ARCH 传入 matrix.arch
 * - 本地：从 electron-builder 的 --x64 / --arm64 参数推导并注入 TARGET_ARCH
 */
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

/**
 * 从 electron-builder CLI 参数解析目标 CPU 架构。
 * 支持 --x64、--arm64、--ia32 以及 --arch=x64 形式。
 */
function parseArchFromElectronBuilderArgs(argv) {
  const archFlags = {
    '--x64': 'x64',
    '--arm64': 'arm64',
    '--ia32': 'ia32',
  };

  let resolved = null;
  for (const arg of argv) {
    if (archFlags[arg]) {
      resolved = archFlags[arg];
      continue;
    }

    const match = /^--arch=(.+)$/.exec(arg);
    if (match) {
      resolved = match[1].trim().toLowerCase();
    }
  }

  return resolved;
}

/**
 * 决定 prepare:all 应使用的 TARGET_ARCH。
 *
 * 优先级：
 *   1. 环境变量 TARGET_ARCH（CI workflow 显式传入）
 *   2. electron-builder 参数中的 --x64 / --arm64
 *   3. 宿主机 process.arch（本地原生构建兜底）
 */
function resolveTargetArch(argv, env = process.env, hostArch = process.arch) {
  if (env.TARGET_ARCH) {
    return String(env.TARGET_ARCH).trim().toLowerCase();
  }

  const fromArgs = parseArchFromElectronBuilderArgs(argv);
  if (fromArgs) {
    return fromArgs;
  }

  return String(hostArch).trim().toLowerCase();
}

function main() {
  const projectRoot = getProjectRoot();
  const extraArgs = process.argv.slice(2);
  const targetArch = resolveTargetArch(extraArgs);
  const archFromArgs = parseArchFromElectronBuilderArgs(extraArgs);

  const skipPrepare =
    process.env.SKIP_PREPARE === '1' || process.env.SKIP_PREPARE === 'true';

  const prepareEnv = {
    ...process.env,
    TARGET_ARCH: targetArch,
  };

  if (!skipPrepare) {
    if (archFromArgs && !process.env.TARGET_ARCH) {
      console.log(
        `[build:electron] TARGET_ARCH=${targetArch} (derived from electron-builder args)`,
      );
    } else if (process.env.TARGET_ARCH) {
      console.log(
        `[build:electron] TARGET_ARCH=${targetArch} (from environment)`,
      );
    } else {
      console.log(
        `[build:electron] TARGET_ARCH=${targetArch} (host default)`,
      );
    }

    console.log('[build:electron] running prepare:all...');
    execSync('npm run prepare:all', {
      cwd: projectRoot,
      stdio: 'inherit',
      env: prepareEnv,
    });
  } else {
    console.log('[build:electron] SKIP_PREPARE=1, skipping prepare:all');
  }

  const cmd = `npx electron-builder --config.compression=maximum ${extraArgs.join(' ')}`;
  console.log('[build:electron]', cmd);
  execSync(cmd, { cwd: projectRoot, stdio: 'inherit' });
}

module.exports = {
  parseArchFromElectronBuilderArgs,
  resolveTargetArch,
};

if (require.main === module) {
  main();
}

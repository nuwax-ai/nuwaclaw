#!/usr/bin/env node
/**
 * 并行编排 prepare 脚本，替代 package.json 中的顺序 && 链。
 *
 * 执行策略：
 *   Phase 1: prepare-uv → prepare-sign-uv（签名依赖 uv 二进制，必须顺序执行）
 *   Phase 2: 其余 13 个脚本全部并行（各自操作不同的 resources/ 子目录，互不干扰）
 *
 * 用法：
 *   node scripts/prepare/prepare-all.js
 *   node scripts/prepare/prepare-all.js --dry-run   # 仅打印执行计划，不实际运行
 */

const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const dryRun = process.argv.includes('--dry-run');

/**
 * 执行单个 npm script，返回 Promise<{ name, code }>
 */
function runScript(name) {
  return new Promise((resolve) => {
    if (dryRun) {
      console.log(`[prepare-all] (dry-run) ${name}`);
      resolve({ name, code: 0 });
      return;
    }

    const child = spawn(npmCmd, ['run', name], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      resolve({ name, code: code ?? 0 });
    });

    child.on('error', (err) => {
      console.error(`[prepare-all] ${name} 启动失败: ${err.message}`);
      resolve({ name, code: 1 });
    });
  });
}

/**
 * 顺序执行一组脚本
 */
async function runSequential(scripts) {
  for (const name of scripts) {
    const result = await runScript(name);
    if (result.code !== 0) {
      console.error(`[prepare-all] ${name} 失败 (exit ${result.code})，终止后续脚本`);
      return result;
    }
  }
  return { name: 'sequential-group', code: 0 };
}

/**
 * 并行执行一组脚本，全部完成后再返回。任一失败则整体失败。
 */
async function runParallel(scripts) {
  console.log(`[prepare-all] 并行执行 ${scripts.length} 个脚本: ${scripts.join(', ')}`);
  const results = await Promise.all(scripts.map(runScript));

  const failed = results.filter((r) => r.code !== 0);
  if (failed.length > 0) {
    for (const r of failed) {
      console.error(`[prepare-all] ${r.name} 失败 (exit ${r.code})`);
    }
  }

  return { name: 'parallel-group', code: failed.length > 0 ? 1 : 0 };
}

async function main() {
  const startTime = Date.now();

  console.log('[prepare-all] 开始执行 prepare 脚本...');

  // Phase 1: 有依赖关系，必须顺序执行
  // prepare-sign-uv 需要 prepare-uv 产出的二进制才能签名
  const phase1 = ['prepare:uv', 'prepare:sign-uv'];
  console.log('[prepare-all] Phase 1: 顺序执行 uv + sign-uv');
  const r1 = await runSequential(phase1);
  if (r1.code !== 0) {
    console.error('[prepare-all] Phase 1 失败，终止');
    process.exit(1);
  }

  // Phase 2: 全部并行（各自操作不同的 resources/ 子目录）
  const phase2 = [
    'prepare:node',
    'prepare:git',
    'prepare:lanproxy',
    'prepare:mcp-proxy',
    'prepare:nuwaxcode',
    'prepare:codex-acp',
    'prepare:sandbox-helper-win',
    'prepare:sandbox-runtime',
    'prepare:gui-server',
    'prepare:windows-mcp',
    'prepare:nuwax-file-server',
    'prepare:claude-code-acp-ts',
    'prepare:gateway',
  ];
  console.log(`[prepare-all] Phase 2: 并行执行 ${phase2.length} 个脚本`);
  const r2 = await runParallel(phase2);
  if (r2.code !== 0) {
    console.error('[prepare-all] Phase 2 有脚本失败');
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[prepare-all] 全部完成 (${elapsed}s)`);
}

main().catch((err) => {
  console.error('[prepare-all] 未捕获异常:', err);
  process.exit(1);
});

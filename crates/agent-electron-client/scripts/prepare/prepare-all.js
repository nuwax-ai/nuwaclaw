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
 * Phase 3：resources/ 符号链接清洗——打包前兜底，保证进 electron-builder 产物
 * 的 resources/ 内不存在「绝对路径」或「悬空」（目标缺失/越出子树）的符号链接。
 * 背景：各资源目录的 node_modules 由 CI 全新 npm install 生成，不同环境的 npm
 * 产生的 .bin 链接形态不同（绝对/悬空），macOS codesign --verify --deep --strict
 * 遇到即报 invalid (destination for) symbolic link in bundle，整个 mac 构建失败
 * （v1.0.0–v1.0.3 三连挂的根因族）。相对且可解析的链接（如 macOS framework 的
 * Versions/Current）不受影响。
 */
const fs = require('fs');

function sanitizeSymlinks(dir) {
  let removed = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isSymbolicLink()) {
        let target;
        try {
          target = fs.readlinkSync(full);
        } catch {
          continue;
        }
        const isAbsolute = path.isAbsolute(target);
        const resolves = !isAbsolute && fs.existsSync(full);
        if (isAbsolute || !resolves) {
          console.warn(
            `[prepare-all] 移除非法符号链接: ${path.relative(projectRoot, full)} -> ${target}`,
          );
          try {
            fs.unlinkSync(full);
            removed++;
          } catch (err) {
            console.warn(`[prepare-all] 移除失败(忽略): ${err.message}`);
          }
        }
      }
    }
  };
  walk(dir);
  return removed;
}


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

    try {
      const child = spawn(npmCmd, ['run', name], {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: true,
      });

      child.on('close', (code, signal) => {
        const exitCode = typeof code === 'number' ? code : signal ? 1 : 1;
        resolve({ name, code: exitCode });
      });

      child.on('error', (err) => {
        console.error(`[prepare-all] ${name} 启动失败: ${err.message}`);
        resolve({ name, code: 1 });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[prepare-all] ${name} 启动失败: ${message}`);
      resolve({ name, code: 1 });
    }
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
    console.error(`[prepare-all] ${failed.length} script(s) failed:`);
    for (const r of failed) {
      console.error(`[prepare-all]   - ${r.name} (exit ${r.code})`);
    }
    const critical = failed.filter((r) => r.name === 'prepare:git');
    if (critical.length > 0 && process.platform === 'win32') {
      console.error(
        '[prepare-all] prepare:git failed on Windows: bundled Git Bash is required for dev/build. ' +
          'Fix the error above, then re-run make electron-dev.'
      );
    }
  }

  return { name: 'parallel-group', code: failed.length > 0 ? 1 : 0 };
}

async function main() {
  const startTime = Date.now();

  console.log('[prepare-all] 开始执行 prepare 脚本...');

  // Phase 1: 有依赖关系，必须顺序执行
  // prepare-sign-uv 需要 prepare-uv 产出的二进制才能签名
  // Windows: prepare:git 也在 Phase 1 顺序执行，失败时立即终止，避免与 Phase 2 并行脚本争用 stdio 导致 libuv 崩溃
  const phase1 = ['prepare:uv', 'prepare:sign-uv'];
  if (process.platform === 'win32') {
    phase1.push('prepare:git');
  }
  console.log(
    `[prepare-all] Phase 1: 顺序执行 ${phase1.join(' → ')}`,
  );
  const r1 = await runSequential(phase1);
  if (r1.code !== 0) {
    console.error('[prepare-all] Phase 1 失败，终止');
    if (r1.name === 'prepare:git') {
      console.error(
        '[prepare-all] prepare:git failed: bundled Git Bash is required on Windows. ' +
          'Fix the error above, then re-run make electron-dev.',
      );
    }
    process.exit(1);
  }

  // Phase 2: 全部并行（各自操作不同的 resources/ 子目录）
  const phase2 = [
    'prepare:node',
    ...(process.platform === 'win32' ? [] : ['prepare:git']),
    'prepare:ripgrep',
    'prepare:lanproxy',
    'prepare:ttyd',
    'prepare:mcp-proxy',
    'prepare:sandboxed-mcp',
    'prepare:nuwaxcode',
    'prepare:codex-acp-ts',
    'prepare:sandbox-helper-win',
    'prepare:sandbox-runtime',
    'prepare:gui-server',
    'prepare:windows-mcp',
    'prepare:nuwax-file-server',
    'prepare:claude-code-acp-ts',
  ];
  console.log(`[prepare-all] Phase 2: 并行执行 ${phase2.length} 个脚本`);
  const r2 = await runParallel(phase2);
  if (r2.code !== 0) {
    console.error('[prepare-all] Phase 2 有脚本失败');
    process.exit(1);
  }

  // Phase 3: 符号链接清洗（打包前兜底，见函数头注释）
  if (!dryRun) {
    const resourcesDir = path.join(projectRoot, 'resources');
    const removed = sanitizeSymlinks(resourcesDir);
    console.log(`[prepare-all] Phase 3: 符号链接清洗完成，移除 ${removed} 个非法链接`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[prepare-all] 全部完成 (${elapsed}s)`);
}

main().catch((err) => {
  console.error('[prepare-all] 未捕获异常:', err);
  process.exit(1);
});

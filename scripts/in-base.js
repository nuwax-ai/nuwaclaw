#!/usr/bin/env node
/**
 * 在基座（nuwaclaw/ submodule，基座仓 nuwa-electron-shell main 分支）内执行命令。
 *
 * 社区产品壳：不注入任何 NUWAX_* env——基座默认值即社区版行为
 * （appId com.nuwax-ai.nuwaclaw / 默认端口 / 更新通道 nuwaclaw-electron）。
 * 商业版注入方式参见 nuwax-ai/nuwa-work 壳的 scripts/in-base.js。
 *
 * 用法：
 *   node scripts/in-base.js -- <command> [args...]
 *   npm run base:install / base:dev / base:test / base:bundle
 */
const { spawnSync } = require('child_process');
const path = require('path');

const baseDir = path.join(__dirname, '..', 'nuwaclaw');

const argv = process.argv.slice(2);
if (argv[0] !== '--' || argv.length < 2) {
  console.error('用法: node scripts/in-base.js -- <command> [args...]');
  process.exit(1);
}
const cmd = argv.slice(1);

const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  cwd: baseDir,
  env: process.env,
});
process.exit(result.status ?? 1);

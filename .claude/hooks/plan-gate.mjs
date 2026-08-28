#!/usr/bin/env node
// SDLC Stage-3 门禁（Playbook「Plan mode + plan.md」的会话级落法）
// 规则：对 crates/*/src/** 的首次编辑动作做一次"追问"——工作区若没有任何进行中的 plans/specs 工件，
// 则拦一次并提示先填 templates/plan.md 或确认属计划内工作；同一会话只追问一次（marker 记账），重试即放行。
// 放行条件任一：① 会话已有 marker；② git status 显示 plans/ 或 specs/ 有在途改动；③ NUWACLAW_SKIP_PLAN_GATE=1。
// 协议同 guard-paths：stdin JSON，exit 0 放行 / exit 2 拦截（stderr 提示给 Claude）。
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, isAbsolute, resolve, sep, dirname } from 'node:path';
import { homedir } from 'node:os';

let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let ev;
  try { ev = JSON.parse(raw); } catch { process.exit(0); }

  const tool = ev.tool_name ?? '';
  const cwd = ev.cwd || process.cwd();
  if (process.env.NUWACLAW_SKIP_PLAN_GATE === '1') process.exit(0);

  // 仅盯源码编辑类动作
  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) process.exit(0);
  const fp = String(ev.tool_input?.file_path ?? '');
  if (!fp) process.exit(0);
  const rel = (() => {
    const abs = isAbsolute(fp) ? fp : resolve(cwd, fp);
    return relative(cwd, abs).split(sep).join('/');
  })();
  // 目标不在源码区则放行（文档/模板/plans 自身随便写）
  if (!/^crates\/[^/]+\/src\//.test(rel)) process.exit(0);

  // 会话记账：拦过一次就不再打扰
  const session = String(ev.session_id ?? 'anon').replace(/[^A-Za-z0-9_-]/g, '_');
  const cacheDir = resolve(cwd, '.claude/cache/plan-gate');
  const marker = `${cacheDir}/${session}.flag`;
  if (existsSync(marker)) process.exit(0);

  // 在途工件检查：plans/specs 有任何 dirty/untracked 即视为流程在轨
  let inflow = false;
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', 'plans', 'specs'], { cwd, encoding: 'utf8' });
    inflow = out.trim().length > 0;
  } catch { /* git 不可用时宁放勿拦 */ }

  // 写 marker（无论放行还是拦截，本会话只问一次）
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(marker, new Date().toISOString());

  if (inflow) process.exit(0);
  console.error(
    `[plan-gate] 本次仅提醒一次：检测到对源码「${rel}」的编辑，但工作区没有进行中的 plans/specs 工件。\n` +
    `· 新任务：请先用 templates/plan.md（或配合 skills/requirement-analysis → grill-with-docs 走完整链）建立计划再动工；\n` +
    `· 计划内小修：直接重试刚才的编辑即可放行（同会话不再追问）；\n` +
    `· 停用门禁：设置环境变量 NUWACLAW_SKIP_PLAN_GATE=1。`
  );
  process.exit(2);
});

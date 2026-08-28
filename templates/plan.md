<!--
SDLC Stage 3 · Build 工件模板
用法：spec 通过后在 plan mode 里访谈产出，存 plans/YYYYMMDD-<slug>-plan.md。
闸门：工程师接受本计划才允许动 src；实现偏离计划时在同一 commit 更新本文件（plan-gate 会提醒）。
-->
# 实施计划：{功能 slug}

- 对应 spec：specs/{feature-slug}.md
- 状态：待接受 / 已接受 / 已完成（含偏离记录）

## 改动文件清单

| # | 文件 | 动作(增/改/删) | 说明 |
|---|---|---|---|
| 1 | crates/agent-electron-client/src/main/... | 增 | |

## 实施顺序

1. （步骤间无依赖才能并行 worktree）

## 证明成立的测试

- 新增测试：（失败测试先行的，先提交测试再修码）
- 回归范围：`npm run test:electron`

## 风险与回退

| 风险 | 缓解 | 回退方式 |
|---|---|---|

## 偏离记录

（实现中偏离原计划的，逐条补记：原因 + 与哪个 commit 同步更新）

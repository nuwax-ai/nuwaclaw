<!--
SDLC Stage 1 · Plan 工件模板
用法：cp 此文件为 plans/YYYYMMDD-<slug>-intent.md 后填写；由 .claude/skills/requirement-analysis 驱动生成。
闸门：产品负责人确认接受后，才进入 Design（grill-with-docs → specs/<slug>.md）。
-->
# 意图：{一句话标题}

- 日期：YYYY-MM-DD　发起人：
- 状态：草案 / 已接受 / 已拒绝（决定人 + 日期）

## 问题

（今天做不了什么？现象或痛点是什么？）

## 预期结果

（做完后"更好"长什么样？可观察的验收点，不写实现方案）

## 受影响的用户与系统

（谁用？牵动哪些 crate：agent-electron-client 主进程/渲染进程、agent-kit、gui-server、windows-sandbox-helper、nuwax 子模块？）

## 约束

（时间窗、兼容性、三平台差异、引擎差异 claude-code vs nuwaxcode、发布节奏 tag）

## 开放问题

（逐条列出；每条注明待谁确认——确认结果回填后状态才能置为"已接受"）

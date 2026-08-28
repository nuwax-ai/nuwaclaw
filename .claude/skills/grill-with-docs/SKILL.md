---
name: grill-with-docs
description: 拷问需求、方案和文档，逐步确认术语、边界、异常、风险和待确认问题；当用户要求拷问需求、挑战方案、检查边界、基于文档追问细节，或要把 intent 细化成规格时使用。
---

# Grill With Docs（Design 阶段）

## 目标

不要急着接受现有需求或方案。逐个问题追问，直到边界、术语、风险和不做项足够清楚——这正是规格生成前的访谈环节，产出收敛为 `specs/<feature-slug>.md`（模板见 `templates/spec.md`）。

## 工作方式

1. 先阅读用户提供的需求、技术说明或相关文档。
2. 每次只问一个关键问题，避免一次抛出太多问题。
3. 每个问题都给出推荐答案，方便用户确认或纠正。
4. 如果问题能通过现有文档或代码确认，先自行查证，不要直接问用户。
5. 对已确认的术语、规则和边界，同步回需求或文档：领域术语沉淀到根 `CONTEXT.md`；跨特性难回退的决策立 ADR 到 `docs/adr/`（特性内权衡默认进 spec 的「已否决的备选方案」，格式见 references）。

## 拷问方向

- 这个需求解决的核心问题是什么？
- 哪些场景本期不做？
- 权限、数据范围、按钮显隐是否完整？
- 异常、空数据、接口失败如何处理？
- 是否和现有业务模型或页面习惯冲突？
- 哪些问题必须找产品、测试或负责人确认？

## Nuwaclaw 特有拷问项（本仓适配新增）

- 走的是主进程还是渲染进程？IPC 新增 handler 的话两侧是否都要动？context isolation 有没有被绕开的诱惑？
- claude-code 与 nuwaxcode 两引擎行为差异是否都覆盖了？（参考 crates/agent-electron-client/src/main/services/engines/）
- Windows / macOS / Linux 三平台差异点（沙盒、路径、窗口行为）是否标注了平台矩阵？
- `nuwax/` 子模块 pin 是否需要 bump？改动会不会碰 agents.yaml 等共享配置的语义？
- 新 UI 文案是否走了 react-i18next 的 locales 键而不是硬编码？
- 发布影响面：这次改动是否需要在 release-notes 里占一行？

## 参考

- 术语沉淀：根 `CONTEXT.md`，格式见 `references/context-format.md`
- 架构决策：`docs/adr/`，格式见 `references/adr-format.md`

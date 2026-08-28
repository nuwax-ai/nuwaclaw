---
name: requirement-analysis
description: 把零散想法、口头需求、半成品 PRD、页面改造诉求整理成可执行的需求说明（intent）；当用户提到需求分析、梳理需求、写需求文档、补全场景、功能规划，或要求开始一个新功能时使用。
---

# Requirement Analysis（intent 阶段）

## 目标

把零散需求整理成可以继续评审、开发和测试的需求说明（对应 SDLC 循环的 **Plan 阶段工件 intent**）。重点不是把话写漂亮，而是暴露缺口、明确边界、沉淀 TODO。

## 工作方式

1. 先收集上下文：原始需求、历史文档、相似功能、接口说明、权限规则、已有页面。
2. 按结构整理需求：背景、目标、角色、流程、字段、状态、权限、异常场景。
3. 不确定内容必须标记 TODO，不要替产品或负责人拍板。
4. 如果需求过大，先拆成一期必做、后续增强和明确不做。
5. 输出可执行需求说明，而不是长篇 PRD。
6. **落盘位置**：写回对话的同时存为 `plans/YYYYMMDD-<slug>-intent.md`（从 `templates/intent.md` 起步）。

## 输出结构

```md
# 需求说明：功能名称

## 背景和目标

## 用户角色

## 功能范围

### 本期要做

### 本期不做

## 核心流程

## 字段和状态

## 权限规则

## 异常场景

## TODO / 待确认问题
```

## 下一步（链条衔接）

intent 经确认后 → 进入 [[grill-with-docs]] 拷问细化 → 产出 `specs/<feature-slug>.md` 规格 → 再由 Plan mode 访谈出 `plans/YYYYMMDD-<slug>-plan.md` 才动工。三层模板都在 `templates/`。

## 参考资料

- 需要输出模板时读取 `references/output-templates.md`
- 需要追问清单时读取 `references/question-checklist.md`
- 需要示例时读取 `references/example-crud.md`

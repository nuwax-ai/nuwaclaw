<!--
SDLC Stage 2 · Design 工件模板
用法：intent 接受后，经 grill-with-docs 访谈收敛为本规格；存 specs/<feature-slug>.md。
闸门：技术 lead 审阅通过后才进 Build（plan mode → plans/YYYYMMDD-<slug>-plan.md）。
-->
# 规格：{功能 slug}

- 对应 intent：plans/{YYYYMMDD-slug-intent.md}
- 状态：草稿 / 技术评审通过

## 需求基线

（从 intent 继承：背景目标 / 本期做 / 本期不做。此处只写增量修正，全文引用路径即可）

## 方案设计

### 进程与边界

（主进程 / 渲染进程 / IPC 新增 handler 清单（含两侧改动标注）/ 是否触碰 context isolation）

### 数据与状态

（SQLite 表、Redux store 形状、持久化键）

### 引擎与平台矩阵

| 行为点 | claude-code | nuwaxcode | Win | macOS | Linux |
|---|---|---|---|---|---|

## 异常与失败场景

（空数据 / 引擎不可用 / 网关失败 / 权限拒绝 …）

## 测试计划

（新增/修改哪些 *.test.ts；是否需要 sandbox-integration 层验证）

## i18n 与文案

（新 locales 键清单；默认语言回退）

## 已否决的备选方案

（每个附一句为何不选——plan mode 追问项）

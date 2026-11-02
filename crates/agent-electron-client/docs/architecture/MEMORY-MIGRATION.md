---
version: 1.0
last-updated: 2026-02-25
status: design
---

# Memory 迁移计划（SQLite -> Markdown）

## 1. 目标方案

目标：将记忆语义主存储从 SQLite 迁移到 Markdown，形成可读、可审计、可版本化的 Memory 层。

范围：

- 记忆条目（success/failure/insight）
- EvoMap 节点
- Soul.md 汇总

## 2. 当前实现

当前数据库：

- `sessions`
- `messages`
- `settings`

现状限制：

- 会话数据可持久化，但不等价于长期记忆语义层。

## 3. 分阶段实施

### 阶段 A：Schema 冻结（文档先行）

- 冻结 MD 目录结构与 frontmatter 字段。
- 定义 `append/recall/updateSoul/updateEvoMap` 接口。

退出条件：

- 文档评审通过；字段变更冻结窗口生效。

### 阶段 B：双写上线

- 执行完成后同时写 SQLite 与 MD。
- 记录双写差异日志（条目数、字段缺失、解析失败）。

退出条件：

- 连续 7 天写入成功率 >= 99.5%
- 差异率 <= 1.0%

### 阶段 C：切主读

- Recall 默认读取 MD。
- SQLite 仅作为回滚/兼容读取源。

退出条件：

- 连续 14 天 Recall 成功率 >= 99.0%
- 用户可见回归事件为 0 个 P0/P1

### 阶段 D：收敛

- 缩减 SQLite 在记忆语义上的职责。
- 仅保留会话展示与配置类用途。

退出条件：

- 回滚演练通过率 100%
- 文档与实现一致性审计通过

## 4. 回滚策略（量化）

触发任一条件即回滚到“SQLite 主读”模式：

- 24 小时内 MD 读取失败率 > 2%
- 连续 2 个发布窗口出现 P1 记忆回归
- Soul/EvoMap 写入失败连续超过 30 分钟

回滚动作：

1. 关闭 MD 主读开关
2. 保留双写（若可用）用于诊断
3. 导出失败样本并进入修复队列

## 5. 验收标准

- 每阶段都有可量化退出条件。
- 迁移与回滚都可一键执行（流程化，而非人工临场决策）。
- 用户侧不出现记忆丢失或偏好错乱的 P0/P1 问题。

## 6. 相关文档

- [ARCHITECTURE-INDEX.md](./INDEX.md)
- [ARCHITECTURE-OVERVIEW.md](./OVERVIEW.md)
- [ARCHITECTURE-STORAGE.md](./STORAGE.md)
- [ARCHITECTURE-LOOP.md](./LOOP.md)

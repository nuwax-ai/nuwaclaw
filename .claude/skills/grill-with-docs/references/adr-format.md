# ADR 格式（架构决策记录）

**默认不立 ADR**：特性内的权衡直接写进 `specs/<feature-slug>.md` 的「已否决的备选方案」小节。只有当决策**跨特性、难以回退**、未来读者会疑惑时才单独立 ADR。

**落盘位置：`docs/adr/YYYYMMDD-<slug>.md`**（首次需要时创建目录；`improve-codebase-architecture` 等技能会读这个目录）。

```md
# ADR: 标题

## Status

Accepted（日期）

## Context

（为什么现在要做这个决定；牵动哪些 crate）

## Decision

## Consequences

（含副作用与不再做的事）
```

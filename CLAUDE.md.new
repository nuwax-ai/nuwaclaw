# CLAUDE.md - Agent Harness

> AI 编码 Agent 工程化工作流

---

## 核心原则

1. **输入决定输出** - 结构化任务定义
2. **约束优于自由** - 明确的禁止和必须
3. **反馈创造智能** - 持续的状态追踪

---

## 立即行动

```
1. 读 harness/feedback/state/state.json
2. 读 harness/base/constraints.md
3. 读项目类型约束（harness/projects/{type}/constraints.md）
```

---

## 工作流

```
CP1 → CP2 → CP3 → CP4 → CP5
任务确认 → 规划分解 → 执行实现 → 质量门禁 → 审查完成
```

---

## 命令

| 命令 | 作用 |
|------|------|
| `/state` | 显示状态 |
| `/start <任务>` | 开始任务 |
| `/verify` | 运行门禁 |
| `/done` | 完成任务 |
| `/blocked <原因>` | 报告阻塞 |

---

## 质量门禁

```
Gate 1: npm run lint       → 0 errors
Gate 2: npm run typecheck → 0 errors
Gate 3: npm test           → all pass
Gate 4: npm run build     → 0 errors
```

---

## 详细文档

- `harness/base/constraints.md` - 通用约束
- `harness/projects/{type}/constraints.md` - 项目约束
- `docs/usage.md` - 使用指南
- `docs/agent-tips.md` - Agent 技巧

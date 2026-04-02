# AGENTS.md - Codex / OpenCode 入口

> Codex 和 OpenCode 启动时自动加载

---

## 立即行动

1. 读取 `harness/base/constraints.md`
2. 读取对应项目的约束文件
3. 读取 `harness/feedback/state/state.json`

---

## 支持的项目

| 项目 | 约束文件 |
|------|----------|
| Nuwax | `harness/projects/nuwax/constraints.md` |
| Electron | `harness/projects/electron/constraints.md` |
| 通用 | `harness/projects/generic/constraints.md` |

---

## 工作流

```
CP1 → CP2 → CP3 → CP4 → CP5
任务确认 → 规划分解 → 执行实现 → 质量门禁 → 审查完成
```

---

## 命令

- `/state` - 显示状态
- `/start <任务>` - 开始任务
- `/verify` - 运行门禁
- `/done` - 完成任务
- `/blocked <原因>` - 报告阻塞

---

## 质量门禁

```
Gate 1: npm run lint       → 0 errors
Gate 2: npm run typecheck → 0 errors
Gate 3: npm test           → all pass
Gate 4: npm run build    → 0 errors
```

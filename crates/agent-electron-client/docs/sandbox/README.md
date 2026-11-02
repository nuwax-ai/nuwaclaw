# 沙箱方案文档

> 多平台 Agent 沙箱工作空间技术文档

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 沙箱架构设计 |
| [IMPLEMENTATION.md](./IMPLEMENTATION.md) | 沙箱实现说明 |
| [API.md](./API.md) | 通用 API 文档 |
| [SANDBOX-API.md](./SANDBOX-API.md) | 沙箱 API 接口文档 |
| [SANDBOX-COMMANDS.md](./SANDBOX-COMMANDS.md) | 沙箱命令白名单 |
| [SANDBOX-SUBMODULE-INTEGRATION.md](./SANDBOX-SUBMODULE-INTEGRATION.md) | 三端沙箱子模块接入 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 故障排查 |
| [../operations/SANDBOX-SUBMODULE-UPDATE-RUNBOOK.md](../operations/SANDBOX-SUBMODULE-UPDATE-RUNBOOK.md) | 子模块升级与回滚 Runbook |

---

## 最近同步（2026-04-10）

- 已补充 `PlatformAdapter` 统一平台抽象层在 sandbox 主链路的接入说明
- 已同步 strict 语义：
  - macOS seatbelt strict 不包含 startup chain exec allowlist
  - Windows helper `run` strict 的 `writable_roots` 仅保留首个路径（workspace-first）
- 对应细节见：
  - [ARCHITECTURE.md](./ARCHITECTURE.md)
  - [../operations/ACP-TERMINAL-SANDBOX.md](../operations/ACP-TERMINAL-SANDBOX.md)

---

## 三区隔离模型

```
┌─────────────────────────────────────────────────────────────┐
│                     用户空间（User Space）                   │
│                                                              │
│   ┌─────────────────┐                                      │
│   │  应用核心区       │  只读、不可变                         │
│   ├─────────────────┤                                      │
│   │  Agent 工作区    │  可写、隔离                           │
│   ├─────────────────┤                                      │
│   │  用户系统区      │  只读访问                             │
│   └─────────────────┘                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 平台支持

| 平台 | 主要沙箱 | 备选 |
|------|---------|------|
| macOS | sandbox-exec | Docker |
| Windows | Windows Sandbox helper | Docker |
| Linux | bubblewrap | Docker |

---

## 阅读顺序

1. **ARCHITECTURE.md** - 了解沙箱核心架构
2. **IMPLEMENTATION.md** - 查看实现细节
3. **SANDBOX-API.md** - 参考 API 接口

---

## 相关文档

- [../architecture/ISOLATION.md](../architecture/ISOLATION.md) - 三区隔离模型
- [../v2/01-ARCHITECTURE.md](../v2/01-ARCHITECTURE.md) - 应用架构
- [../AGENTS.md](../AGENTS.md) - Agent 开发指南

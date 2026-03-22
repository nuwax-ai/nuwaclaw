# 沙箱方案文档

> 多平台 Agent 沙箱工作空间技术文档

---

## 📚 文档索引

### 设计文档

| 文档 | 说明 |
|------|------|
| [WORKSPACE-DESIGN.md](./WORKSPACE-DESIGN.md) | 核心设计方案 |
| [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) | 实施计划 |
| [SANDBOX-API.md](./SANDBOX-API.md) | API 接口文档 |

---

## 🎯 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│                   用户空间（User Space）                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           三区隔离模型                                  │   │
│  │                                                      │   │
│  │   ┌─────────────────┐                               │   │
│  │   │  应用核心区       │  只读、不可变                  │   │
│  │   ├─────────────────┤                               │   │
│  │   │  Agent 工作区    │  可写、隔离                    │   │
│  │   ├─────────────────┤                               │   │
│  │   │  用户系统区      │  只读访问                      │   │
│  │   └─────────────────┘                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 平台支持

| 平台 | 主要沙箱 | 备选沙箱 |
|------|---------|---------|
| macOS | Docker | App Sandbox |
| Windows | Docker + WSL2 | Hyper-V |
| Linux | Docker | Firejail |

---

## 📁 目录结构

```
~/.nuwaclaw/
├── core/                    # 应用核心（只读）
├── workspaces/              # 沙箱工作区
│   ├── .shared/           # 共享资源
│   └── {session-id}/       # 会话工作区
│       ├── projects/       # 项目代码
│       ├── node_modules/   # npm 包
│       ├── .venv/         # Python 环境
│       └── .bin/          # 可执行文件
└── logs/                   # 日志
```

---

## 🚀 开发状态

| 组件 | 状态 |
|------|------|
| 设计文档 | ✅ 完成 |
| 类型定义 | 🔄 待实现 |
| SandboxManager 基类 | 🔄 待实现 |
| Docker 沙箱 | 🔄 待实现 |
| WSL 沙箱 | 🔄 待实现 |
| Firejail 沙箱 | 🔄 待实现 |
| WorkspaceManager | 🔄 待实现 |
| PermissionManager | 🔄 待实现 |
| UI 组件 | 🔄 待实现 |

---

## 📖 阅读顺序

1. **WORKSPACE-DESIGN.md** - 了解核心设计理念
2. **IMPLEMENTATION-PLAN.md** - 查看实施计划和任务分解
3. **SANDBOX-API.md** - 参考 API 接口进行开发

---

## 🔗 相关文档

- [../architecture/ISOLATION.md](../architecture/ISOLATION.md) - 三区隔离模型
- [../v2/01-ARCHITECTURE.md](../v2/01-ARCHITECTURE.md) - 应用架构
- [../AGENTS.md](../AGENTS.md) - Agent 开发指南

---

## 📝 更新日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本 |

# 沙箱方案文档（基于 Harness）

> 多平台 Agent 沙箱工作空间技术文档

---

## 📚 文档索引

### 设计文档

| 文档 | 说明 |
|------|------|
| [WORKSPACE-DESIGN.md](./WORKSPACE-DESIGN.md) | 基于 Harness 的核心设计方案 |
| [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) | 实施计划（6 个阶段） |
| [SANDBOX-API.md](./SANDBOX-API.md) | API 接口文档 |

---

## 🎯 核心概念

### Harness 架构

```
┌─────────────────────────────────────────────────────────────┐
│                   CP 工作流                                   │
│                                                              │
│   CP1 ──→ CP2 ──→ CP3 ──→ CP4 ──→ CP5                     │
│   任务     规划     执行     门禁     审查                    │
│   确认                                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   文件结构                                    │
│                                                              │
│   harness/                                                  │
│   ├── base/          # 基础约束和任务模板                     │
│   ├── input/         # 输入约束                              │
│   ├── feedback/      # 反馈机制                              │
│   ├── projects/      # 项目配置                              │
│   └── universal/     # 通用配置                             │
└─────────────────────────────────────────────────────────────┘
```

### 三区隔离模型

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

## 🔧 平台支持

| 平台 | 主要沙箱 | 备选沙箱 |
|------|---------|---------|
| macOS | Docker | App Sandbox |
| Windows | Docker + WSL2 | Hyper-V |
| Linux | Docker | Firejail |

---

## 📁 Harness 目录结构

```
harness/
├── base/
│   ├── constraints.md           # Agent 基础约束
│   ├── tasks/
│   │   ├── sandbox-create.md    # 创建任务模板
│   │   ├── sandbox-destroy.md  # 销毁任务模板
│   │   └── workspace-execute.md # 执行任务模板
│   └── state.json              # 沙箱状态
│
├── input/
│   ├── sandbox-config.md        # 沙箱配置约束
│   ├── platform-config.md       # 平台配置约束
│   └── retention-policy.md      # 保留策略
│
├── feedback/
│   ├── state/
│   │   └── state.json          # 当前状态
│   ├── autonomy.md              # 自主性评估
│   ├── quality-gates.md        # 质量门禁
│   └── metrics.json             # 执行指标
│
└── projects/
    ├── darwin/
    │   ├── constraints.md
    │   └── docker.md
    ├── windows/
    │   ├── constraints.md
    │   └── wsl.md
    └── linux/
        ├── constraints.md
        └── firejail.md
```

---

## 🚀 开发状态

| 组件 | 状态 |
|------|------|
| 设计文档 | ✅ 完成 |
| Harness 目录结构 | 🔄 待创建 |
| 工作流引擎 | 🔄 待实现 |
| Docker 沙箱 | 🔄 待实现 |
| WSL 沙箱 | 🔄 待实现 |
| Firejail 沙箱 | 🔄 待实现 |
| WorkspaceManager | 🔄 待实现 |
| PermissionManager | 🔄 待实现 |
| UI 组件 | 🔄 待实现 |

---

## 📖 阅读顺序

1. **WORKSPACE-DESIGN.md** - 了解 Harness 核心设计理念
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
| 2026-03-22 | 1.0.0 | 初始版本，基于 Harness 架构 |

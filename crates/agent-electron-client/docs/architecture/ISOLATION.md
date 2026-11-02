---
version: 1.0
last-updated: 2026-02-24
status: design
---

# Agent 自我进化架构 - 隔离策略

## 概述

本文档详细描述 Nuwax Agent 的隔离策略，通过三区模型实现安全的受限自由，平衡用户体验与 Agent 能力。

---

## 核心洞察

这是一个**二元矛盾**：

| 极端 A：过度保护 | 极端 B：完全自由 |
|-----------------|-----------------|
| ❌ Agent 无法安装工具 | ❌ 用户环境被污染 |
| ❌ 无法自我迭代升级 | ❌ 依赖版本冲突 |
| ❌ 能力被限制死 | ❌ 门槛极高 |

**我们的目标：中间地带 —— 安全的受限自由**

---

## 三区隔离模型

```
┌──────────────────────────────────────────────────────────────────┐
│  应用核心区 (App Core)                                           │
│  ─────────────────────────                                              │
│  - 内容: Electron, Node.js, uv, 核心引擎                         │
│  - 特点: 完全受控，不可变                                         │
│  - 目的: 保证应用稳定性                                          │
│  - Agent 权限: 只读                                              │
├──────────────────────────────────────────────────────────────────┤
│  Agent 工作区 (Agent Workspace)                                  │
│  ────────────────────────                                       │
│  - 内容: 工具、依赖、缓存、临时文件                               │
│  - 特点: Agent 可写，受应用管理                                   │
│  - 目的: Agent 自我迭代的空间                                     │
│  - Agent 权限: 完全控制                                          │
├──────────────────────────────────────────────────────────────────┤
│  用户系统区 (User System)                                        │
│  ────────────────────                                           │
│  - 内容: 系统工具、用户配置                                       │
│  - 特点: 只读访问，受污染风险                                     │
│  - 目的: 兼容性回退                                              │
│  - Agent 权限: 只读调用                                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Agent 自由度边界

| 能力 | 允许 | 限制 | 原因 |
|------|------|------|------|
| **安装 npm 包** | ✅ 到工作区 | ❌ 到全局 | 避免污染用户环境 |
| **安装 Python 包** | ✅ 通过 uv | ❌ 系统 pip | 隔离环境 |
| **修改配置** | ✅ 工作区内 | ❌ 应用配置 | 保护核心 |
| **执行系统命令** | ✅ 只读工具 | ❌ 写入操作 | 安全考虑 |
| **自我升级** | ✅ 工作区依赖 | ❌ 引擎核心 | 稳定性优先 |

---

## 目录结构设计

```
~/.nuwaclaw/
├── core/                      # 应用核心区（只读）
│   ├── engines/               # 引擎二进制（应用管理）
│   └── config/                # 应用配置（用户通过 UI 修改）
│
├── workspace/                 # Agent 工作区（Agent 可写）
│   ├── {session-id}/
│   │   ├── node_modules/      # Agent 安装的 npm 包
│   │   ├── .venv/             # Agent 创建的 Python 环境
│   │   ├── tools/             # Agent 下载/编译的工具
│   │   ├── cache/             # 缓存文件
│   │   └── projects/          # Agent 操作的项目
│
├── shared/                    # 共享资源（受控）
│   └── tools/                 # 跨会话共享的工具
│
└── logs/                      # 日志（审计）
```

---

## 环境变量策略

### 应用核心环境

```typescript
// 应用核心：严格隔离
const coreEnv = {
  PATH: [
    '~/.nuwaclaw/core/engines',
    '~/.nuwaclaw/core/bin',
  ].join(':'),
  // 最小化环境变量
};
```

### Agent 工作区环境

```typescript
// Agent 工作区：灵活但受控
const agentEnv = {
  // 核心工具（来自应用）
  PATH: [
    '~/.nuwaclaw/core/engines',
    '~/.nuwaclaw/core/bin',
  ],

  // Agent 工作区（Agent 可添加）
  PATH: [
    './node_modules/.bin',      // Agent 安装的包
    './tools/bin',              // Agent 安装的工具
    './.venv/bin',              // Agent 创建的 venv
  ],

  // 安装目标（指向工作区）
  npm_config_prefix: './workspace/tools/npm',
  UV_TOOL_DIR: './workspace/tools/uv',
  PYTHONPATH: './workspace/python',

  // 系统工具回退（只读）
  PATH: [
    '/usr/bin', '/bin', '/usr/sbin',  // git, bash 等
  ].filter(systemPathsOnly),
};
```

---

## Agent 能力接口

```typescript
// Agent 可以请求的权限
interface AgentCapabilities {
  // 安装工具（到工作区）
  installNpmPackage: (name: string, version?: string) => Promise<void>;
  installPythonPackage: (name: string) => Promise<void>;
  downloadTool: (url: string, checksum: string) => Promise<string>;

  // 执行命令（受控）
  executeCommand: (cmd: string, args: string[]) => Promise<ExecuteResult>;

  // 文件操作（沙箱内）
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;

  // 自我升级（工作区内）
  upgradeSelf: () => Promise<void>;  // 升级工作区依赖
}
```

---

## Agent 自我迭代场景

### 场景 1: Agent 发现需要新工具

```typescript
// Agent 的思考过程
// "我需要 jq 来处理 JSON，但系统没有"

// Agent 行动
await capabilities.installNpmPackage('jq');  // 安装到工作区

// 结果
~/.nuwaclaw/workspace/{session-id}/node_modules/.bin/jq
// ✅ Agent 可以使用
// ✅ 不污染用户环境
// ✅ 会话结束可清理
```

### 场景 2: Agent 发现更好的工具版本

```typescript
// Agent 的思考过程
// "nuwaxcode 有新版本，性能更好"

// Agent 行动
await capabilities.installNpmPackage('@nuwax/nuwaxcode@latest');

// 结果
~/.nuwaclaw/workspace/{session-id}/node_modules/.bin/nuwaxcode
// ✅ Agent 使用新版本
// ✅ 应用核心引擎不受影响
// ✅ 可以回滚
```

### 场景 3: Agent 需要编译工具

```typescript
// Agent 的思考过程
// "这个项目需要 cargo build"

// Agent 行动
if (!await capabilities.hasCommand('cargo')) {
  await capabilities.downloadTool('https://rustup.rs', 'sha256:...');
  await capabilities.executeCommand('./rustup-init', ['--profile', 'minimal', '-y']);
}

// 结果
~/.nuwaclaw/workspace/{session-id}/tools/bin/cargo
// ✅ Agent 可以编译项目
// ✅ 不影响用户系统
```

---

## 安全考虑

### 沙箱边界

```typescript
// Agent 操作白名单
const ALLOWED_OPERATIONS = {
  // 文件：只能在工作区和用户指定目录
  file: {
    read: ['workspace/**', 'user-selected/**'],
    write: ['workspace/**', 'user-selected/**'],
  },

  // 网络：需要用户确认
  network: {
    download: 'prompt',      // 每次询问
    apiCall: 'allowed',       // 配置的 API
  },

  // 执行：受限命令
  execute: {
    safe: ['git', 'grep', 'find'],  // 允许
    dangerous: ['rm', 'dd', 'mkfs'], // 禁止或高权限确认
  },
};
```

### 资源限制

```typescript
// 防止 Agent 占用过多资源
const AGENT_LIMITS = {
  maxDiskUsage: '5GB',          // 工作区大小限制
  maxExecutionTime: 300000,      // 单个命令超时
  maxMemoryUsage: '2GB',         // 内存限制
  maxNetworkBandwidth: '10MB/s', // 网络限制
};
```

### 审计日志

```typescript
// 记录所有 Agent 操作
interface AgentAuditLog {
  timestamp: number;
  sessionId: string;
  operation: 'install' | 'execute' | 'download' | 'write';
  target: string;
  approvedBy: 'auto' | 'user' | 'policy';
  result: 'success' | 'failed' | 'denied';
}
```

---

## 用户体验设计

### 原则: 用户看到的简单，不是能力的简单

```
用户看到                   Agent 实际在做
─────────────────────────────────────────────
"正在分析项目..."     →    检测依赖 → 安装工具 → 配置环境
"正在安装依赖..."     →    npm install → uv pip install
"正在构建..."         →    cargo build → 编译工具链
```

### 透明度控制

| 用户类型 | 可见性 | 控制权 |
|----------|--------|--------|
| **普通用户** | 简化状态 | 启动/停止 |
| **进阶用户** | 详细日志 | 允许/拒绝操作 |
| **开发者** | 完全透明 | 完全控制 |

---

## 产品验证问题

在做技术决策时，问：

1. **这会限制 Agent 的能力吗？**
   - 如果是 → 能否通过工作区机制解决？

2. **这会损害用户体验吗？**
   - 如果是 → 能否隐藏复杂性？

3. **Agent 可以自我迭代吗？**
   - 如果不能 → 需要增加什么接口？

4. **边界足够安全吗？**
   - 如果不是 → 需要什么限制？

---

## 总结

**核心哲学：**

```
简单 ≠ 能力弱

我们追求的是：
  - 用户界面：简单、友好、零门槛
  - Agent 环境：灵活、强大、可成长

通过架构设计，而不是能力限制来实现简单。
```

**关键架构决策：**

1. **三层隔离** - 核心 / 工作区 / 系统
2. **权限分级** - 只读 / 受控写入 / 完全控制
3. **透明度分层** - 简化 / 详细 / 完全

**最终目标：**

> 让用户觉得简单，同时让 Agent 有能力变得更强。

---

## 相关文档

- [总览](./OVERVIEW.md) - 产品定位、核心原则
- [核心组件](./COMPONENTS.md) - Memory、Skill Creator、EvoMap、Soul.md
- [循环流程](./LOOP.md) - 完整循环流程、接口定义
- [存储实现](./STORAGE.md) - Markdown 格式、索引机制

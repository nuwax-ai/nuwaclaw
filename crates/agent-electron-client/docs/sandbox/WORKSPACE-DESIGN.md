# 沙箱工作空间设计方案

> 基于 Harness 架构的多平台 Agent 沙箱工作空间
> 
> **版本**: 1.0.0  
> **更新**: 2026-03-22  
> **状态**: 设计完成，待实现

---

## 1. 概述

### 1.1 目标

为 Nuwax Agent 提供一个**安全隔离的沙箱工作空间**，支持：
- 多平台（macOS / Windows / Linux）
- 多会话并行运行
- 工作区资源隔离与清理
- 安全的文件系统访问

### 1.2 核心原则

```
┌─────────────────────────────────────────────────────────────┐
│                     用户空间（User Space）                   │
│  - 安全的受限自由                                             │
│  - 能力与安全的平衡                                           │
│  - 用户可控的隔离级别                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Harness 架构

### 2.1 目录结构

```
harness/
├── base/                      # 基础约束和任务模板
│   ├── constraints.md        # Agent 基础约束
│   ├── tasks/
│   │   ├── sandbox-create.md
│   │   ├── sandbox-destroy.md
│   │   ├── workspace-execute.md
│   │   └── permission-request.md
│   └── state.json            # 沙箱状态追踪
│
├── input/                     # 输入约束
│   ├── sandbox-config.md
│   ├── platform-config.md
│   └── retention-policy.md
│
├── feedback/                  # 反馈机制
│   ├── state/
│   │   └── state.json        # 当前工作区状态
│   ├── autonomy.md           # 自主性评估
│   ├── quality-gates.md      # 质量门禁记录
│   └── metrics.json          # 执行指标
│
├── projects/                  # 项目配置
│   ├── macos/
│   │   ├── constraints.md
│   │   └── docker.md
│   ├── windows/
│   │   ├── constraints.md
│   │   └── wsl.md
│   └── linux/
│       ├── constraints.md
│       └── firejail.md
│
└── universal/                 # 通用配置
    ├── commands.md
    └── security.md
```

### 2.2 CP 工作流

```
CP1: 任务确认 → CP2: 规划分解 → CP3: 执行实现 → CP4: 质量门禁 → CP5: 审查完成

┌──────────────────────────────────────────────────────────────────┐
│  CP1 - 任务确认                                                   │
│  ─────────────                                                   │
│  - 解析 sandbox 请求（类型、平台、工作区）                           │
│  - 验证参数完整性                                                  │
│  - 输出: validated sandbox config                                  │
├──────────────────────────────────────────────────────────────────┤
│  CP2 - 规划分解                                                   │
│  ─────────────                                                   │
│  - 确定沙箱类型（docker/wsl/firejail）                             │
│  - 分配工作区资源                                                  │
│  - 输出: execution plan                                           │
├──────────────────────────────────────────────────────────────────┤
│  CP3 - 执行实现                                                   │
│  ─────────────                                                   │
│  - 创建/销毁沙箱                                                  │
│  - 执行命令（带权限检查）                                          │
│  - 输出: execution result                                        │
├──────────────────────────────────────────────────────────────────┤
│  CP4 - 质量门禁                                                   │
│  ─────────────                                                   │
│  - 验证输出格式                                                   │
│  - 检查资源使用                                                   │
│  - 输出: gate results                                             │
├──────────────────────────────────────────────────────────────────┤
│  CP5 - 审查完成                                                   │
│  ─────────────                                                   │
│  - 更新 state.json                                                │
│  - 记录 metrics                                                  │
│  - 输出: final report                                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 状态管理

### 3.1 State JSON

```json
{
  "project": "sandbox-workspace",
  "version": "1.0.0",
  "type": "sandbox",
  "platform": "darwin",
  "lastUpdated": "2026-03-22",
  
  "currentTask": null,
  "taskStatus": "idle",
  "stage": "none",
  
  "checkpoints": {
    "CP1": "pending",
    "CP2": "pending", 
    "CP3": "pending",
    "CP4": "pending",
    "CP5": "pending"
  },
  
  "gates": {
    "config-validate": "pending",
    "sandbox-create": "pending",
    "execute": "pending",
    "cleanup": "pending"
  },
  
  "metrics": {
    "sandboxesCreated": 0,
    "sandboxesDestroyed": 0,
    "executionsCompleted": 0,
    "executionsBlocked": 0,
    "averageExecutionTime": 0,
    "humanInterventions": 0
  },
  
  "workspaces": {
    "{session-id}": {
      "createdAt": "2026-03-22",
      "lastAccessed": "2026-03-22",
      "sandboxType": "docker",
      "status": "active"
    }
  },
  
  "recentChanges": []
}
```

### 3.2 Metrics JSON

```json
{
  "sessionId": "{session-id}",
  "timestamp": "2026-03-22T12:00:00Z",
  
  "execution": {
    "total": 10,
    "success": 9,
    "failed": 1,
    "blocked": 0,
    "averageDuration": 2500
  },
  
  "permissions": {
    "requested": 5,
    "approved": 3,
    "denied": 2,
    "autoApproved": 3
  },
  
  "resources": {
    "memoryUsed": "512mb",
    "cpuTime": "30s",
    "diskUsed": "100mb",
    "networkCalls": 5
  }
}
```

---

## 4. 质量门禁

### 4.1 Gate 定义

| Gate | 说明 | 检查项 |
|------|------|--------|
| **config-validate** | 配置验证 | platform 有效、memory limit 合理 |
| **sandbox-create** | 沙箱创建 | 容器启动成功、目录创建成功 |
| **execute** | 命令执行 | exit code 0、超时检查 |
| **cleanup** | 清理验证 | 资源释放、临时文件删除 |

### 4.2 质量门禁示例

```typescript
const QUALITY_GATES = {
  'config-validate': async (config: SandboxConfig) => {
    const validPlatforms = ['darwin', 'win32', 'linux'];
    const validTypes = ['docker', 'wsl', 'firejail', 'none'];
    
    if (!validPlatforms.includes(config.platform)) {
      return { pass: false, reason: `Invalid platform: ${config.platform}` };
    }
    
    if (!validTypes.includes(config.type)) {
      return { pass: false, reason: `Invalid sandbox type: ${config.type}` };
    }
    
    // Memory limit 检查 (1GB - 8GB)
    const memoryMB = parseMemory(config.memoryLimit);
    if (memoryMB < 1024 || memoryMB > 8192) {
      return { pass: false, reason: 'Memory limit must be between 1GB and 8GB' };
    }
    
    return { pass: true };
  },
  
  'sandbox-create': async (workspace: Workspace) => {
    // 检查目录存在
    // 检查 Docker 容器运行中
    // 检查网络连接
    return { pass: true };
  },
  
  'execute': async (result: ExecuteResult) => {
    if (result.timedOut) {
      return { pass: false, reason: 'Execution timed out' };
    }
    return { pass: result.exitCode === 0, reason: `Exit code: ${result.exitCode}` };
  },
  
  'cleanup': async (workspaceId: string) => {
    // 检查目录已删除
    // 检查容器已停止
    // 检查进程已终止
    return { pass: true };
  }
};
```

---

## 5. 任务模板

### 5.1 沙箱创建任务

```markdown
# 任务: 创建沙箱工作区

## 输入
- sessionId: string
- platform: darwin | win32 | linux
- sandboxType: docker | wsl | firejail | none
- memoryLimit?: string (默认 "2g")
- diskQuota?: string (默认 "10g")

## CP1: 任务确认
- [ ] 验证 sessionId 非空
- [ ] 验证 platform 与当前系统匹配
- [ ] 验证 sandboxType 可用

## CP2: 规划分解
- [ ] 确定沙箱镜像/配置
- [ ] 分配工作区路径
- [ ] 设置资源限额

## CP3: 执行实现
- [ ] 创建工作区目录结构
- [ ] 启动沙箱容器/进程
- [ ] 注入环境变量

## CP4: 质量门禁
- [ ] config-validate gate
- [ ] sandbox-create gate

## CP5: 审查完成
- [ ] 更新 state.json
- [ ] 记录 metrics
- [ ] 返回 workspace 对象
```

### 5.2 命令执行任务

```markdown
# 任务: 在沙箱中执行命令

## 输入
- sessionId: string
- command: string
- args: string[]
- options?: ExecuteOptions

## CP1: 任务确认
- [ ] 验证 sessionId 存在
- [ ] 验证 command 非空
- [ ] 检查命令白名单

## CP2: 规划分解
- [ ] 确定工作目录
- [ ] 检查权限
- [ ] 设置超时

## CP3: 执行实现
- [ ] 请求权限（如需要）
- [ ] 执行命令
- [ ] 捕获输出

## CP4: 质量门禁
- [ ] execute gate (exit code, timeout)

## CP5: 审查完成
- [ ] 记录 execution metrics
- [ ] 返回 ExecuteResult
```

---

## 6. 约束定义

### 6.1 基础约束

```markdown
# Agent 沙箱基础约束

## 绝对禁止
- ❌ 访问 ~/.ssh/ 目录
- ❌ 修改系统配置文件
- ❌ 安装系统级包（apt-get install, brew install 等）
- ❌ 执行危险命令（rm -rf /, dd, mkfs 等）
- ❌ 网络扫描或端口探测

## 需要确认
- ⚠️ 安装 npm 包（超过 10 个）
- ⚠️ 安装 Python 包（超过 10 个）
- ⚠️ 下载外部资源
- ⚠️ 执行时间超过 5 分钟的命令

## 自动允许
- ✅ 读取工作区文件
- ✅ 执行 git, npm, pnpm, node, python, cargo, make
- ✅ 访问已配置的 API 端点
```

### 6.2 平台约束

```markdown
# macOS 沙箱约束

## 特定限制
- App Sandbox 模式: 网络访问受限
- Docker 模式: 使用 Docker Desktop 容器
- 资源限制: CPU 2核, 内存 2GB

# Windows 沙箱约束

## 特定限制
- WSL 模式: 需要 WSL2 安装
- Docker 模式: 使用 Docker Desktop
- 路径转换: 自动处理 \ 和 /

# Linux 沙箱约束

## 特定限制
- Docker 模式: 原生 Docker 支持
- Firejail 模式: 需要 firejail 安装
- 资源限制: 按 cgroup 强制执行
```

---

## 7. 自主性评估

### 7.1 评分维度

| 维度 | 权重 | 说明 |
|------|------|------|
| **自动化率** | 40% | 多少次操作是自动批准无需用户确认 |
| **任务完成率** | 30% | 多少任务成功完成 |
| **拦截有效率** | 20% | 拦截的危险操作有多少是真正的威胁 |
| **用户满意度** | 10% | 用户批准 vs 拒绝的比例 |

### 7.2 自主性报告

```markdown
# 沙箱自主性报告

## 概览
- 总执行次数: 100
- 自动批准: 85
- 需要确认: 12
- 拦截危险: 3

## 评分
- 自动化率: 85% (A)
- 任务完成率: 97% (A)
- 拦截有效率: 100% (A)
- 用户满意度: 85% (B+)

## 综合评分: A (92/100)

## 改进建议
1. 考虑将 'npm install' 加入自动批准白名单
2. 增加常见开发工具的预安装
3. 优化网络访问的白名单策略
```

---

## 8. 相关文档

| 文档 | 说明 |
|------|------|
| [IMPLANTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) | 基于 Harness 的实施计划 |
| [SANDBOX-API.md](./SANDBOX-API.md) | API 接口文档 |
| [../architecture/ISOLATION.md](../architecture/ISOLATION.md) | 三区隔离模型 |

---

## 9. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本，基于 Harness 架构重构 |

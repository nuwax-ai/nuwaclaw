# 沙箱方案实施计划

> **版本**: 1.0.0  
> **更新**: 2026-03-22  
> **状态**: 待开发

---

## 1. 项目概述

### 1.1 目标

为 Nuwax Agent Electron 客户端实现一个**多平台沙箱工作空间系统**，提供：
- 安全隔离的 Agent 执行环境
- 多会话并行支持
- 跨平台（macOS / Windows / Linux）一致体验
- 可视化的权限管理和审计

### 1.2 依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                    渲染进程 (React)                          │
│  - WorkspaceManager UI                                       │
│  - PermissionApprovalDialog                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │ IPC
┌─────────────────────────▼───────────────────────────────────┐
│                    主进程 (Main)                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ WorkspaceManager │  │PermissionManager│                  │
│  └────────┬─────────┘  └────────┬────────┘                  │
│           │                     │                            │
│  ┌────────▼─────────┐  ┌────────▼─────────┐                  │
│  │ SandboxManager   │  │ PermissionPolicy│                  │
│  │ (基类/抽象)      │  │                 │                  │
│  └────────┬─────────┘  └─────────────────┘                  │
│           │                                                  │
│  ┌────────▼─────────┐  ┌────────┐  ┌────────┐               │
│  │ DockerSandbox    │  │WslSand│  │Firejail│               │
│  │                 │  │box    │  │Sandbox │               │
│  └─────────────────┘  └────────┘  └────────┘               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 目录结构

```
src/
├── main/
│   └── services/
│       └── sandbox/
│           ├── SandboxManager.ts      # 抽象基类
│           ├── DockerSandbox.ts       # Docker 实现
│           ├── WslSandbox.ts         # WSL 实现
│           ├── FirejailSandbox.ts     # Firejail 实现
│           ├── WorkspaceManager.ts    # 工作区管理
│           ├── PermissionManager.ts  # 权限管理
│           ├── PermissionPolicy.ts   # 权限策略
│           ├── WorkspaceStore.ts     # 工作区持久化
│           └── index.ts              # 导出
│
├── renderer/
│   ├── components/
│   │   └── sandbox/
│   │       ├── WorkspaceList.tsx     # 工作区列表
│   │       ├── WorkspaceCard.tsx     # 工作区卡片
│   │       ├── SandboxSettings.tsx   # 沙箱设置
│   │       └── PermissionDialog.tsx  # 权限审批弹窗
│   │
│   └── services/
│       └── sandbox/
│           └── sandboxService.ts    # 渲染进程沙箱服务
│
├── shared/
│   ├── types/
│   │   └── sandbox.ts               # 共享类型定义
│   ├── events/
│   │   └── sandbox.ts               # 沙箱事件定义
│   └── errors/
│       └── sandbox.ts               # 沙箱错误类
│
└── main/
    └── ipc/
        └── sandbox.ts               # IPC 通道定义
```

---

## 3. 开发阶段

### 阶段一：基础设施（预计 1-2 天）

#### 3.1.1 创建类型定义

```typescript
// src/shared/types/sandbox.ts
// - Platform, SandboxType, PermissionLevel
// - Workspace, SandboxConfig, ExecuteOptions, ExecuteResult
// - RetentionPolicy, Permission, PermissionType
```

#### 3.1.2 创建错误类

```typescript
// src/shared/errors/sandbox.ts
// - SandboxError
// - SandboxErrorCode enum
```

#### 3.1.3 创建事件定义

```typescript
// src/shared/events/sandbox.ts
// - SANDBOX_EVENTS
```

#### 3.1.4 创建 SandboxManager 基类

```typescript
// src/main/services/sandbox/SandboxManager.ts
// - 抽象方法: init, isAvailable, createWorkspace, destroyWorkspace, execute, readFile, writeFile
// - 具体方法: getWorkspace, listWorkspaces
```

---

### 阶段二：Docker 沙箱实现（预计 2-3 天）

#### 3.2.1 DockerSandbox 类

```typescript
// src/main/services/sandbox/DockerSandbox.ts
// - constructor: 检查 Docker 是否安装
// - init(): docker info 验证
// - isAvailable(): docker version 检查
// - createWorkspace(): docker run --rm -v 创建工作区
// - destroyWorkspace(): docker stop + rm
// - execute(): docker exec
// - readFile/writeFile: docker cp
```

#### 3.2.2 Docker 镜像选择

```dockerfile
# 建议使用官方 Node.js 镜像作为基础
FROM node:20-slim

# 安装常用工具
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 设置默认工作目录
WORKDIR /workspace
```

#### 3.2.3 Docker 安全配置

```typescript
// 资源限制
const dockerRunArgs = [
  '--memory', config.memoryLimit || '2g',
  '--cpus', config.cpuLimit || '2',
  '--pids-limit', '100',
  '--network', config.networkEnabled ? 'bridge' : 'none',
  '--read-only', 'false', // 需要写入
  '--security-opt', 'no-new-privileges:true',
  '--cap-drop', 'ALL'
];
```

---

### 阶段三：WorkspaceManager（预计 2 天）

#### 3.3.1 工作区创建流程

```typescript
async create(sessionId: string): Promise<Workspace> {
  // 1. 验证沙箱可用
  if (!await this.sandboxManager.isAvailable()) {
    throw new SandboxError('Sandbox not available', SandboxErrorCode.SANDBOX_UNAVAILABLE);
  }
  
  // 2. 创建工作区目录
  await this.sandboxManager.createWorkspace(sessionId);
  
  // 3. 初始化工作区配置
  await this.writeSandboxConfig(sessionId);
  
  // 4. 初始化 Git 配置（可选）
  await this.initGitConfig(sessionId);
  
  // 5. 持久化工作区信息
  await this.workspaceStore.save(workspace);
  
  // 6. 发布事件
  this.emit('workspace:created', { workspace });
  
  return workspace;
}
```

#### 3.3.2 WorkspaceStore

```typescript
// src/main/services/sandbox/WorkspaceStore.ts
// - 使用 SQLite 或 JSON 文件持久化
// - 方法: save, load, delete, list
```

---

### 阶段四：PermissionManager（预计 2 天）

#### 3.4.1 权限策略

```typescript
// src/main/services/sandbox/PermissionPolicy.ts
const DEFAULT_POLICY: PermissionPolicy = {
  autoApprove: ['file:read'],
  requireConfirm: [
    'file:write',
    'command:execute',
    'network:access',
    'package:install:npm',
    'package:install:python'
  ],
  denyList: [
    'package:install:system',
    'command:execute:dangerous'
  ],
  workspaceOnly: true,
  safeCommands: ['git', 'npm', 'pnpm', 'node', 'python', 'cargo', 'make']
};
```

#### 3.4.2 权限检查流程

```typescript
async checkPermission(
  sessionId: string,
  type: PermissionType,
  target: string
): Promise<PermissionResult> {
  // 1. 检查是否工作区路径
  const workspace = await this.workspaceStore.load(sessionId);
  const isInWorkspace = target.startsWith(workspace.rootPath);
  
  // 2. 如果 workspaceOnly 但目标不在工作区，直接拒绝
  if (this.policy.workspaceOnly && !isInWorkspace) {
    return { allowed: false, reason: 'Outside workspace' };
  }
  
  // 3. 检查自动批准列表
  if (this.policy.autoApprove.includes(type)) {
    return { allowed: true, reason: 'Auto-approved' };
  }
  
  // 4. 检查拒绝列表
  if (this.policy.denyList.includes(type)) {
    return { allowed: false, reason: 'Denied by policy' };
  }
  
  // 5. 需要用户确认
  if (this.policy.requireConfirm.includes(type)) {
    const request = await this.requestPermission(sessionId, type, target);
    return { 
      allowed: false, 
      reason: 'User confirmation required',
      requestId: request.id 
    };
  }
  
  return { allowed: false, reason: 'Unknown permission type' };
}
```

---

### 阶段五：Windows WSL 沙箱（预计 2 天）

#### 3.5.1 WSL 检测与初始化

```typescript
async isAvailable(): Promise<boolean> {
  try {
    const result = await execAsync('wsl --status');
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
```

#### 3.5.2 WSL 工作区管理

```typescript
// WSL 路径映射
private toWslPath(windowsPath: string): string {
  // C:\Users\xxx -> /mnt/c/Users/xxx
  return windowsPath
    .replace(/\\/g, '/')
    .replace(/^([A-Z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`);
}

// WSL 命令执行
async execute(
  sessionId: string,
  command: string,
  args: string[],
  options?: ExecuteOptions
): Promise<ExecuteResult> {
  const workspace = this.getWorkspace(sessionId);
  const wslCommand = `wsl -d ${this.distribution} -- ${command} ${args.join(' ')}`;
  
  return this.execAsync(wslCommand, {
    cwd: this.toWslPath(workspace.rootPath),
    timeout: options?.timeout,
    env: this.getEnv(workspace)
  });
}
```

---

### 阶段六：Linux Firejail 沙箱（预计 1-2 天）

#### 3.6.1 Firejail 检测

```typescript
async isAvailable(): Promise<boolean> {
  try {
    const result = await execAsync('firejail --version');
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
```

#### 3.6.2 Firejail 命令执行

```typescript
async execute(
  sessionId: string,
  command: string,
  args: string[],
  options?: ExecuteOptions
): Promise<ExecuteResult> {
  const workspace = this.getWorkspace(sessionId);
  const firejailArgs = [
    '--profile=' + this.getProfilePath(sessionId),
    '--whitelist=' + workspace.rootPath,
    command,
    ...args
  ];
  
  return this.execAsync('firejail', firejailArgs, {
    cwd: workspace.rootPath,
    timeout: options?.timeout
  });
}
```

---

### 阶段七：UI 开发（预计 3-4 天）

#### 3.7.1 工作区列表页面

```tsx
// src/renderer/components/sandbox/WorkspaceList.tsx
function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  
  useEffect(() => {
    const unsubscribe = window.api.on('workspace:created', (data) => {
      setWorkspaces(prev => [...prev, data.workspace]);
    });
    return unsubscribe;
  }, []);
  
  return (
    <div className="workspace-list">
      {workspaces.map(ws => (
        <WorkspaceCard key={ws.id} workspace={ws} />
      ))}
    </div>
  );
}
```

#### 3.7.2 权限审批弹窗

```tsx
// src/renderer/components/sandbox/PermissionDialog.tsx
function PermissionDialog({ request, onApprove, onDeny }) {
  return (
    <Dialog open={true}>
      <DialogTitle>权限请求</DialogTitle>
      <DialogContent>
        <p>应用请求执行以下操作：</p>
        <code>{request.type}: {request.target}</code>
        {request.reason && <p>原因: {request.reason}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onDeny}>拒绝</Button>
        <Button onClick={onApprove} variant="contained">批准</Button>
      </DialogActions>
    </Dialog>
  );
}
```

---

### 阶段八：测试与文档（预计 2 天）

#### 3.8.1 单元测试

```typescript
// src/test/services/sandbox/DockerSandbox.test.ts
describe('DockerSandbox', () => {
  it('should detect Docker availability', async () => {
    const sandbox = new DockerSandbox(defaultConfig);
    const available = await sandbox.isAvailable();
    expect(typeof available).toBe('boolean');
  });
  
  it('should create and destroy workspace', async () => {
    const sandbox = new DockerSandbox(defaultConfig);
    const workspace = await sandbox.createWorkspace('test-session');
    expect(workspace.id).toBe('test-session');
    await sandbox.destroyWorkspace('test-session');
  });
});
```

#### 3.8.2 集成测试

```typescript
// src/test/services/sandbox/integration.test.ts
describe('Sandbox Integration', () => {
  it('should execute command in sandbox', async () => {
    const workspace = await workspaceManager.create('test-session');
    const result = await workspaceManager.execute(
      'test-session',
      'echo',
      ['hello']
    );
    expect(result.stdout.trim()).toBe('hello');
  });
});
```

---

## 4. 任务清单

### 基础设施
- [ ] 创建 `src/shared/types/sandbox.ts`
- [ ] 创建 `src/shared/errors/sandbox.ts`
- [ ] 创建 `src/shared/events/sandbox.ts`
- [ ] 创建 `src/main/services/sandbox/SandboxManager.ts` (基类)

### Docker 沙箱
- [ ] 创建 `src/main/services/sandbox/DockerSandbox.ts`
- [ ] 测试 Docker 检测
- [ ] 测试工作区创建/销毁
- [ ] 测试命令执行

### WorkspaceManager
- [ ] 创建 `src/main/services/sandbox/WorkspaceManager.ts`
- [ ] 创建 `src/main/services/sandbox/WorkspaceStore.ts`
- [ ] 实现保留策略
- [ ] 实现清理任务

### 权限管理
- [ ] 创建 `src/main/services/sandbox/PermissionPolicy.ts`
- [ ] 创建 `src/main/services/sandbox/PermissionManager.ts`
- [ ] 与 IPC 集成
- [ ] 实现用户确认流程

### Windows WSL
- [ ] 创建 `src/main/services/sandbox/WslSandbox.ts`
- [ ] 测试 WSL 检测
- [ ] 测试路径转换
- [ ] 测试命令执行

### Linux Firejail
- [ ] 创建 `src/main/services/sandbox/FirejailSandbox.ts`
- [ ] 测试 Firejail 检测
- [ ] 创建 profile 模板
- [ ] 测试命令执行

### UI
- [ ] 创建 `src/renderer/components/sandbox/WorkspaceList.tsx`
- [ ] 创建 `src/renderer/components/sandbox/WorkspaceCard.tsx`
- [ ] 创建 `src/renderer/components/sandbox/SandboxSettings.tsx`
- [ ] 创建 `src/renderer/components/sandbox/PermissionDialog.tsx`

### 测试
- [ ] 单元测试（每个类）
- [ ] 集成测试
- [ ] 跨平台测试（手动）

### 文档
- [ ] 更新 README
- [ ] API 文档
- [ ] 使用指南

---

## 5. 预计工期

| 阶段 | 内容 | 预计时间 |
|------|------|---------|
| 一 | 基础设施 | 1-2 天 |
| 二 | Docker 沙箱 | 2-3 天 |
| 三 | WorkspaceManager | 2 天 |
| 四 | PermissionManager | 2 天 |
| 五 | Windows WSL | 2 天 |
| 六 | Linux Firejail | 1-2 天 |
| 七 | UI 开发 | 3-4 天 |
| 八 | 测试与文档 | 2 天 |
| **总计** | | **15-19 天** |

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Docker 不可用 | macOS/Linux 沙箱失效 | 提供 `--sandbox=none` 回退到本地执行 |
| WSL 配置复杂 | Windows 沙箱延迟 | 提供 Docker 作为 Windows 主方案 |
| 权限确认流程影响体验 | 用户频繁被中断 | 提供"记住选择"和"自动批准"选项 |
| 跨平台路径处理 | Windows 路径问题 | 使用 `path` 模块统一处理 |

---

## 7. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本 |

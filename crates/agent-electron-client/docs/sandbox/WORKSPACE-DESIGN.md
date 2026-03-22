# 沙箱工作空间设计方案

> 多平台支持的 Agent 沙箱工作空间架构设计
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

## 2. 目录结构

### 2.1 整体结构

```
~/.nuwaclaw/
├── core/                       # 应用核心（只读）
│   ├── engines/               # 引擎二进制
│   ├── bin/                   # 核心工具
│   └── config/                # 应用配置
│
├── workspaces/                 # 沙箱工作区根目录
│   ├── .shared/              # 跨会话共享资源
│   │   ├── tools/            # 共享工具（预安装）
│   │   └── cache/            # 共享缓存
│   │
│   ├── {session-id}/         # 会话工作区（隔离）
│   │   ├── projects/         # 项目代码
│   │   ├── node_modules/     # npm 包
│   │   ├── .venv/           # Python 环境
│   │   ├── .bin/            # 可执行文件
│   │   ├── cache/           # 会话缓存
│   │   └── sandbox.json     # 会话沙箱配置
│   │
│   └── {session-id-2}/
│       └── ...
│
├── logs/                      # 日志目录
├── data/                      # 应用数据
└── nuwaclaw.db               # SQLite 数据库
```

### 2.2 Windows 路径差异

| 概念 | macOS/Linux | Windows |
|------|-------------|---------|
| 用户目录 | `~/.nuwaclaw/` | `%USERPROFILE%\.nuwaclaw\` |
| 工作区 | `~/.nuwaclaw/workspaces/` | `%USERPROFILE%\.nuwaclaw\workspaces\` |
| 临时目录 | `/tmp/nuwaclaw-*` | `%TEMP%\nuwaclaw-*` |

---

## 3. 多平台沙箱方案

### 3.1 平台支持矩阵

| 平台 | 主要方案 | 备选方案 | 说明 |
|------|---------|---------|------|
| **macOS** | Docker | App Sandbox + Bubblewrap | Docker 跨平台一致性好 |
| **Windows** | Docker + WSL2 | Hyper-V | WSL2 提供良好 Linux 兼容 |
| **Linux** | Docker | Firejail | Docker 在 Linux 原生支持 |

### 3.2 Docker 沙箱（推荐）

```typescript
interface DockerSandboxConfig {
  image: string;              // 基础镜像
  workspaceDir: string;       // 容器内工作区路径
  memoryLimit: string;        // 内存限制，如 "2g"
  cpuLimit: number;           // CPU 限制，如 2
  networkEnabled: boolean;     // 是否启用网络
  diskQuota: string;          // 磁盘限额，如 "10g"
  readonly: boolean;          // 是否只读（用于安全要求高的场景）
}
```

### 3.3 WSL2 沙箱（Windows 备选）

```typescript
interface WslSandboxConfig {
  distribution: string;        // WSL 发行版，如 "Ubuntu-22.04"
  workspaceDir: string;       // WSL 内工作区路径
  memoryLimit: string;        // 内存限制
  networkEnabled: boolean;    // 网络配置
}
```

### 3.4 Firejail 沙箱（Linux 备选）

```typescript
interface FirejailSandboxConfig {
  profile: string;           // firejail profile 名称
  workspaceDir: string;       // 工作区路径
  whitelist: string[];       # 白名单路径
  blacklist: string[];       # 黑名单路径
  netdev?: string;           # 网络设备
}
```

---

## 4. 沙箱管理器

### 4.1 核心接口

```typescript
interface SandboxManager {
  // 初始化
  init(config: SandboxConfig): Promise<void>;
  
  // 创建会话工作区
  createWorkspace(sessionId: string): Promise<Workspace>;
  
  // 销毁会话工作区
  destroyWorkspace(sessionId: string): Promise<void>;
  
  // 执行命令（在沙箱内）
  execute(
    sessionId: string, 
    command: string, 
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
  
  // 文件操作（在沙箱内）
  readFile(sessionId: string, path: string): Promise<string>;
  writeFile(sessionId: string, path: string, content: string): Promise<void>;
  
  // 获取工作区信息
  getWorkspaceInfo(sessionId: string): WorkspaceInfo;
  
  // 清理所有工作区
  cleanupAll(): Promise<void>;
}
```

### 4.2 工作区接口

```typescript
interface Workspace {
  id: string;                 // 会话 ID
  rootPath: string;           // 工作区根目录
  projectsPath: string;        // 项目目录
  nodeModulesPath: string;     // npm 包目录
  pythonEnvPath: string;       // Python 环境目录
  binPath: string;             // 可执行文件目录
  createdAt: Date;             // 创建时间
  lastAccessedAt: Date;        // 最后访问时间
  platform: 'darwin' | 'win32' | 'linux';
  sandboxType: 'docker' | 'wsl' | 'firejail' | 'none';
}
```

### 4.3 执行选项

```typescript
interface ExecuteOptions {
  cwd?: string;               // 工作目录
  env?: Record<string, string>; // 环境变量
  timeout?: number;            // 超时（毫秒）
  maxMemory?: string;          // 内存限制
  stdio?: 'pipe' | 'inherit'; // 标准输入输出
}
```

---

## 5. 权限管理

### 5.1 权限级别

| 级别 | 名称 | 说明 |
|------|------|------|
| 0 | **只读** | 只能读取工作区内文件 |
| 1 | **受限写入** | 可以在工作区内创建/修改文件 |
| 2 | **标准执行** | 可以执行编译、测试等命令 |
| 3 | **完全访问** | 可以安装包、创建目录等 |

### 5.2 权限检查

```typescript
interface Permission {
  type: 'file:read' | 'file:write' | 'command:execute' | 'network:access' | 'package:install';
  target: string;              // 操作目标
  sessionId: string;           // 会话 ID
  approvedBy: 'system' | 'user' | 'policy';
  timestamp: Date;
}

// 自动放行：工作区内只读操作
// 需要确认：工作区内写入、网络访问、包安装
// 禁止：工作区外任何操作
```

### 5.3 权限策略

```typescript
const PERMISSION_POLICY = {
  // 文件操作
  'file:read': {
    workspace: true,           // 工作区内自动放行
    outside: false             // 工作区外禁止
  },
  
  // 写入操作
  'file:write': {
    workspace: 'confirm',       // 工作区内需确认
    outside: false             // 工作区外禁止
  },
  
  // 命令执行
  'command:execute': {
    safe: ['git', 'npm', 'pnpm', 'node', 'python', 'cargo', 'make'], // 白名单
    workspace: 'confirm',       // 其他命令需确认
    outside: false
  },
  
  // 网络访问
  'network:access': {
    api: true,                 // 已配置的 API 允许
    download: 'confirm',        // 下载需确认
    arbitrary: false           // 任意网络禁止
  },
  
  // 包安装
  'package:install': {
    npm: 'confirm',            // npm 安装需确认
    python: 'confirm',         // Python 包安装需确认
    system: false              // 系统包禁止
  }
};
```

---

## 6. 多平台路径处理

### 6.1 路径抽象层

```typescript
// src/shared/utils/path.ts
export function getWorkspaceRoot(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE || '', '.nuwaclaw');
  }
  return path.join(os.homedir(), '.nuwaclaw');
}

export function getWorkspacePath(sessionId: string): string {
  return path.join(getWorkspaceRoot(), 'workspaces', sessionId);
}

export function getSandboxConfigPath(sessionId: string): string {
  return path.join(getWorkspacePath(sessionId), 'sandbox.json');
}

// 跨平台路径转换（用于 Docker 容器内路径）
export function toSandboxPath(localPath: string): string {
  // Docker 中 Linux 路径
  return localPath.replace(/\\/g, '/').replace(/^[A-Z]:/, '');
}
```

### 6.2 环境变量注入

```typescript
function getSandboxEnv(sessionId: string, workspace: Workspace): NodeJS.ProcessEnv {
  return {
    // 核心路径
    HOME: workspace.rootPath,
    PATH: [
      workspace.binPath,
      workspace.rootPath + '/core/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ].join(platform === 'win32' ? ';' : ':'),
    
    // Python 环境
    PYTHONPATH: workspace.pythonEnvPath,
    VIRTUAL_ENV: workspace.pythonEnvPath,
    UV_TOOL_DIR: workspace.binPath,
    
    // Node 环境
    NODE_PATH: workspace.nodeModulesPath,
    npm_config_prefix: workspace.rootPath,
    
    // 临时目录
    TMPDIR: workspace.rootPath + '/tmp',
    TEMP: workspace.rootPath + '/tmp',
    
    // 安全限制
    // 注意：实际限制由沙箱机制（Docker/WSL/Firejail）强制执行
  };
}
```

---

## 7. 会话生命周期

### 7.1 创建会话工作区

```
用户启动会话
    ↓
SandboxManager.createWorkspace(sessionId)
    ↓
检查 Docker/WSL/Firejail 可用性
    ↓
创建工作区目录结构
    ↓
写入 sandbox.json 配置
    ↓
初始化 Git 配置（用户信息）
    ↓
返回 Workspace 实例
```

### 7.2 销毁会话工作区

```
用户关闭会话 / 会话超时
    ↓
SandboxManager.destroyWorkspace(sessionId)
    ↓
通知沙箱停止所有进程
    ↓
清理临时文件
    ↓
删除工作区目录（或按配置保留）
    ↓
更新会话状态
```

### 7.3 保留策略

```typescript
interface RetentionPolicy {
  mode: 'always' | 'timeout' | 'manual';
  maxAge?: number;              // 最大保留天数
  maxSize?: string;             // 最大总大小
  maxWorkspaces?: number;       // 最大工作区数量
  preserveOnError?: boolean;    // 错误时保留
}

// 默认策略：保留 7 天，最多 10 个工作区，总大小 50GB
const DEFAULT_RETENTION: RetentionPolicy = {
  mode: 'timeout',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  maxWorkspaces: 10,
  maxSize: '50g',
  preserveOnError: true
};
```

---

## 8. 安全考虑

### 8.1 沙箱边界

```typescript
const SANDBOX_BOUNDARIES = {
  // 文件系统
  fileSystem: {
    allowed: ['${workspace}/**'],              // 仅工作区
    readonly: ['${core}/**'],                  // 核心只读
    denied: ['/system/**', '/proc/**', '~/.ssh/**']  // 禁止
  },
  
  // 网络
  network: {
    outbound: 'whitelist',                    // 白名单出站
    inbound: false,                            // 禁止入站
    dns: true                                  // 允许 DNS
  },
  
  // 进程
  process: {
    maxProcesses: 100,                         // 最大进程数
    maxMemory: '2g',                           // 最大内存
    maxCpu: 2,                                 // 最大 CPU 核数
    maxFileSize: '100m'                        // 最大文件大小
  },
  
  // 执行
  execution: {
    allowedCommands: ['git', 'npm', 'pnpm', 'node', 'python', 'cargo', 'make', 'cmake'],
    dangerousCommands: ['rm', 'dd', 'mkfs', 'fdisk'],  // 禁止
    shellExecution: false                      // 禁止 shell 执行
  }
};
```

### 8.2 Docker 安全配置

```yaml
# 容器安全配置
security_opt:
  - no-new-privileges:true
  - seccomp:default
  
cap_drop:
  - ALL
  
read_only: false  # 工作区需要写入

# 网络（按需启用）
network_mode: "bridge"  # 或 "none" 完全禁用

# 资源限制
resources:
  memory: "2g"
  cpus: 2
  pids: 100
```

---

## 9. 实现计划

### 阶段一：基础框架（1-2 天）

- [ ] 创建 `SandboxManager` 基类
- [ ] 实现 `DockerSandbox` 子类
- [ ] 创建目录结构生成逻辑
- [ ] 基础路径抽象层

### 阶段二：工作区管理（2-3 天）

- [ ] 会话工作区创建/销毁
- [ ] 保留策略实现
- [ ] 工作区信息持久化
- [ ] 清理任务调度

### 阶段三：权限集成（2 天）

- [ ] 权限检查接口
- [ ] 与现有 permissionManager 集成
- [ ] 用户确认流程
- [ ] 审计日志

### 阶段四：平台适配（2-3 天）

- [ ] WSL2 沙箱实现（Windows）
- [ ] Firejail 沙箱实现（Linux）
- [ ] 路径抽象完善
- [ ] 跨平台测试

### 阶段五：测试与文档（2 天）

- [ ] 单元测试
- [ ] 集成测试
- [ ] 用户文档
- [ ] 开发者文档

---

## 10. 相关文档

| 文档 | 说明 |
|------|------|
| [ISOLATION.md](../architecture/ISOLATION.md) | 三区隔离模型 |
| [ARCHITECTURE.md](../v2/01-ARCHITECTURE.md) | 应用架构 |
| [PERMISSIONS.md](./PERMISSIONS.md) | 权限系统设计（待创建） |
| [SANDBOX-API.md](./SANDBOX-API.md) | API 接口文档（待创建） |

---

## 11. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本 |

# 沙箱 API 接口文档

> **版本**: 1.0.0  
> **更新**: 2026-03-22  
> **状态**: 待实现

---

## 1. 概览

本文档定义 Nuwax Agent 沙箱的 TypeScript/JavaScript API 接口。

---

## 2. 类型定义

### 2.1 核心类型

```typescript
// src/shared/types/sandbox.ts

export type Platform = 'darwin' | 'win32' | 'linux';
export type SandboxType = 'docker' | 'wsl' | 'firejail' | 'none';
export type PermissionLevel = 0 | 1 | 2 | 3;

export interface SandboxConfig {
  type: SandboxType;
  platform: Platform;
  enabled: boolean;
  workspaceRoot: string;
  memoryLimit?: string;        // 如 "2g"
  cpuLimit?: number;           // 如 2
  diskQuota?: string;          // 如 "10g"
  networkEnabled?: boolean;
  mode?: SandboxMode;          // "strict" | "compat" | "permissive"
}

export interface Workspace {
  id: string;
  rootPath: string;
  projectsPath: string;
  nodeModulesPath: string;
  pythonEnvPath: string;
  binPath: string;
  cachePath: string;
  sandboxConfig: SandboxConfig;
  createdAt: Date;
  lastAccessedAt: Date;
  retentionPolicy: RetentionPolicy;
}

export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxMemory?: string;
  stdio?: 'pipe' | 'inherit';
  permissionLevel?: PermissionLevel;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  duration: number;
}

export interface RetentionPolicy {
  mode: 'always' | 'timeout' | 'manual';
  maxAge?: number;
  maxWorkspaces?: number;
  maxSize?: string;
  preserveOnError?: boolean;
}

export interface Permission {
  type: PermissionType;
  target: string;
  sessionId: string;
  approvedBy: 'system' | 'user' | 'policy' | 'denied';
  timestamp: Date;
  reason?: string;
}

export type PermissionType = 
  | 'file:read' 
  | 'file:write' 
  | 'file:delete'
  | 'command:execute'
  | 'network:access'
  | 'network:download'
  | 'package:install:npm'
  | 'package:install:python'
  | 'package:install:system';
```

---

## 3. SandboxManager 接口

### 3.1 类签名

```typescript
// src/main/services/sandbox/SandboxManager.ts

export abstract class SandboxManager {
  protected config: SandboxConfig;
  protected workspaces: Map<string, Workspace>;

  constructor(config: SandboxConfig);

  // 初始化
  abstract init(): Promise<void>;
  
  // 检查沙箱是否可用
  abstract isAvailable(): Promise<boolean>;
  
  // 创建工作区
  abstract createWorkspace(sessionId: string): Promise<Workspace>;
  
  // 销毁工作区
  abstract destroyWorkspace(sessionId: string): Promise<void>;
  
  // 执行命令
  abstract execute(
    sessionId: string,
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
  
  // 文件操作
  abstract readFile(sessionId: string, path: string): Promise<string>;
  abstract writeFile(sessionId: string, path: string, content: string): Promise<void>;
  abstract readDir(sessionId: string, path: string): Promise<FileInfo[]>;
  
  // 工作区信息
  abstract getWorkspace(sessionId: string): Workspace | undefined;
  abstract listWorkspaces(): Workspace[];
  
  // 清理
  abstract cleanup(): Promise<void>;
}
```

### 3.2 Docker 实现

```typescript
// src/main/services/sandbox/DockerSandbox.ts

export class DockerSandbox extends SandboxManager {
  private containerIds: Map<string, string>;
  
  constructor(config: SandboxConfig & {
    dockerImage: string;
    dockerHost?: string;
  });
  
  async init(): Promise<void>;
  async isAvailable(): Promise<boolean>;
  async createWorkspace(sessionId: string): Promise<Workspace>;
  async destroyWorkspace(sessionId: string): Promise<void>;
  async execute(
    sessionId: string,
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
  async readFile(sessionId: string, path: string): Promise<string>;
  async writeFile(sessionId: string, path: string, content: string): Promise<void>;
  
  // Docker 特有
  async listContainers(): Promise<ContainerInfo[]>;
  async getContainerLogs(sessionId: string): Promise<string>;
}
```

### 3.3 WSL 实现（Windows）

```typescript
// src/main/services/sandbox/WslSandbox.ts

export class WslSandbox extends SandboxManager {
  private distribution: string;
  private instanceId: string;
  
  constructor(config: SandboxConfig & {
    distribution: string;
  });
  
  async init(): Promise<void>;
  async isAvailable(): Promise<boolean>;
  async createWorkspace(sessionId: string): Promise<Workspace>;
  async destroyWorkspace(sessionId: string): Promise<void>;
  async execute(
    sessionId: string,
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
}
```

### 3.4 Firejail 实现（Linux）

```typescript
// src/main/services/sandbox/FirejailSandbox.ts

export class FirejailSandbox extends SandboxManager {
  private profiles: Map<string, string>;
  
  constructor(config: SandboxConfig & {
    profileDir?: string;
  });
  
  async init(): Promise<void>;
  async isAvailable(): Promise<boolean>;
  async createWorkspace(sessionId: string): Promise<Workspace>;
  async destroyWorkspace(sessionId: string): Promise<void>;
  async execute(
    sessionId: string,
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
}
```

---

## 4. PermissionManager 接口

### 4.1 类签名

```typescript
// src/main/services/sandbox/PermissionManager.ts

export class PermissionManager {
  private policy: PermissionPolicy;
  private pendingRequests: Map<string, PermissionRequest>;
  private approvedCache: Map<string, Permission>;
  
  constructor(policy: PermissionPolicy);
  
  // 检查权限
  async checkPermission(
    sessionId: string,
    permission: PermissionType,
    target: string
  ): Promise<PermissionResult>;
  
  // 请求权限
  async requestPermission(
    sessionId: string,
    permission: PermissionType,
    target: string,
    reason?: string
  ): Promise<Permission>;
  
  // 批准权限
  async approve(
    requestId: string,
    approvedBy: 'user' | 'system',
    reason?: string
  ): Promise<void>;
  
  // 拒绝权限
  async deny(requestId: string, reason?: string): Promise<void>;
  
  // 批量批准
  async approveBatch(requestIds: string[]): Promise<void>;
  
  // 获取待审批列表
  getPendingRequests(sessionId?: string): PermissionRequest[];
  
  // 清除缓存
  clearCache(): void;
}

export interface PermissionPolicy {
  autoApprove: PermissionType[];           // 自动批准的类型
  requireConfirm: PermissionType[];        // 需要确认的类型
  denyList: PermissionType[];             // 禁止的类型
  workspaceOnly: boolean;                  // 是否只允许工作区操作
  safeCommands: string[];                 // 安全命令白名单
}

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  requestId?: string;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  type: PermissionType;
  target: string;
  reason?: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'denied';
}
```

---

## 5. WorkspaceManager 接口

### 5.1 类签名

```typescript
// src/main/services/sandbox/WorkspaceManager.ts

export class WorkspaceManager {
  private sandboxManager: SandboxManager;
  private permissionManager: PermissionManager;
  private workspaceStore: WorkspaceStore;
  
  constructor(
    sandboxManager: SandboxManager,
    permissionManager: PermissionManager
  );
  
  // 工作区生命周期
  async create(sessionId: string, options?: CreateWorkspaceOptions): Promise<Workspace>;
  async destroy(sessionId: string, force?: boolean): Promise<void>;
  async get(sessionId: string): Promise<Workspace | undefined>;
  async list(): Promise<Workspace[]>;
  
  // 工作区操作（带权限检查）
  async readFile(sessionId: string, path: string): Promise<string>;
  async writeFile(sessionId: string, path: string, content: string): Promise<void>;
  async execute(
    sessionId: string,
    command: string,
    args: string[],
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
  
  // 清理
  async cleanupExpired(): Promise<CleanupResult>;
  async cleanupAll(): Promise<void>;
  
  // 保留策略
  async setRetentionPolicy(sessionId: string, policy: RetentionPolicy): Promise<void>;
  async getRetentionPolicy(sessionId: string): Promise<RetentionPolicy>;
}

export interface CreateWorkspaceOptions {
  retention?: Partial<RetentionPolicy>;
  platform?: Platform;
  sandboxType?: SandboxType;
}

export interface CleanupResult {
  deletedCount: number;
  freedSpace: number;
  errors: string[];
}
```

---

## 6. IPC 接口

### 6.1 IPC 通道定义

```typescript
// src/main/ipc/channels.ts

export const SANDBOX_CHANNELS = {
  // 工作区管理
  'sandbox:create': {
    request: { sessionId: string },
    response: Workspace
  },
  
  'sandbox:destroy': {
    request: { sessionId: string, force?: boolean },
    response: { success: boolean }
  },
  
  'sandbox:list': {
    request: void,
    response: Workspace[]
  },
  
  'sandbox:info': {
    request: { sessionId: string },
    response: Workspace | null
  },
  
  // 文件操作
  'sandbox:readFile': {
    request: { sessionId: string, path: string },
    response: { content: string }
  },
  
  'sandbox:writeFile': {
    request: { sessionId: string, path: string, content: string },
    response: { success: boolean }
  },
  
  // 执行
  'sandbox:execute': {
    request: {
      sessionId: string,
      command: string,
      args: string[],
      options?: ExecuteOptions
    },
    response: ExecuteResult
  },
  
  // 权限
  'sandbox:checkPermission': {
    request: { sessionId: string, type: PermissionType, target: string },
    response: PermissionResult
  },
  
  'sandbox:requestPermission': {
    request: { sessionId: string, type: PermissionType, target: string, reason?: string },
    response: Permission
  },
  
  'sandbox:getPendingPermissions': {
    request: { sessionId?: string },
    response: PermissionRequest[]
  },
  
  'sandbox:approvePermission': {
    request: { requestId: string },
    response: { success: boolean }
  },
  
  'sandbox:denyPermission': {
    request: { requestId: string },
    response: { success: boolean }
  },
  
  // 清理
  'sandbox:cleanup': {
    request: void,
    response: CleanupResult
  },
  
  // 状态
  'sandbox:status': {
    request: void,
    response: SandboxStatus
  },

  // 策略
  'sandbox:policy:get': {
    request: void,
    response: SandboxPolicy
  },

  'sandbox:policy:set': {
    request: Partial<SandboxPolicy>,
    response: SandboxPolicy
  },

  'sandbox:capabilities': {
    request: void,
    response: SandboxCapabilities
  },

  // 后端初始化（Windows Codex setup）
  'sandbox:setup': {
    request: {
      windows?: { codex?: { mode?: 'unelevated' | 'elevated' } }
    },
    response: { success: boolean; message?: string }
  }
} as const;

export interface SandboxStatus {
  available: boolean;
  type: SandboxType;
  backend?: SandboxBackend;
  platform: Platform;
  activeWorkspaces: number;
  degraded?: boolean;
  reason?: string;
  capabilities?: SandboxCapabilities;
  totalMemory?: string;
  diskUsage?: string;
}

export interface SandboxPolicy {
  enabled: boolean;
  mode: SandboxMode;           // "strict" | "compat" | "permissive"
  backend: SandboxBackend;     // "auto" | "docker" | "macos-seatbelt" | "linux-bwrap" | "windows-sandbox"
  autoFallback: SandboxAutoFallback; // "startup-only" | "session" | "manual"
  windowsMode: WindowsSandboxMode;  // "read-only" | "workspace-write"
}
```

---

## 7. 事件

### 7.1 事件类型

```typescript
// src/shared/events/sandbox.ts

export const SANDBOX_EVENTS = {
  // 工作区事件
  'workspace:created': { workspace: Workspace };
  'workspace:destroyed': { workspaceId: string };
  'workspace:accessed': { workspaceId: string; timestamp: Date };
  
  // 权限事件
  'permission:requested': { request: PermissionRequest };
  'permission:approved': { permission: Permission };
  'permission:denied': { requestId: string; reason?: string };
  
  // 执行事件
  'execute:start': { sessionId: string; command: string };
  'execute:complete': { sessionId: string; result: ExecuteResult };
  'execute:error': { sessionId: string; error: string };
  
  // 清理事件
  'cleanup:start': void;
  'cleanup:complete': { result: CleanupResult };
  
  // 沙箱事件
  'sandbox:unavailable': { reason: string };
  'sandbox:recovered': void;
} as const;
```

---

## 8. 错误类型

### 8.1 错误类

```typescript
// src/shared/errors/sandbox.ts

export class SandboxError extends Error {
  constructor(
    message: string,
    public code: SandboxErrorCode,
    public sessionId?: string
  );
}

export enum SandboxErrorCode {
  SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE',
  WORKSPACE_NOT_FOUND = 'WORKSPACE_NOT_FOUND',
  WORKSPACE_EXISTS = 'WORKSPACE_EXISTS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  EXECUTION_TIMEOUT = 'EXECUTION_TIMEOUT',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_WRITE_FAILED = 'FILE_WRITE_FAILED',
  CLEANUP_FAILED = 'CLEANUP_FAILED',
  CONFIG_INVALID = 'CONFIG_INVALID'
}
```

---

## 9. 使用示例

### 9.1 创建工作区

```typescript
import { WorkspaceManager } from './services/sandbox/WorkspaceManager';

const workspaceManager = new WorkspaceManager(
  new DockerSandbox({ type: 'docker', platform: 'darwin', enabled: true }),
  new PermissionManager({ /* policy */ })
);

// 创建工作区
const workspace = await workspaceManager.create('session-123', {
  retention: { mode: 'timeout', maxAge: 7 * 24 * 60 * 60 * 1000 }
});

console.log(`Workspace created at: ${workspace.rootPath}`);
```

### 9.2 执行命令

```typescript
// 检查权限
const result = await workspaceManager.execute(
  'session-123',
  'npm',
  ['install', 'lodash'],
  { cwd: workspace.projectsPath }
);

console.log(`Exit code: ${result.exitCode}`);
console.log(`Output: ${result.stdout}`);
```

### 9.3 权限请求

```typescript
// 请求安装包权限
const permission = await workspaceManager.permissionManager.requestPermission(
  'session-123',
  'package:install:npm',
  'lodash',
  'Need lodash for utility functions'
);

// 等待用户批准
if (permission.approvedBy === 'user') {
  // 执行安装
}
```

---

## 10. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本 |

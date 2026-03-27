# 任务：执行沙箱命令

> **版本**: 1.0.0
> **创建时间**: 2026-03-27
> **类型**: sandbox

---

## 1. 任务描述

在沙箱中安全执行命令，提供隔离的执行环境。

---

## 2. 输入参数

```typescript
interface SandboxExecuteInput {
  // 沙箱实例
  sandbox: SandboxInterface;
  
  // 要执行的命令
  command: string;
  
  // 工作目录
  cwd: string;
  
  // 执行选项
  options?: {
    // 超时时间（秒）
    timeout?: number;
    
    // 取消信号
    signal?: AbortSignal;
    
    // 输出回调
    onOutput?: (data: string) => void;
    
    // 环境变量
    env?: Record<string, string>;
  };
}
```

---

## 3. 输出结果

```typescript
interface SandboxExecuteOutput {
  // 退出码
  exitCode: number;
  
  // 标准输出
  stdout: string;
  
  // 标准错误
  stderr: string;
  
  // 执行时间（毫秒）
  duration: number;
  
  // 资源使用
  resources?: {
    memory: number;
    cpu: number;
  };
}
```

---

## 4. 前置条件

- [ ] `sandbox-init` gate passed
- [ ] 沙箱实例有效
- [ ] 命令已通过安全检查

---

## 5. 安全策略

### 5.1 命令检查

```typescript
const BLOCKED_COMMANDS = [
  "rm -rf /",
  "dd if=/dev/zero",
  "mkfs",
  "fdisk",
  ":(){ :|:& };:",  // Fork bomb
];

function checkCommand(command: string): boolean {
  for (const blocked of BLOCKED_COMMANDS) {
    if (command.includes(blocked)) {
      return false;
    }
  }
  return true;
}
```

### 5.2 网络访问检查

```typescript
function checkNetworkAccess(command: string, config: SandboxConfig): boolean {
  if (!config.network?.enabled) {
    // 检查命令是否需要网络
    const networkCommands = ["curl", "wget", "npm install", "pip install"];
    for (const netCmd of networkCommands) {
      if (command.includes(netCmd)) {
        return false;
      }
    }
  }
  return true;
}
```

### 5.3 文件系统检查

```typescript
function checkFilesystemAccess(command: string, cwd: string, config: SandboxConfig): boolean {
  // 检查是否访问禁止的路径
  const denyRead = config.filesystem?.denyRead || [];
  const denyWrite = config.filesystem?.denyWrite || [];
  
  for (const denyPath of [...denyRead, ...denyWrite]) {
    if (command.includes(denyPath)) {
      return false;
    }
  }
  
  return true;
}
```

---

## 6. 实现步骤

### Step 1: 安全检查

```typescript
// 检查命令安全性
if (!checkCommand(command)) {
  throw new Error("Blocked command detected");
}

// 检查网络访问
if (!checkNetworkAccess(command, config)) {
  throw new Error("Network access denied");
}

// 检查文件系统访问
if (!checkFilesystemAccess(command, cwd, config)) {
  throw new Error("Filesystem access denied");
}
```

### Step 2: 准备执行环境

```typescript
// 设置超时
const timeout = options?.timeout || config.resources?.timeout || 300;

// 设置环境变量
const env = {
  ...process.env,
  ...options?.env,
  // 覆盖敏感环境变量
  HOME: cwd,
};
```

### Step 3: 执行命令

```typescript
const startTime = Date.now();

const result = await sandbox.execute(command, cwd, {
  timeout,
  signal: options?.signal,
  env,
  onOutput: options?.onOutput,
});

const duration = Date.now() - startTime;
```

### Step 4: 收集输出

```typescript
return {
  exitCode: result.exitCode,
  stdout: result.stdout,
  stderr: result.stderr,
  duration,
  resources: result.resources,
};
```

### Step 5: 审计日志

```typescript
await auditLogger.log({
  type: "sandbox_execute",
  command,
  cwd,
  exitCode: result.exitCode,
  duration,
  timestamp: new Date(),
});
```

---

## 7. 示例

### 基本执行

```typescript
const result = await executeInSandbox(
  sandbox,
  "ls -la",
  "/Users/user/project"
);

console.log(result.exitCode);  // 0
console.log(result.stdout);    // "total 100\ndrwxr-xr-x..."
console.log(result.duration);  // 45 (ms)
```

### 带超时

```typescript
try {
  const result = await executeInSandbox(
    sandbox,
    "npm install",
    "/Users/user/project",
    { timeout: 300 }  // 5 分钟
  );
} catch (error) {
  if (error.code === "TIMEOUT") {
    console.error("Command timed out");
  }
}
```

### 实时输出

```typescript
const result = await executeInSandbox(
  sandbox,
  "npm run build",
  "/Users/user/project",
  {
    onOutput: (data) => {
      console.log(data);  // 实时打印构建输出
    },
  }
);
```

### 取消执行

```typescript
const controller = new AbortController();

// 5 秒后取消
setTimeout(() => controller.abort(), 5000);

const result = await executeInSandbox(
  sandbox,
  "long-running-command",
  "/Users/user/project",
  { signal: controller.signal }
);
```

---

## 8. 验证清单

- [ ] 命令在隔离环境执行
- [ ] 网络访问符合配置
- [ ] 文件访问符合配置
- [ ] 资源使用在限制内
- [ ] 审计日志已记录
- [ ] 临时文件已清理

---

## 9. 错误处理

| 错误代码 | 说明 | 处理方式 |
|---------|------|---------|
| `COMMAND_BLOCKED` | 命令被阻止 | 拒绝执行并通知用户 |
| `NETWORK_DENIED` | 网络访问被拒绝 | 返回错误详情 |
| `FILESYSTEM_DENIED` | 文件系统访问被拒绝 | 返回错误详情 |
| `TIMEOUT` | 执行超时 | 终止进程并返回 |
| `RESOURCE_LIMIT` | 资源超限 | 终止进程并返回 |

---

## 10. 性能要求

- **启动延迟**: <50ms
- **输出延迟**: <10ms
- **清理时间**: <100ms
- **内存增长**: <10MB/命令

---

## 11. 审计日志

```typescript
interface AuditLogEntry {
  type: "sandbox_execute";
  command: string;
  cwd: string;
  exitCode: number;
  duration: number;
  timestamp: Date;
  userId?: string;
  sessionId: string;
  networkAccess: boolean;
  fileAccess: string[];
}
```

---

**任务状态**: 待执行
**负责人**: AI Agent
**预计时间**: 45 分钟

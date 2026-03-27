# 任务：清理沙箱资源

> **版本**: 1.0.0
> **创建时间**: 2026-03-27
> **类型**: sandbox

---

## 1. 任务描述

清理沙箱占用的资源，包括临时文件、进程、网络连接等。

---

## 2. 输入参数

```typescript
interface SandboxCleanupInput {
  // 沙箱实例
  sandbox: SandboxInterface;
  
  // 清理选项
  options?: {
    // 是否强制清理（即使有运行中的命令）
    force?: boolean;
    
    // 清理超时时间（秒）
    timeout?: number;
    
    // 是否保留日志
    keepLogs?: boolean;
  };
}
```

---

## 3. 输出结果

```typescript
interface SandboxCleanupOutput {
  // 清理状态
  status: "success" | "partial" | "failed";
  
  // 清理的资源
  cleaned: {
    // 终止的进程数
    processes: number;
    
    // 删除的临时文件数
    tempFiles: number;
    
    // 释放的内存（字节）
    memory: number;
    
    // 关闭的网络连接数
    connections: number;
  };
  
  // 错误信息（如果有）
  errors?: Array<{
    type: string;
    message: string;
  }>;
  
  // 清理时间（毫秒）
  duration: number;
}
```

---

## 4. 前置条件

- [ ] 沙箱实例存在
- [ ] 有权限清理资源

---

## 5. 实现步骤

### Step 1: 检查运行中的进程

```typescript
const runningProcesses = await sandbox.getRunningProcesses();

if (runningProcesses.length > 0 && !options?.force) {
  throw new Error(
    `Cannot cleanup: ${runningProcesses.length} processes still running. ` +
    `Use force: true to terminate them.`
  );
}
```

### Step 2: 终止运行中的命令

```typescript
if (options?.force) {
  for (const proc of runningProcesses) {
    try {
      await sandbox.terminateProcess(proc.pid);
      cleaned.processes++;
    } catch (error) {
      errors.push({
        type: "process_terminate_failed",
        message: `Failed to terminate process ${proc.pid}: ${error.message}`,
      });
    }
  }
}
```

### Step 3: 清理临时文件

```typescript
const tempDir = path.join(os.tmpdir(), `sandbox-${sandbox.id}`);

try {
  const files = await fs.promises.readdir(tempDir);
  
  for (const file of files) {
    try {
      await fs.promises.unlink(path.join(tempDir, file));
      cleaned.tempFiles++;
    } catch (error) {
      errors.push({
        type: "file_delete_failed",
        message: `Failed to delete ${file}: ${error.message}`,
      });
    }
  }
  
  // 删除临时目录
  await fs.promises.rmdir(tempDir);
} catch (error) {
  // 临时目录不存在，忽略
}
```

### Step 4: 释放内存

```typescript
const beforeMemory = process.memoryUsage();

// 执行清理
await sandbox.cleanup();

const afterMemory = process.memoryUsage();

cleaned.memory = beforeMemory.heapUsed - afterMemory.heapUsed;
```

### Step 5: 关闭网络连接

```typescript
const connections = await sandbox.getActiveConnections();

for (const conn of connections) {
  try {
    await sandbox.closeConnection(conn.id);
    cleaned.connections++;
  } catch (error) {
    errors.push({
      type: "connection_close_failed",
      message: `Failed to close connection ${conn.id}: ${error.message}`,
    });
  }
}
```

### Step 6: 保留日志（可选）

```typescript
if (options?.keepLogs) {
  const logDir = path.join(app.getPath("logs"), "sandbox");
  await fs.promises.mkdir(logDir, { recursive: true });
  
  const logFile = path.join(logDir, `sandbox-${Date.now()}.log`);
  await fs.promises.writeFile(logFile, JSON.stringify(sandbox.logs, null, 2));
}
```

### Step 7: 记录审计日志

```typescript
await auditLogger.log({
  type: "sandbox_cleanup",
  sandboxId: sandbox.id,
  cleaned,
  errors: errors.length,
  duration: Date.now() - startTime,
  timestamp: new Date(),
});
```

---

## 6. 示例

### 基本清理

```typescript
const result = await cleanupSandbox(sandbox);

console.log(result.status);  // "success"
console.log(result.cleaned);
// {
//   processes: 0,
//   tempFiles: 15,
//   memory: 52428800,  // 50MB
//   connections: 2
// }
```

### 强制清理

```typescript
const result = await cleanupSandbox(sandbox, {
  force: true,  // 终止运行中的命令
  timeout: 10,  // 10 秒超时
});

console.log(result.cleaned.processes);  // 3 (终止了 3 个进程)
```

### 保留日志

```typescript
const result = await cleanupSandbox(sandbox, {
  keepLogs: true,  // 保留日志到文件
});

// 日志保存到: ~/Library/Logs/nuwaclaw/sandbox/sandbox-1648765432000.log
```

### 处理清理错误

```typescript
const result = await cleanupSandbox(sandbox);

if (result.status === "partial") {
  console.warn("部分清理失败:");
  result.errors.forEach(err => {
    console.warn(`  - ${err.type}: ${err.message}`);
  });
}
```

---

## 7. 验证清单

- [ ] 所有进程已终止（如果 force=true）
- [ ] 临时文件已清理
- [ ] 内存已释放
- [ ] 网络连接已关闭
- [ ] 审计日志已记录
- [ ] 沙箱状态已更新

---

## 8. 错误处理

| 错误代码 | 说明 | 处理方式 |
|---------|------|---------|
| `PROCESSES_RUNNING` | 有进程在运行 | 提示使用 force=true |
| `TIMEOUT` | 清理超时 | 返回已清理的资源 |
| `PERMISSION_DENIED` | 权限不足 | 提示用户提升权限 |
| `RESOURCE_LEAK` | 资源泄漏 | 记录日志并继续 |

---

## 9. 性能要求

- **清理时间**: <500ms
- **内存释放率**: >95%
- **临时文件清理率**: 100%

---

## 10. 安全考虑

- ✅ 不删除用户数据
- ✅ 保留审计日志（如果配置）
- ✅ 验证文件路径
- ✅ 处理并发清理请求

---

## 11. 自动清理策略

### 定时清理

```typescript
// 每小时清理一次空闲沙箱
setInterval(async () => {
  const idleSandboxes = await getIdleSandboxes();
  
  for (const sandbox of idleSandboxes) {
    await cleanupSandbox(sandbox);
  }
}, 60 * 60 * 1000);  // 1 小时
```

### 退出时清理

```typescript
// 应用退出时清理所有沙箱
process.on("exit", async () => {
  const sandboxes = await getAllSandboxes();
  
  for (const sandbox of sandboxes) {
    await cleanupSandbox(sandbox, { force: true });
  }
});
```

### 内存阈值清理

```typescript
// 内存使用超过 80% 时清理
const memoryMonitor = setInterval(async () => {
  const usage = process.memoryUsage();
  const memoryPercent = usage.heapUsed / usage.heapTotal;
  
  if (memoryPercent > 0.8) {
    console.warn("Memory usage high, cleaning up sandboxes...");
    await cleanupOldestSandboxes(3);  // 清理 3 个最旧的沙箱
  }
}, 10 * 1000);  // 10 秒检查一次
```

---

**任务状态**: 待执行
**负责人**: AI Agent
**预计时间**: 30 分钟

# NuwaClaw Sandbox 统一 API 规范

> **版本**: 1.0.0
> **更新**: 2026-03-27

---

## 1. 核心接口

### SandboxInterface

```typescript
interface SandboxInterface {
  // 初始化
  initialize(config: SandboxConfig): Promise<void>;

  // 执行命令
  execute(command: string, cwd: string, options?: ExecuteOptions): Promise<ExecuteResult>;

  // 文件操作
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;

  // 状态查询
  isAvailable(): Promise<boolean>;
  getStatus(): SandboxStatus;

  // 清理
  cleanup(): Promise<void>;
}
```

---

## 2. 配置类型

```typescript
type SandboxMode = "off" | "on-demand" | "non-main" | "all";

interface SandboxConfig {
  mode: SandboxMode;
  platform: PlatformConfig;
  network: NetworkConfig;
  filesystem: FilesystemConfig;
  resources: ResourceConfig;
}
```

---

## 3. 执行类型

```typescript
interface ExecuteOptions {
  timeout?: number;
  signal?: AbortSignal;
  onOutput?: (data: string) => void;
  env?: Record<string, string>;
}

interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration?: number;
  resources?: ResourceUsage;
}
```

---

## 4. 状态类型

```typescript
interface SandboxStatus {
  available: boolean;
  type: "seatbelt" | "bubblewrap" | "codex" | "none";
  platform: string;
  version?: string;
}
```

---

## 5. 错误类型

```typescript
enum SandboxErrorCode {
  SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE",
  EXECUTION_FAILED = "EXECUTION_FAILED",
  TIMEOUT = "TIMEOUT",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RESOURCE_LIMIT = "RESOURCE_LIMIT",
}

class SandboxError extends Error {
  code: SandboxErrorCode;
  details?: any;
}
```

---

## 6. 使用示例

```typescript
// 创建沙箱
const sandbox = new AutoSandbox();
await sandbox.initialize(config);

// 执行命令
const result = await sandbox.execute("npm install", "/workspace", {
  timeout: 300,
  onOutput: (data) => console.log(data),
});

// 检查状态
const status = sandbox.getStatus();
console.log(status.available);  // true

// 清理资源
await sandbox.cleanup();
```

---

**规范版本**: 1.0.0
**最后更新**: 2026-03-27

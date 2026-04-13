# NuwaClaw Sandbox API 文档

> **版本**: 1.0.0
> **更新日期**: 2026-03-27

---

## 1. 概述

NuwaClaw Sandbox API 提供统一的沙箱执行接口，支持 macOS、Linux 和 Windows 平台。

---

## 2. TypeScript API

### 2.1 NuwaxSandbox 类

```typescript
import { NuwaxSandbox, SandboxConfig, ExecuteResult } from '@nuwax/sandbox-native';

const sandbox = new NuwaxSandbox();
```

#### 2.1.1 构造函数

```typescript
constructor()
```

创建沙箱实例。

**示例**:
```typescript
const sandbox = new NuwaxSandbox();
```

---

#### 2.1.2 execute 方法

```typescript
async execute(
  command: string,
  cwd: string,
  config?: Partial<SandboxConfig>
): Promise<ExecuteResult>
```

在沙箱中执行命令。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `command` | string | ✅ | 要执行的命令 |
| `cwd` | string | ✅ | 工作目录 |
| `config` | SandboxConfig | ❌ | 沙箱配置 |

**返回值**:

```typescript
interface ExecuteResult {
  exitCode: number;      // 退出码
  stdout: string;        // 标准输出
  stderr: string;        // 标准错误
}
```

**示例**:

```typescript
const result = await sandbox.execute(
  'npm install',
  '/Users/user/project',
  {
    networkEnabled: true,
    memoryLimit: '2g',
    timeout: 300,
  }
);

console.log(result.exitCode);  // 0
console.log(result.stdout);    // "added 100 packages..."
```

---

#### 2.1.3 isAvailable 方法

```typescript
isAvailable(): boolean
```

检查沙箱是否可用。

**返回值**: `true` 表示可用

**示例**:

```typescript
if (sandbox.isAvailable()) {
  console.log('Sandbox is available');
}
```

---

### 2.2 配置类型

#### SandboxConfig

```typescript
interface SandboxConfig {
  // 网络配置
  networkEnabled?: boolean;              // 是否启用网络
  allowedDomains?: string[];             // 允许的域名
  deniedDomains?: string[];              // 禁止的域名
  
  // 资源限制
  memoryLimit?: string;                  // 内存限制 (e.g., "2g")
  cpuLimit?: number;                     // CPU 核心数限制
  timeout?: number;                      // 超时时间（秒）
  
  // 文件系统
  allowRead?: string[];                  // 允许读取的路径
  denyRead?: string[];                   // 禁止读取的路径
  allowWrite?: string[];                 // 允许写入的路径
  denyWrite?: string[];                  // 禁止写入的路径
}
```

**默认值**:

```typescript
const DEFAULT_CONFIG: SandboxConfig = {
  networkEnabled: false,
  memoryLimit: '2g',
  cpuLimit: 2,
  timeout: 300,
  
  allowRead: ['.'],
  denyRead: ['~/.ssh', '~/.aws', '~/.gnupg'],
  allowWrite: ['.', '/tmp'],
  denyWrite: ['.env', '*.pem', '*.key'],
};
```

---

## 3. 配置管理 API

### 3.1 SandboxConfigManager

```typescript
import { SandboxConfigManager } from '@main/services/sandbox/SandboxConfigManager';

const configManager = new SandboxConfigManager();
```

#### 3.1.1 getConfig

```typescript
getConfig(): SandboxConfig
```

获取当前沙箱配置。

**示例**:

```typescript
const config = configManager.getConfig();
console.log(config.mode);  // "non-main"
```

---

#### 3.1.2 updateConfig

```typescript
updateConfig(updates: Partial<SandboxConfig>): void
```

更新沙箱配置。

**示例**:

```typescript
configManager.updateConfig({
  mode: 'all',
  network: {
    enabled: true,
    allowedDomains: ['github.com'],
  },
});
```

---

#### 3.1.3 setMode

```typescript
setMode(mode: SandboxMode): void
```

设置沙箱模式。

**参数**:
- `mode`: `"off"` | `"on-demand"` | `"non-main"` | `"all"`

**示例**:

```typescript
configManager.setMode('non-main');
```

---

#### 3.1.4 isEnabled

```typescript
isEnabled(sessionId?: string): boolean
```

检查沙箱是否启用。

**参数**:
- `sessionId`: 会话 ID（可选）

**返回值**:
- `true` 表示启用

**示例**:

```typescript
// 检查全局是否启用
const globalEnabled = configManager.isEnabled();

// 检查特定会话是否启用
const sessionEnabled = configManager.isEnabled('session-123');
```

---

## 4. IPC API

### 4.1 渲染进程调用

#### 4.1.1 获取配置

```typescript
const config = await window.electron.invoke('sandbox:get-config');
```

#### 4.1.2 设置模式

```typescript
await window.electron.invoke('sandbox:set-mode', 'non-main');
```

#### 4.1.3 更新配置

```typescript
await window.electron.invoke('sandbox:update-config', {
  network: {
    enabled: true,
  },
});
```

#### 4.1.4 重置配置

```typescript
await window.electron.invoke('sandbox:reset-config');
```

#### 4.1.5 获取状态

```typescript
const status = await window.electron.invoke('sandbox:get-status');
// {
//   enabled: true,
//   mode: 'non-main',
//   platform: 'darwin',
//   available: true,
//   type: 'seatbelt'
// }
```

---

## 5. Rust API (内部使用)

### 5.1 SandboxInterface

```rust
pub trait SandboxInterface {
    /// 初始化沙箱
    fn initialize(&mut self, config: SandboxConfig) -> Result<(), SandboxError>;
    
    /// 执行命令
    fn execute(&self, command: &str, cwd: &str, config: &SandboxConfig) -> Result<ExecuteResult, SandboxError>;
    
    /// 读取文件
    fn read_file(&self, session_id: &str, path: &str) -> Result<String, SandboxError>;
    
    /// 写入文件
    fn write_file(&self, session_id: &str, path: &str, content: &str) -> Result<(), SandboxError>;
    
    /// 检查是否可用
    fn is_available(&self) -> bool;
    
    /// 获取状态
    fn get_status(&self) -> SandboxStatus;
    
    /// 清理资源
    fn cleanup(&mut self) -> Result<(), SandboxError>;
}
```

### 5.2 配置结构

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub network_enabled: Option<bool>,
    pub memory_limit: Option<String>,
    pub cpu_limit: Option<i32>,
    pub timeout: Option<i32>,
    
    pub allowed_domains: Option<Vec<String>>,
    pub denied_domains: Option<Vec<String>>,
    
    pub allow_read: Option<Vec<String>>,
    pub deny_read: Option<Vec<String>>,
    pub allow_write: Option<Vec<String>>,
    pub deny_write: Option<Vec<String>>,
}
```

### 5.3 执行结果

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}
```

---

## 6. 错误处理

### 6.1 错误类型

```typescript
enum SandboxErrorCode {
  SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RESOURCE_LIMIT = 'RESOURCE_LIMIT',
}
```

### 6.2 错误示例

```typescript
try {
  const result = await sandbox.execute('rm -rf /', '/tmp');
} catch (error) {
  if (error.code === 'PERMISSION_DENIED') {
    console.error('Permission denied');
  }
}
```

---

## 7. 使用示例

### 7.1 基本使用

```typescript
import { NuwaxSandbox } from '@nuwax/sandbox-native';

const sandbox = new NuwaxSandbox();

// 执行简单命令
const result = await sandbox.execute('ls -la', '/Users/user');
console.log(result.stdout);
```

### 7.2 网络访问

```typescript
// 允许网络访问
const result = await sandbox.execute(
  'npm install',
  '/Users/user/project',
  {
    networkEnabled: true,
    allowedDomains: ['registry.npmjs.org'],
  }
);
```

### 7.3 资源限制

```typescript
// 限制资源使用
const result = await sandbox.execute(
  'cargo build --release',
  '/Users/user/rust-project',
  {
    memoryLimit: '4g',
    cpuLimit: 4,
    timeout: 600,  // 10 分钟
  }
);
```

### 7.4 文件系统隔离

```typescript
// 限制文件访问
const result = await sandbox.execute(
  'python script.py',
  '/Users/user/project',
  {
    allowRead: ['/Users/user/project', '/usr/local/lib'],
    denyRead: ['~/.ssh', '~/.aws'],
    allowWrite: ['/Users/user/project', '/tmp'],
    denyWrite: ['.env'],
  }
);
```

---

## 8. 平台特定行为

### 8.1 macOS (sandbox-exec)

```typescript
// macOS 使用 Seatbelt 配置文件
// 自动生成 .sb 配置文件
// 示例配置:
(version 1)
(allow default)
(allow file-read* (subpath "/Users/user/project"))
(deny file-read* (subpath "~/.ssh"))
```

### 8.2 Linux (bubblewrap)

```bash
# Linux 使用 bubblewrap 命令
bwrap \
  --ro-bind /usr /usr \
  --bind /workspace /workspace \
  --unshare-all \
  --die-with-parent \
  bash -c "command"
```

### 8.3 Windows (Codex Sandbox)

```rust
// Windows 使用 Codex 实现
// 基于 Windows Job Objects 和 Restricted Tokens
// 自动处理进程隔离和权限限制
```

---

## 9. 性能指标

| 操作 | macOS | Linux | Windows |
|------|-------|-------|---------|
| **启动时间** | <50ms | <100ms | <200ms |
| **命令执行** | 原生 | 原生 | 轻微开销 |
| **内存占用** | ~10MB | ~20MB | ~50MB |
| **网络过滤** | 系统 | iptables | WinAPI |
| **文件隔离** | 系统 | 命名空间 | Job Objects |

---

## 10. 最佳实践

### 10.1 始终检查可用性

```typescript
if (!sandbox.isAvailable()) {
  console.warn('Sandbox not available, running unsandboxed');
}
```

### 10.2 设置合理的超时

```typescript
const result = await sandbox.execute(command, cwd, {
  timeout: 300,  // 5 分钟
});
```

### 10.3 限制网络访问

```typescript
// 仅允许必要的域名
const result = await sandbox.execute(command, cwd, {
  networkEnabled: true,
  allowedDomains: ['github.com', 'registry.npmjs.org'],
});
```

### 10.4 处理错误

```typescript
try {
  const result = await sandbox.execute(command, cwd, config);
  
  if (result.exitCode !== 0) {
    console.error('Command failed:', result.stderr);
  }
} catch (error) {
  console.error('Sandbox error:', error);
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-27

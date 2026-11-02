# 沙箱命令参考

> **版本**: 1.0.0  
> **更新**: 2026-03-22

---

## 1. IPC 命令

### 1.1 工作区管理

#### `sandbox:create`

创建新的沙箱工作区。

**请求：**
```typescript
{
  sessionId: string;
  platform: 'darwin' | 'win32' | 'linux';
  sandboxType: 'docker' | 'wsl' | 'firejail' | 'none';
  memoryLimit?: string;
  diskQuota?: string;
}
```

**响应：**
```typescript
{
  id: string;
  rootPath: string;
  projectsPath: string;
  nodeModulesPath: string;
  pythonEnvPath: string;
  binPath: string;
  sandboxType: string;
  createdAt: string;
}
```

**示例：**
```typescript
const workspace = await window.api.invoke('sandbox:create', {
  sessionId: 'session-123',
  platform: 'darwin',
  sandboxType: 'docker',
  memoryLimit: '2g',
  diskQuota: '10g'
});
```

---

#### `sandbox:destroy`

销毁沙箱工作区。

**请求：**
```typescript
{
  sessionId: string;
  force?: boolean;
}
```

**响应：**
```typescript
{
  success: boolean;
  freedSpace?: string;
}
```

**示例：**
```typescript
await window.api.invoke('sandbox:destroy', {
  sessionId: 'session-123',
  force: true
});
```

---

#### `sandbox:list`

列出所有工作区。

**请求：** `void`

**响应：**
```typescript
Workspace[]
```

**示例：**
```typescript
const workspaces = await window.api.invoke('sandbox:list');
console.log(`Active workspaces: ${workspaces.length}`);
```

---

#### `sandbox:info`

获取工作区详细信息。

**请求：**
```typescript
{
  sessionId: string;
}
```

**响应：**
```typescript
Workspace | null
```

---

### 1.2 文件操作

#### `sandbox:readFile`

在工作区内读取文件。

**请求：**
```typescript
{
  sessionId: string;
  path: string;
}
```

**响应：**
```typescript
{
  content: string;
}
```

**示例：**
```typescript
const { content } = await window.api.invoke('sandbox:readFile', {
  sessionId: 'session-123',
  path: 'projects/myapp/package.json'
});
```

---

#### `sandbox:writeFile`

在工作区内写入文件。

**请求：**
```typescript
{
  sessionId: string;
  path: string;
  content: string;
}
```

**响应：**
```typescript
{
  success: boolean;
}
```

**示例：**
```typescript
await window.api.invoke('sandbox:writeFile', {
  sessionId: 'session-123',
  path: 'projects/myapp/index.js',
  content: 'console.log("Hello");'
});
```

---

#### `sandbox:readDir`

列出目录内容。

**请求：**
```typescript
{
  sessionId: string;
  path: string;
}
```

**响应：**
```typescript
{
  files: Array<{
    name: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: string;
  }>;
}
```

---

### 1.3 命令执行

#### `sandbox:execute`

在工作区中执行命令。

**请求：**
```typescript
{
  sessionId: string;
  command: string;
  args: string[];
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    stdio?: 'pipe' | 'inherit';
  };
}
```

**响应：**
```typescript
{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  duration: number;
}
```

**示例：**
```typescript
const result = await window.api.invoke('sandbox:execute', {
  sessionId: 'session-123',
  command: 'npm',
  args: ['install', 'lodash'],
  options: {
    cwd: 'projects/myapp',
    timeout: 120000
  }
});

if (result.exitCode === 0) {
  console.log('Install successful');
} else {
  console.error('Install failed:', result.stderr);
}
```

---

### 1.4 权限管理

#### `sandbox:checkPermission`

检查权限状态。

**请求：**
```typescript
{
  sessionId: string;
  type: PermissionType;
  target: string;
}
```

**响应：**
```typescript
{
  allowed: boolean;
  reason: string;
  requestId?: string;
}
```

---

#### `sandbox:requestPermission`

请求权限。

**请求：**
```typescript
{
  sessionId: string;
  type: PermissionType;
  target: string;
  reason?: string;
}
```

**响应：**
```typescript
Permission
```

---

#### `sandbox:getPendingPermissions`

获取待审批的权限请求。

**请求：**
```typescript
{
  sessionId?: string;
}
```

**响应：**
```typescript
PermissionRequest[]
```

---

#### `sandbox:approvePermission`

批准权限请求。

**请求：**
```typescript
{
  requestId: string;
}
```

**响应：**
```typescript
{
  success: boolean;
}
```

---

#### `sandbox:denyPermission`

拒绝权限请求。

**请求：**
```typescript
{
  requestId: string;
  reason?: string;
}
```

**响应：**
```typescript
{
  success: boolean;
}
```

---

### 1.5 清理与状态

#### `sandbox:cleanup`

清理所有过期工作区。

**请求：** `void`

**响应：**
```typescript
{
  deletedCount: number;
  freedSpace: string;
  errors: string[];
}
```

---

#### `sandbox:status`

获取沙箱状态。

**请求：** `void`

**响应：**
```typescript
{
  available: boolean;
  type: SandboxType;
  platform: Platform;
  activeWorkspaces: number;
  totalMemory?: string;
  diskUsage?: string;
}
```

---

## 2. 命令行工具

### 2.1 Docker 命令

```bash
# 列出容器
docker ps

# 查看容器日志
docker logs <container-id>

# 进入容器
docker exec -it <container-id> /bin/sh

# 停止容器
docker stop <container-id>

# 删除容器
docker rm <container-id>

# 清理未使用资源
docker system prune -a
```

### 2.2 WSL 命令 (Windows)

```powershell
# 列出发行版
wsl --list --verbose

# 启动发行版
wsl -d Ubuntu-22.04

# 关闭所有实例
wsl --shutdown

# 导出发行版
wsl --export Ubuntu-22.04 ubuntu.tar
```

### 2.3 Firejail 命令 (Linux)

```bash
# 使用 profile 启动
firejail --profile=/path/to/profile command

# 查看可用 profiles
ls /etc/firejail/

# 测试 profile
firejail --debug-profile=/path/to/profile command
```

---

## 3. 权限类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `file:read` | 读取文件 | 读取 package.json |
| `file:write` | 写入文件 | 修改配置文件 |
| `file:delete` | 删除文件 | 删除临时文件 |
| `command:execute` | 执行命令 | 运行 npm install |
| `network:access` | 访问网络 | 调用 API |
| `network:download` | 下载资源 | 下载包 |
| `package:install:npm` | 安装 npm 包 | npm install lodash |
| `package:install:python` | 安装 Python 包 | pip install flask |
| `package:install:system` | 安装系统包 | apt install nginx |

---

## 4. 配置示例

### 4.1 创建 Docker 沙箱

```typescript
const workspace = await window.api.invoke('sandbox:create', {
  sessionId: 'session-123',
  platform: 'darwin',
  sandboxType: 'docker',
  memoryLimit: '4g',
  diskQuota: '20g'
});
```

### 4.2 执行 npm install

```typescript
// 先检查权限
const perm = await window.api.invoke('sandbox:checkPermission', {
  sessionId: 'session-123',
  type: 'package:install:npm',
  target: 'lodash'
});

if (!perm.allowed) {
  // 请求权限
  const request = await window.api.invoke('sandbox:requestPermission', {
    sessionId: 'session-123',
    type: 'package:install:npm',
    target: 'lodash',
    reason: 'Need lodash for utility functions'
  });
  
  // 等待批准...
}

// 执行安装
const result = await window.api.invoke('sandbox:execute', {
  sessionId: 'session-123',
  command: 'npm',
  args: ['install', 'lodash'],
  options: {
    cwd: 'projects/myapp',
    timeout: 120000
  }
});
```

### 4.3 批量清理

```typescript
// 获取所有工作区
const workspaces = await window.api.invoke('sandbox:list');

// 销毁所有
for (const ws of workspaces) {
  await window.api.invoke('sandbox:destroy', {
    sessionId: ws.id,
    force: true
  });
}

// 或者使用 cleanup
const cleanup = await window.api.invoke('sandbox:cleanup');
console.log(`Freed: ${cleanup.freedSpace}`);
```

---

## 5. 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-03-22 | 1.0.0 | 初始版本 |

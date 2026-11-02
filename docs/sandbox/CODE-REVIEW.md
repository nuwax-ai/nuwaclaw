# 沙箱实现代码审查报告

**审查日期**: 2026-03-22
**审查者**: Claude Code
**版本**: 1.0.0

---

## 1. 总体评价

### 评分: 7.5 / 10

### 优点
- 类型定义完整，覆盖了沙箱、工作区、权限、执行结果等核心概念
- 错误处理体系完善，有专门的错误类和错误码
- 抽象基类设计合理，支持多种沙箱类型（Docker、WSL、Firejail）
- 权限管理实现了分层策略（自动批准、需要确认、禁止）
- 事件驱动架构，支持状态监听

### 不足
- 部分安全检查存在漏洞
- 缺少持久化存储实现
- 代码注释不完整
- 部分边界情况未处理
- 测试覆盖未知

---

## 2. 各文件详细评价

### 2.1 `src/shared/types/sandbox.ts` - 类型定义

**评分**: 8.5/10

#### 优点
- 类型定义非常完整，覆盖了所有核心概念
- JSDoc 注释详细
- 支持 Harness 架构的 CP 工作流概念（Checkpoint、GateStatus）
- 事件类型定义完整（SandboxEvents 接口）

#### 问题

| 严重程度 | 问题描述 | 位置 |
|---------|---------|------|
| 🟡 中 | `PermissionLevel` 类型定义了 0-3 级别，但代码中未使用 | L34 |
| 🟡 中 | `WorkflowState.workspaces` 使用 `Record<string, WorkspaceRecord>` 但 `Workspace` 对象更完整 | L367 |
| 🟢 低 | `FileInfo.permissions` 是可选的字符串，缺少类型定义 | L213 |

#### 建议
```typescript
// 建议: 添加 PermissionLevel 的使用场景说明或移除
// 建议: FileInfo.permissions 使用更结构化的类型
export interface FilePermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
}
```

---

### 2.2 `src/shared/errors/sandbox.ts` - 错误类

**评分**: 8/10

#### 优点
- 错误码枚举完整，覆盖所有场景
- 错误类层次结构清晰（基类 SandboxError + 特化类）
- `getUserMessage()` 提供用户友好的错误信息
- `isRecoverable()` 和 `requiresUserIntervention()` 有助于错误处理决策

#### 问题

| 严重程度 | 问题描述 | 位置 |
|---------|---------|------|
| 🔴 高 | `toSandboxError` 可能丢失原始错误的堆栈信息 | L407-417 |
| 🟡 中 | `cause` 属性在 `toJSON` 中只序列化 message，可能丢失重要信息 | L146 |
| 🟡 中 | `PermissionError` 硬编码了 `PERMISSION_DENIED`，无法使用其他权限相关错误码 | L313-316 |

#### 建议
```typescript
// 建议: 保留完整的错误链
if (error instanceof Error) {
  const sandboxError = new SandboxError(error.message || defaultMessage, defaultCode, {
    ...options,
    cause: error,
  });
  // 保留原始堆栈
  sandboxError.stack = error.stack;
  return sandboxError;
}
```

---

### 2.3 `src/main/services/sandbox/SandboxManager.ts` - 基类

**评分**: 7.5/10

#### 优点
- 抽象方法定义清晰，子类必须实现
- 提供了实用的静态工具方法（`parseMemoryLimit`, `formatMemory`）
- 工作区验证逻辑完善
- 支持事件发射

#### 问题

| 严重程度 | 问题描述 | 位置 |
|---------|---------|------|
| 🔴 高 | `normalizePath` 使用 `toLowerCase()` 可能导致路径比较问题（不区分大小写的文件系统） | L240-241 |
| 🟡 中 | `destroy()` 方法捕获错误后使用 `console.error` 而非 `log` | L281 |
| 🟡 中 | `generateWorkspaceId` 仅使用时间戳，高并发下可能冲突 | L247-249 |
| 🟢 低 | `emitEvent` 的泛型参数 `T extends string` 未提供实际类型约束 | L266 |

#### 建议
```typescript
// 建议: 使用 UUID 或更可靠的 ID 生成方式
protected generateWorkspaceId(sessionId: string): string {
  const { randomUUID } = require('crypto');
  return `workspace-${sessionId}-${randomUUID().slice(0, 8)}`;
}

// 建议: 路径规范化不应使用 toLowerCase
protected normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
```

---

### 2.4 `src/main/services/sandbox/DockerSandbox.ts` - Docker 实现

**评分**: 7/10

#### 优点
- 完整的 Docker 生命周期管理
- 资源限制配置（内存、CPU）
- 失败时自动清理资源
- 超时处理完善

#### 问题

| 严重程度 | 问题描述 | 位置 |
|---------|---------|------|
| 🔴 高 | **命令注入漏洞**: `docker image inspect ${image}` 未对镜像名进行转义 | L142 |
| 🔴 高 | **命令注入漏洞**: `docker pull ${image}` 同样存在问题 | L147 |
| 🔴 高 | `startContainer` 中 `args.join(" ")` 构建命令字符串，参数未转义 | L672 |
| 🟡 中 | `execAsync` 超时可能导致僵尸进程 | 多处 |
| 🟡 中 | `readFile`/`writeFile` 直接操作主机文件系统，未通过容器 | L361-408 |
| 🟡 中 | `getDirectorySize` 递归计算大目录可能很慢 | L794-813 |
| 🟢 低 | `tail -f /dev/null` 作为容器保持运行的方式不够优雅 | L667-669 |

#### 建议
```typescript
// 建议: 使用 spawn 并正确传递参数，避免命令注入
private async ensureImageExists(): Promise<void> {
  const image = this.dockerConfig.dockerImage;

  // 验证镜像名格式
  if (!/^[a-zA-Z0-9._/:-]+$/.test(image)) {
    throw new SandboxError("无效的镜像名称", SandboxErrorCode.CONFIG_INVALID);
  }

  try {
    await execAsync(`docker image inspect`, [image], { timeout: 10000 });
  } catch {
    await execAsync(`docker pull`, [image], { timeout: 300000 });
  }
}

// 建议: 使用 spawn 替代 exec 构建命令
private async startContainer(...): Promise<string> {
  const args = ["run", "-d", "--name", containerName, ...];
  const proc = spawn("docker", args);
  // ...
}
```

---

### 2.5 `src/main/services/sandbox/PermissionManager.ts` - 权限管理

**评分**: 7/10

#### 优点
- 分层权限策略（自动批准、需要确认、禁止）
- 安全命令白名单
- 危险命令黑名单检测
- 权限缓存机制

#### 问题

| 严重程度 | 问题描述 | 位置 |
|---------|---------|------|
| 🔴 高 | `checkDangerousOperation` 使用 `includes` 检测，可被绕过（如 `sudo\n` 或 `sud o`） | L628-638 |
| 🔴 高 | 危险命令检测对大小写敏感，`SUDO` 或 `SuDo` 可绕过 | L628-638 |
| 🟡 中 | `requestPermission` 超时后 pendingRequests 中的请求未清理（虽然 delete 了，但监听器还在） | L305-329 |
| 🟡 中 | 敏感路径检测逻辑错误: `!lowerTarget.startsWith("/etc/")` 永远为 true | L651 |
| 🟡 中 | 缓存键包含完整 target，大路径可能导致内存问题 | L606-611 |
| 🟢 低 | 60 秒超时硬编码 | L313 |

#### 建议
```typescript
// 建议: 增强危险命令检测
private checkDangerousOperation(
  type: PermissionType,
  target: string,
): { isDangerous: boolean; reason?: string } {
  // 规范化: 移除空白字符，转小写
  const normalizedTarget = target.toLowerCase().replace(/\s+/g, ' ').trim();

  for (const dangerous of DANGEROUS_COMMANDS) {
    // 使用更严格的匹配
    const pattern = new RegExp(`\\b${escapeRegex(dangerous.toLowerCase())}\\b`);
    if (pattern.test(normalizedTarget)) {
      return {
        isDangerous: true,
        reason: `检测到危险操作: ${dangerous}`,
      };
    }
  }

  // 修复敏感路径检测
  if (this.isPathPermission(type)) {
    if (normalizedTarget.includes('/.ssh') || normalizedTarget.includes('\\.ssh')) {
      return { isDangerous: true, reason: "禁止访问 SSH 目录" };
    }
    if (normalizedTarget.startsWith('/etc/')) {
      return { isDangerous: true, reason: "禁止访问系统配置目录" };
    }
  }

  return { isDangerous: false };
}

// 建议: 修复超时后的清理
const timeout = setTimeout(() => {
  this.pendingRequests.delete(request.id);
  this.removeAllListeners(`permission:${request.id}`); // 清理监听器
  reject(...);
}, 60000);
```

---

### 2.6 `src/main/services/sandbox/WorkspaceManager.ts` - 工作区管理

**评分**: 8/10

#### 优点
- 整合 SandboxManager 和 PermissionManager
- 统一的工作区生命周期管理
- 权限检查与文件操作集成
- 保留策略支持

#### 问题

| 严重程度 | 问题描述 | 位置 |
|---------|---------|------|
| 🟡 中 | `cleanupExpired` 中工作区数量检查逻辑可能导致多次清理同一工作区 | L399-410 |
| 🟡 中 | `validatePathInWorkspace` 重复实现了基类的方法 | L536-550 |
| 🟡 中 | `destroy` 方法的 `force` 参数在错误时只记录日志，不抛出异常，可能隐藏问题 | L167-181 |
| 🟢 低 | `isPathPermission` 重复定义（PermissionManager 中已有） | L529-531 |

#### 建议
```typescript
// 建议: 优化工作区数量检查逻辑
if (policy.maxWorkspaces && workspaces.length > policy.maxWorkspaces) {
  const sorted = [...workspaces].sort(
    (a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime(),
  );
  const toRemove = sorted.slice(0, workspaces.length - policy.maxWorkspaces);
  const idsToRemove = new Set(toRemove.map(w => w.id));

  if (idsToRemove.has(workspace.id)) {
    shouldCleanup = true;
  }
}

// 建议: 复用基类的路径验证方法
private validatePathInWorkspace(workspace: Workspace, path: string): void {
  // 直接调用 SandboxManager 的方法
  // 或提取为共享工具函数
}
```

---

### 2.7 `src/main/ipc/sandboxHandlers.ts` - IPC 通道

**评分**: 8/10

#### 优点
- 服务注入模式，解耦良好
- 统一的错误处理
- 完整的 JSDoc 注释
- IPC 通道命名规范

#### 问题

| 严重程度 | 问题描述 | 位置 |
|---------|---------|------|
| 🟡 中 | 服务类型定义使用 `typeof sandboxService`，但初始值为 `null`，类型推断可能不准确 | L31-50 |
| 🟡 中 | `handleError` 返回的 `code` 字段类型不明确（`code?: string`） | L118 |
| 🟡 中 | 缺少 IPC 通道注销函数 | - |
| 🟢 低 | 日志记录了敏感信息（如完整路径） | L264 等 |

#### 建议
```typescript
// 建议: 使用接口定义服务类型
interface SandboxService {
  createWorkspace(sessionId: string, options?: CreateWorkspaceOptions): Promise<Workspace>;
  destroyWorkspace(sessionId: string): Promise<void>;
  // ...
}

let sandboxService: SandboxService | null = null;

// 建议: 添加注销函数
export function unregisterSandboxHandlers(): void {
  ipcMain.removeHandler("sandbox:create");
  ipcMain.removeHandler("sandbox:destroy");
  // ...
}

// 建议: 错误码使用枚举类型
function handleError(error: unknown, operation: string): {
  success: false;
  error: string;
  code?: SandboxErrorCode;
} {
  // ...
}
```

---

## 3. 发现的问题汇总

### 3.1 安全漏洞 (🔴 高优先级)

| # | 问题 | 文件 | 风险 |
|---|------|------|------|
| 1 | Docker 命令注入漏洞 | DockerSandbox.ts | 攻击者可通过构造镜像名执行任意命令 |
| 2 | 危险命令检测可绕过 | PermissionManager.ts | 大小写、空白字符可绕过检测 |
| 3 | 敏感路径检测逻辑错误 | PermissionManager.ts | `/etc/` 路径检测失效 |

### 3.2 功能缺陷 (🟡 中优先级)

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 4 | 路径规范化使用 toLowerCase | SandboxManager.ts | 可能导致路径匹配错误 |
| 5 | 权限请求超时后监听器泄漏 | PermissionManager.ts | 内存泄漏 |
| 6 | 工作区 ID 生成可能冲突 | SandboxManager.ts | 高并发下可能产生重复 ID |
| 7 | 文件操作未通过容器 | DockerSandbox.ts | 可能绕过沙箱隔离 |

### 3.3 代码质量 (🟢 低优先级)

| # | 问题 | 文件 | 影响 |
|---|------|------|------|
| 8 | 重复代码（路径验证、isPathPermission） | 多文件 | 维护成本 |
| 9 | 硬编码超时值 | 多文件 | 可配置性差 |
| 10 | 缺少持久化存储 | 全局 | 应用重启后状态丢失 |

---

## 4. 改进建议

### 4.1 架构层面

1. **添加持久化层**
   - 使用 SQLite 存储工作区状态
   - 记录权限审批历史
   - 支持应用重启后恢复

2. **添加 WSL 和 Firejail 实现**
   - 当前只有 DockerSandbox 实现
   - WSL 实现 Windows 平台支持
   - Firejail 实现 Linux 轻量级沙箱

3. **添加指标收集**
   - 执行时间统计
   - 资源使用监控
   - 错误率追踪

### 4.2 安全层面

1. **增强命令验证**
   ```typescript
   // 使用白名单 + 参数解析
   const ALLOWED_COMMANDS = new Set(['node', 'npm', 'git', ...]);
   const parsed = parseCommand(command);
   if (!ALLOWED_COMMANDS.has(parsed.name)) {
     throw new PermissionError(...);
   }
   ```

2. **路径遍历防护**
   ```typescript
   // 解析并验证真实路径
   const realPath = fs.realpathSync(path);
   if (!realPath.startsWith(workspaceRoot)) {
     throw new PermissionError(...);
   }
   ```

3. **资源限制**
   ```typescript
   // 添加磁盘配额检查
   async checkDiskQuota(workspace: Workspace): Promise<boolean> {
     const usage = await this.getDiskUsage(workspace.rootPath);
     return usage < parseSize(workspace.sandboxConfig.diskQuota || '10g');
   }
   ```

### 4.3 代码层面

1. **统一日志**
   ```typescript
   // 替换所有 console.error 为 log.error
   ```

2. **提取共享工具**
   ```typescript
   // 创建 src/shared/utils/pathUtils.ts
   export function normalizePath(path: string): string { ... }
   export function isPathPermission(type: PermissionType): boolean { ... }
   ```

3. **添加配置常量**
   ```typescript
   // src/shared/constants/sandbox.ts
   export const PERMISSION_TIMEOUT = 60000;
   export const DEFAULT_MEMORY_LIMIT = '2g';
   export const WORKSPACE_ID_PREFIX = 'workspace-';
   ```

---

## 5. 优先修复项

### P0 - 立即修复（安全漏洞）

1. **修复 Docker 命令注入**
   - 文件: `DockerSandbox.ts`
   - 使用 `spawn` 替代字符串拼接
   - 添加镜像名验证

2. **修复危险命令检测绕过**
   - 文件: `PermissionManager.ts`
   - 规范化命令（去除空白、转小写）
   - 使用正则表达式边界匹配

3. **修复敏感路径检测**
   - 文件: `PermissionManager.ts`
   - 修复 `/etc/` 路径检测逻辑

### P1 - 尽快修复（功能缺陷）

4. **修复路径规范化**
   - 文件: `SandboxManager.ts`
   - 移除 `toLowerCase()` 调用

5. **修复监听器泄漏**
   - 文件: `PermissionManager.ts`
   - 超时后移除事件监听器

6. **改进工作区 ID 生成**
   - 文件: `SandboxManager.ts`
   - 使用 UUID 或加密随机数

### P2 - 计划修复（代码质量）

7. **提取共享工具函数**
8. **统一日志使用**
9. **添加配置常量**
10. **添加单元测试**

---

## 6. 与 Harness 架构对齐检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| CP1 任务确认 | ✅ | 有参数验证 |
| CP2 规划分解 | ⚠️ | 部分实现，缺少显式的规划阶段 |
| CP3 执行实现 | ✅ | 完整实现 |
| CP4 质量门禁 | ⚠️ | 类型定义存在，但未实现门禁逻辑 |
| CP5 审查完成 | ⚠️ | 有 metrics 类型，但未实现收集 |

**建议**: 在 WorkspaceManager 中添加显式的 CP 工作流支持，包括：
- 门禁检查机制
- 指标收集
- 状态持久化

---

## 7. 测试建议

### 7.1 单元测试

```typescript
// 测试危险命令检测
describe('PermissionManager.checkDangerousOperation', () => {
  it('should detect dangerous commands regardless of case', () => {
    expect(pm.checkDangerousOperation('command:execute', 'SUDO rm -rf /')).toBe(true);
    expect(pm.checkDangerousOperation('command:execute', 'sUdO ls')).toBe(true);
  });

  it('should detect commands with extra whitespace', () => {
    expect(pm.checkDangerousOperation('command:execute', 'sudo  rm -rf /')).toBe(true);
  });
});

// 测试路径验证
describe('SandboxManager.validatePathInWorkspace', () => {
  it('should reject paths outside workspace', () => {
    expect(() => sm.validatePathInWorkspace(workspace, '/etc/passwd')).toThrow();
  });

  it('should handle path traversal attempts', () => {
    expect(() => sm.validatePathInWorkspace(workspace, '../etc/passwd')).toThrow();
  });
});
```

### 7.2 集成测试

```typescript
describe('DockerSandbox Integration', () => {
  it('should create and destroy workspace', async () => {
    const sandbox = new DockerSandbox(config);
    await sandbox.init();
    const workspace = await sandbox.createWorkspace('test-session');
    expect(workspace).toBeDefined();
    await sandbox.destroyWorkspace('test-session');
  });

  it('should execute commands in container', async () => {
    const result = await sandbox.execute('test-session', 'echo', ['hello']);
    expect(result.stdout.trim()).toBe('hello');
  });
});
```

---

## 8. 结论

沙箱实现代码整体架构合理，类型定义完整，错误处理得当。但存在若干安全漏洞需要立即修复，特别是命令注入和危险命令检测绕过问题。建议按优先级修复问题，并补充单元测试和集成测试。

**下一步行动**:
1. 修复 P0 安全漏洞
2. 添加单元测试
3. 实现 WSL/Firejail 支持
4. 添加持久化存储

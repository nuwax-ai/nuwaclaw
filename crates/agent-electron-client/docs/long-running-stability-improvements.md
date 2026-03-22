# Electron 客户端长期运行稳定性改进

> 日期: 2026-03-18
> 分支: feature/electron-client-0.9

## 背景

NuwaClaw 是长期运行的桌面应用（可能持续运行数天/数周）。经过全面代码审查，发现若干资源泄漏、定时器未清理、进程清理不完整等问题，以及网络不稳定时超时过于激进的问题。本次优化共 13 项改动，新增 21 个测试用例。

---

## 第一部分：资源泄漏修复（6 项）

### 1. Event Forwarders 监听器泄漏修复

**文件**: `src/main/ipc/eventForwarders.ts`

**问题**: 21 个监听器注册在 agentService 上，永不清理。关闭窗口后旧闭包仍引用已销毁的 window。

**修复**:
- 新增模块级 `registeredHandlers[]` 数组，存储每个 `{ event, handler }` 对
- 导出 `unregisterEventForwarders()`，遍历调用 `agentService.off(event, fn)` 精确移除
- `registerEventForwarders()` 开头先调用 `unregisterEventForwarders()` 保证幂等

### 2. 将 unregister 接入 cleanupAllProcesses

**文件**: `src/main/main.ts`

**修复**: 在 `cleanupAllProcesses()` 中、`agentService.destroy()` 之前调用 `unregisterEventForwarders()`，确保应用退出时所有事件监听器被清理。

### 3. ProcessManager.stop() 补齐 removeAllListeners

**文件**: `src/main/processManager.ts`

**问题**: `kill()` 和 `stopAsync()` 都正确移除了 stdout/stderr/stdin 监听器，但 `stop()` 没有。Windows 上可能导致句柄无法释放。

**修复**: 在 `stop()` 中 `proc.kill()` 之前加上对 stdout/stderr/stdin/proc 的 `removeAllListeners()`。

### 4. SSE heartbeat 增加 error 事件清理

**文件**: `src/main/services/computerServer.ts`

**问题**: heartbeat interval 仅在 `req.on('close')` 时清理。若 response 流出错但 close 未触发，interval 泄漏。

**修复**: 添加 `res.on('error', () => { clearInterval(heartbeat); })`。

### 5. MemoryFileSync destroy 竞态修复

**文件**: `src/main/services/memory/MemoryFileSync.ts`

**问题**: `destroy()` 调用顺序可能导致异步 `processPendingSync` 访问已清理资源。

**修复**:
- 调整顺序：先设 `this.initialized = false`，再 `clearAllTimers()`，最后 `stopWatcher()`
- 在 `processPendingSync()` 开头增加 `if (!this.initialized) return;` 守卫

### 6. PermissionsPage 定时器泄漏修复

**文件**: `src/renderer/components/pages/PermissionsPage.tsx`

**问题**: click handler 内创建 `setInterval` + `setTimeout`，组件卸载前不会清理。快速点击会导致定时器叠加。

**修复**: 用 `useRef` 存储定时器引用，`useCallback` 封装清理函数，`useEffect` return 中清理。新定时器创建前先清除旧定时器。

---

## 第二部分：超时与网络容忍度提升（7 项）

所有超时常量已集中到 `src/shared/constants.ts` 统一管理。

### 7. 集中超时常量调整

**文件**: `src/shared/constants.ts`

| 常量 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `DEFAULT_API_TIMEOUT` | 30s | 60s | 弱网环境下 30s 可能不够 |
| `DEFAULT_SSE_RETRY_DELAY` | 3s | 5s | 初始重试间隔过短，弱网下频繁重连 |
| `DEFAULT_SSE_MAX_RETRY_DELAY` | 30s | 60s | 持续断网时应更慢退避 |

### 8. 退出清理超时增加

| 常量 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `CLEANUP_TIMEOUT` | 5s | 15s | 多引擎 + 多 MCP 服务器 + memory extraction 可能超过 5 秒 |

**文件**: `src/main/main.ts` — 引用 `CLEANUP_TIMEOUT` 常量替代内联硬编码。

### 9. 进程 SIGTERM→SIGKILL 升级超时增加

| 常量 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `PROCESS_KILL_ESCALATION_TIMEOUT` | 3s | 5s | 进程若在做网络 I/O 清理可能不够 |

**文件**: `src/main/processManager.ts` — 引用常量替代内联硬编码。

### 10. ACP 会话取消超时增加

| 常量 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `ACP_ABORT_TIMEOUT` | 10s | 15s | 弱网时 ACP 二进制响应取消命令可能更慢 |

**文件**: `src/main/services/engines/acp/acpEngine.ts` — 引用常量替代内联 `ABORT_TIMEOUT_MS`。

### 11. 引擎销毁超时增加

| 常量 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `ENGINE_DESTROY_TIMEOUT` | 10s | 20s | 多个 MCP 服务器关闭 + 进程清理可能需要更多时间 |

**文件**: `src/main/services/engines/unifiedAgent.ts` — 引用常量替代内联硬编码。

### 12. SSE 心跳间隔放宽

| 常量 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `DEFAULT_SSE_HEARTBEAT_INTERVAL` | 15s | 30s | 弱网时可能在短暂中断期间丢失连接 |

**文件**: `src/main/services/computerServer.ts` — 引用常量替代内联硬编码。

### 13. 依赖同步添加超时

| 常量 | 新增值 | 原因 |
|------|--------|------|
| `DEPS_SYNC_TIMEOUT` | 120s | 网络异常时 `syncInitDependencies()` 可能永久挂起 |

**文件**: `src/main/bootstrap/startup.ts` — 用 `Promise.race` 包装 120 秒超时，超时后设 `_depsSyncInProgress = false` 并通知 renderer。定时器通过 `.finally()` 正确清理。

---

## 超时常量一览

所有超时常量集中在 `src/shared/constants.ts`：

```typescript
// API & SSE
DEFAULT_API_TIMEOUT          = 60_000   // API 请求超时
DEFAULT_SSE_RETRY_DELAY      = 5_000    // SSE 初始重试延迟
DEFAULT_SSE_MAX_RETRY_DELAY  = 60_000   // SSE 最大重试延迟
DEFAULT_SSE_HEARTBEAT_INTERVAL = 30_000 // SSE 心跳间隔

// 进程生命周期
DEFAULT_STARTUP_DELAY              = 3_000   // 进程启动延迟
CLEANUP_TIMEOUT                    = 15_000  // 应用退出清理超时
PROCESS_KILL_ESCALATION_TIMEOUT    = 5_000   // SIGTERM→SIGKILL 升级超时

// 引擎 & ACP
ACP_ABORT_TIMEOUT            = 15_000   // ACP 会话取消超时
ENGINE_DESTROY_TIMEOUT       = 20_000   // 引擎销毁超时

// 依赖管理
DEPS_SYNC_TIMEOUT            = 120_000  // 依赖同步超时
```

**约束关系**:
- `PROCESS_KILL_ESCALATION_TIMEOUT < CLEANUP_TIMEOUT`
- `ACP_ABORT_TIMEOUT ≤ ENGINE_DESTROY_TIMEOUT`
- `DEPS_SYNC_TIMEOUT > ENGINE_DESTROY_TIMEOUT > CLEANUP_TIMEOUT`

---

## 测试覆盖

新增 3 个测试文件，共 21 个测试用例：

| 文件 | 用例数 | 覆盖内容 |
|------|--------|----------|
| `src/main/ipc/eventForwarders.test.ts` | 8 | 监听器注册/注销、幂等性、事件转发、注销后静默 |
| `src/main/processManager.test.ts` | 7 | stop() 清理、null-before-kill 顺序、SIGKILL 升级时序、定时器取消 |
| `src/main/services/memory/MemoryFileSync.test.ts` | 3 | destroy 顺序、processPendingSync 守卫、destroy 后 debounce 不触发 |
| `src/shared/constants.test.ts` | +5 | 超时约束关系断言 |

全量测试：**470/470 通过**，构建无错误。

---

## 已有的良好实践（保持不变）

- ProcessRegistry 孤儿进程检测
- 日志轮转（按天 + 按大小，7/30 天 TTL）
- SSE 事件缓冲（max 50, 30s TTL）
- SIGTERM→SIGKILL 升级
- SQLite 状态持久化
- ServiceManager 服务启动顺序编排

---

## 变更文件清单

| 文件 | 类型 |
|------|------|
| `src/shared/constants.ts` | 修改 — 新增 6 个超时常量，调整 3 个现有值 |
| `src/main/ipc/eventForwarders.ts` | 修改 — 监听器生命周期管理 |
| `src/main/main.ts` | 修改 — 清理流程集成、引用常量 |
| `src/main/processManager.ts` | 修改 — stop() 补齐监听器清理、引用常量 |
| `src/main/services/computerServer.ts` | 修改 — SSE error 清理、引用常量 |
| `src/main/services/memory/MemoryFileSync.ts` | 修改 — destroy 竞态修复 |
| `src/renderer/components/pages/PermissionsPage.tsx` | 修改 — 定时器泄漏修复 |
| `src/main/services/engines/acp/acpEngine.ts` | 修改 — 引用常量 |
| `src/main/services/engines/unifiedAgent.ts` | 修改 — 引用常量 |
| `src/main/bootstrap/startup.ts` | 修改 — 依赖同步超时 |
| `src/main/ipc/eventForwarders.test.ts` | 新增 |
| `src/main/processManager.test.ts` | 新增 |
| `src/main/services/memory/MemoryFileSync.test.ts` | 新增 |
| `src/shared/constants.test.ts` | 修改 — 新增断言 |
| `src/main/services/engines/acp/acpEngine.test.ts` | 修改 — 适配新超时值 |

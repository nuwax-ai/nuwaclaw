# ACP Terminal API 沙箱化方案

> 版本: 1.3.0 | 日期: 2026-04-10 | 状态: 已实现

## 问题背景

Windows 受限 token (Restricted Token) 沙箱无法在受限进程内创建子进程（EPERM），
而 ACP 引擎（claude-code-acp-ts、nuwaxcode）需要 spawn 子进程来执行 bash 命令和 MCP 服务器。
进程级沙箱化（`serve` 模式）在 Windows 上不可行。

## Deep Research 关键发现

### claude-code-acp-ts 使用 ACP Terminal API

**claude-code-acp-ts 的 bash 工具通过 ACP `terminal/create` 协议方法执行命令**，
而非直接使用 Node.js `child_process`。

源码证据（`~/.nuwaclaw/node_modules/claude-code-acp-ts/dist/mcp-server.js:424-432`）：

```javascript
if (!agent.clientCapabilities?.terminal || !agent.client.createTerminal) {
    throw new Error("unreachable");
}
const handle = await agent.client.createTerminal({
    command: input.command,
    env: [{ name: "CLAUDECODE", value: "1" }],
    sessionId,
    outputByteLimit: 32000,
});
```

### nuwaxcode 使用内部 bash 执行

nuwaxcode（基于 opencode）不使用 Terminal API，而是内部直接执行 bash 命令。
通过 `OPENCODE_CONFIG_CONTENT.sandbox` 配置实现逐命令沙箱化（已在之前 PR 中实现）。

### 结论

| 引擎 | Bash 执行方式 | 沙箱化方案 |
|------|-------------|-----------|
| claude-code | ACP `terminal/create` | Client 端 Terminal Manager + helper.exe |
| nuwaxcode | 内部 child_process | `OPENCODE_CONFIG_CONTENT.sandbox` |

## 方案设计

### 架构

```
┌─────────────────────────────────────────────────────────┐
│ Electron Client (AcpEngine)                              │
│                                                          │
│  clientCapabilities: { terminal: true }                  │
│                                                          │
│  buildClientHandler():                                   │
│    ├─ sessionUpdate ──→ handleAcpSessionUpdate()         │
│    ├─ requestPermission ──→ handlePermissionRequest()    │
│    │                      └─ strictPermissionGuard.ts     │
│    └─ ...terminalManager.getClientHandlers()             │
│         ├─ createTerminal  → helper.exe run / direct     │
│         ├─ terminalOutput  → output buffer               │
│         ├─ waitForExit     → exit promise                │
│         ├─ killTerminal    → process.kill()              │
│         └─ releaseTerminal → cleanup                     │
│                                                          │
│  nuwaxcode: OPENCODE_CONFIG_CONTENT.sandbox (独立路径)    │
└─────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  claude-code-acp-ts               nuwaxcode acp
  (terminal/create)                (internal bash)
```

### ACP Terminal API 协议

| 方法 | 方向 | 说明 |
|------|------|------|
| `terminal/create` | Agent → Client | 创建终端，执行命令 |
| `terminal/output` | Agent → Client | 获取当前输出 |
| `terminal/wait_for_exit` | Agent → Client | 等待命令完成 |
| `terminal/kill` | Agent → Client | 终止命令 |
| `terminal/release` | Agent → Client | 释放资源 |

Agent 必须检查 `clientCapabilities.terminal === true` 才能使用。

### 执行流程 (claude-code on Windows)

1. Agent 调用 `terminal/create` 发送命令（如 `npm test`）
2. `AcpTerminalManager.createTerminal()` 接收请求
3. Windows 下：通过 `SandboxInvoker.buildInvocation()` 构建包装命令
   ```
   nuwax-sandbox-helper.exe run --mode read-only --cwd <cwd> --policy-json {...} -- npm test
   ```
4. macOS/Linux 下：直接 `spawn(command, args)`
5. 返回 `terminalId` 给 Agent
6. Agent 调用 `terminal/output` 获取输出（从 buffer 读取）
7. Agent 调用 `terminal/wait_for_exit` 等待完成
8. Agent 调用 `terminal/release` 释放资源

### Sandbox Helper JSON 输出

`nuwax-sandbox-helper.exe run` 返回 JSON：
```json
{
  "exit_code": 0,
  "stdout": "test output...",
  "stderr": "",
  "timed_out": false
}
```

`AcpTerminalManager` 解析此 JSON，提取 `stdout` + `stderr` 放入 output buffer。

## 变更文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `acpTerminalManager.ts` | **新建** | Terminal 生命周期管理，sandbox 路由 |
| `acpClient.ts` | 修改 | 扩展 `AcpClientHandler` 接口，添加 5 个 Terminal 方法 |
| `acpEngine.ts` | 修改 | Terminal Manager 初始化、capabilities 声明、handler 委托、strict 权限调试日志 |
| `strictPermissionGuard.ts` | **新建** | nuwaxcode strict 模式下写入路径判定（workspace/temp/appData） |
| `engineWarmup.ts` | 修改 | warmup 复用增加 sandbox policy 指纹兼容检查 |
| `sandboxPolicyFingerprint.ts` | **新建** | sandbox policy 稳定指纹生成（warmup 兼容判定） |
| `policyCache.ts` | **新建** | 缓存当前 sandbox policy（供 warmup 复用判定读取） |
| `unifiedAgent.ts` | 修改 | 向 warmup 注入 sandbox policy 指纹提供器 |

### 不变的文件

| 文件 | 原因 |
|------|------|
| `SandboxInvoker.ts` | 已有 `buildInvocation()` 支持 `subcommand: "run"` |
| `windows-sandbox-helper/main.rs` | `run` 模式已可用 |
| `sandboxProcessWrapper.ts` | 仍用于 nuwaxcode env-var 注入 |
| `policy.ts` | 沙箱策略解析不变 |

## 关键设计决策

### 1. getClientHandlers() 模式

`AcpTerminalManager` 提供 `getClientHandlers()` 方法返回 handler 对象，
`acpEngine.ts` 通过 spread 操作符注入：

```typescript
private buildClientHandler(): AcpClientHandler {
  return {
    sessionUpdate: ...,
    requestPermission: ...,
    // 一行注入所有 terminal handlers
    ...(this.terminalManager?.getClientHandlers() ?? {}),
  };
}
```

**优点**：减少代码侵入，terminal 逻辑完全封装在 manager 中。

### 2. JSON 解析 vs 直接输出

Windows sandbox helper `run` 模式返回 JSON 封装的输出。
`AcpTerminalManager` 在 `spawnProcess()` 中区分两种模式：
- `parseJson=true`（Windows sandbox）：收集完整 JSON，解析后提取 stdout/stderr
- `parseJson=false`（直接执行）：实时流式收集 stdout/stderr

### 3. outputByteLimit

遵循 ACP 规范：当输出超过 `outputByteLimit` 时，从开头截断保留最新输出。
标记 `truncated: true` 以通知 Agent。

> **注意**：当前实现使用 `string.length` 而非字节数。对于 ASCII 输出两者一致，
> 对于 CJK 多字节字符，`string.length`（UTF-16 code units）可能小于实际字节数。
> 实际影响有限，因为 claude-code 设置 `outputByteLimit: 32000`。

### 4. 沙箱参数来源

`writablePaths`、`networkEnabled` 和 `mode` 从 sandbox 配置传入，而非硬编码：

```typescript
this.terminalManager = new AcpTerminalManager({
  windowsSandboxHelperPath: sandboxConfig.windowsSandboxHelperPath,
  windowsSandboxMode: sandboxConfig.windowsSandboxMode,
  networkEnabled: sandboxConfig.networkEnabled ?? true,
  writablePaths: sandboxConfig.projectWorkspaceDir
    ? [sandboxConfig.projectWorkspaceDir]
    : [],
  mode: sandboxConfig.mode,
});
```

`createTerminal` 时还会自动追加 `cwd` 到可写路径。

### 5. 竞态防护

Terminal 在 spawn 之前注册到 Map，避免快速退出的进程导致 "Terminal not found" 错误：

```typescript
// 注册在前，spawn 在后
this.terminals.set(terminalId, session);
this.spawnProcess(session, ...);
```

### 6. 会话级终端清理

当 `abortSession()` 取消会话时，自动终止该会话关联的所有终端进程：

```typescript
if (this.terminalManager) {
  await this.terminalManager.releaseForSession(sessionId);
}
```

`releaseForSession()` 遍历所有 terminal，按 sessionId 过滤后逐一 kill + release。

### 7. 并发限制

默认最多 50 个并发终端，防止失控的 Agent 耗尽系统资源：

```typescript
private static readonly MAX_CONCURRENT = 50;

async createTerminal(...) {
  if (this.terminals.size >= AcpTerminalManager.MAX_CONCURRENT) {
    throw new Error(
      `Terminal limit reached (${AcpTerminalManager.MAX_CONCURRENT}). Release existing terminals first.`
    );
  }
  // ...
}
```

## 与现有系统的关系

### macOS/Linux 进程级沙箱

在 macOS/Linux 上，ACP 引擎进程仍通过 seatbelt/bwrap 进行进程级沙箱化。
Terminal API 执行的命令也在此沙箱内运行，无需额外包装。

### nuwaxcode env-var 沙箱

nuwaxcode 不使用 Terminal API，其 bash 执行通过 `OPENCODE_CONFIG_CONTENT.sandbox`
配置路由到 sandbox helper。这是独立的代码路径，不受 Terminal API 实现影响。

另外，在 `strict` 模式下，`nuwaxcode` 的 ACP `requestPermission` 路径会额外经过
`strictPermissionGuard.ts`：
- 仅识别写入类请求应用路径门控（非写入请求跳过）
- 允许写入根目录：`workspace` + `temp(TMP/TEMP/TMPDIR)` + `appData(~/.nuwaclaw)` + `isolatedHome/tmp`
- 路径缺失时 fail-closed（拒绝）
- 写入类权限仅选择 `allow_once`（不走 `allow_always`）

同时，`nuwaxcode` warmup 复用现在对 sandbox policy 变更敏感：
- warmup 启动时记录 `NUWAX_AGENT_WARMUP_SANDBOX_POLICY_FP`
- 复用前比对当前 policy 指纹
- 旧 warmup 缺少该标记或指纹不一致时，立即放弃复用并冷启动
- 确保 sandbox mode/policy 配置修改后对“下一次新会话”立即生效

## 验证步骤

1. 启动 Electron 开发模式
2. 使用 claude-code 引擎发送包含 bash 命令的 prompt
3. 检查日志中 `createTerminal` 调用（而非 EPERM 错误）
4. 确认 Windows 下命令通过 `nuwax-sandbox-helper.exe run` 执行
5. 确认 `terminalOutput` 返回正确输出
6. 确认 `waitForExit` 返回正确退出码
7. 确认 nuwaxcode 行为不受影响
8. 确认 macOS/Linux 沙箱行为不受影响
9. 验证 abort 后终端进程被正确清理
10. 验证并发超过 50 时抛出限制错误
11. （nuwaxcode + strict）验证 ACP 调试日志：
    - `strict writable roots snapshot`（每个 session 一次）
    - `strict permission evaluation`
    - `strict permission skipped (non-write request)`
    - `strict write permission blocked`
    - `strict write permission allowed_once`
12. （warmup）验证 sandbox policy 相关调试日志：
    - `warmup sandbox policy snapshot`
    - `warmup sandbox policy compatibility check`
    - 发生策略变更时出现：`Sandbox policy changed, skipping warmup reuse`

## 安全注意事项

### SandboxMode 对 Windows per-command 的影响

`SandboxMode`（strict / compat / permissive）现在影响 Windows per-command 沙箱行为：

| Mode | `writable_roots` | Token 限制 | 适用场景 |
|------|-----------------|-----------|---------|
| **strict** | 仅限项目 workspace（排除 cwd 等额外路径） | WRITE_RESTRICTED 保持启用 | 最小化写入面 |
| **compat**（默认） | 全部传入路径（workspace + cwd） | WRITE_RESTRICTED 保持启用 | 兼容性优先 |
| **permissive** | 全部传入路径 | `--no-write-restricted` 放松 token（仅 `run` 子命令） | 排障用途 |

注意：`--no-write-restricted` 仅对 `run` 子命令有效。`serve` 子命令在 Rust helper 中
已硬编码 `write_restricted=false`（子进程需要 spawn 孙进程）。

> 对 `nuwaxcode` 来说，strict 下除了 helper 的 `writable_roots` 外，ACP 权限层还会执行
> `strictPermissionGuard` 二次门控（写入路径必须落在 workspace/temp/appData）。

### macOS/Linux 上的 per-command 沙箱

当前 `AcpTerminalManager` 仅在 Windows 上启用 per-command 沙箱包装。
macOS/Linux 上 terminal 命令直接执行（进程级沙箱由 seatbelt/bwrap 在引擎级别提供）。

### 跨平台 SandboxMode 差异

| 平台 | strict | compat | permissive |
|------|--------|--------|-----------|
| Linux (bwrap) | 最小 ro-bind（`/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc`, `/opt`, `/usr/local`） | 全局 ro-bind `/` | 完整 rw bind，无 namespace 隔离 |
| macOS (seatbelt) | 仅命令本身在 exec allowlist | 命令 + startup chain 在 exec allowlist | 全局 file-write + unrestricted process-exec |
| Windows (helper) | `writable_roots` 仅首个路径 | 全部 `writable_roots` | 全部 `writable_roots` + `--no-write-restricted` |

### Windows 非 sandbox 路径的 shell 注入

当 sandbox 未启用且平台为 Windows 时，`spawnProcess` 使用 `shell: true`。
如果 Agent 发送的命令包含 shell 元字符，它们会被解释。
安全边界在 sandbox helper 级别（受限 token），sandbox 未启用时命令以用户权限运行。

### 无命令白名单/黑名单

Terminal Manager 执行 Agent 发送的所有命令，安全边界在 sandbox helper 级别。
如果 sandbox 不可用，命令以完整用户权限运行。

## 参考

- [ACP Terminal API 规范](https://agentclientprotocol.com/protocol/terminals)
- [ACP SDK 源码](node_modules/@agentclientprotocol/sdk/dist/acp.js)
- [Codex Windows Sandbox](https://github.com/openai/codex) — 参考架构
- [windows-sandbox-helper](../../crates/windows-sandbox-helper/src/main.rs) — Rust helper 源码

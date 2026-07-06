# macOS Seatbelt Strict 模式下 ACP 引擎工具调用 EPERM 修复

> 日期: 2026-04-09
> 状态: 已修复（三轮迭代）
> 影响范围: macOS + seatbelt strict/compat 模式下的 ACP 引擎（claude-code / nuwaxcode）
> 跨平台: macOS / Linux / Windows 均已处理

---

## 1. 问题描述

在 macOS 上，ACP 引擎被 seatbelt 沙箱以 `strict` 模式包裹后，所有需要 spawn 子进程的工具（Bash、Glob 等）因 `EPERM` 失败，无法正常执行。同时引擎无法写入应用数据目录（`~/.nuwaclaw`），导致日志、npm 包等不可用。

### 1.1 claude-code 引擎

```
EPERM: operation not permitted, mkdir '/private/tmp/claude-501/-Users-apple-Downloads-test-electron-client-computer-project-workspace-1746495851-1544430'
```

claude-code 内部 Bash 工具使用**硬编码的** `/private/tmp/claude-{uid}/` 路径（不是 `os.tmpdir()`），不在 seatbelt profile 的 writablePaths 中。

### 1.2 nuwaxcode 引擎

```
EPERM: operation not permitted, posix_spawn '/var/folders/.../nuwaclaw-acp-xxx/.local/share/nuwaxcode/bin/rg'
```

nuwaxcode 内部需要执行 `rg`（ripgrep）实现文件搜索工具，但 strict 模式下 `startupExecAllowlist` 未生效，`rg` 不在 exec allow 中。

### 1.3 应用数据目录不可写

strict 模式下 writablePaths 不包含 `~/.nuwaclaw`，引擎无法：
- 写日志到 `~/.nuwaclaw/logs/`
- 访问 `~/.nuwaclaw/node_modules/` 中的 npm 包
- 读写引擎配置缓存

### 1.4 Windows strict 模式限制

Windows sandbox helper 的 strict 模式只取 `writablePaths[0]`（工作区），忽略了应用数据目录、isolatedHome、临时目录等必要路径。

### 1.5 复现步骤

1. 启动 NuwaClaw 桌面客户端，创建 ACP 会话（sandbox mode = strict）
2. 发送提示词："运行 pwd 显示当前工作目录" 或 "运行 node -e ..."
3. agent 尝试执行 Bash/Glob 工具 → EPERM

---

## 2. 根因分析

### 2.1 Seatbelt Profile 两个限制

**限制 1：写入权限不足**

strict 模式的 seatbelt profile，writablePaths 仅包含：

| 路径 | 来源 |
|------|------|
| `{projectWorkspaceDir}` | 用户工作区 |
| `{isolatedHome}` | 引擎隔离 HOME |

缺少系统临时目录（`/private/tmp/` 等）。

**限制 2：执行权限不足**

strict 模式下，`SandboxInvoker.buildSeatbeltProfile()` 中 `startupExecAllowlist` 只在 compat 模式使用（原 line 442-443）。strict 模式只允许执行：
- `/usr/bin/*`, `/bin/*`, `/usr/lib/*` — 系统路径
- `{command}` — 引擎主二进制（如 node / nuwaxcode）

引擎内部二进制（如 isolatedHome 下的 `rg`）不在允许列表中。

### 2.2 失败工具调用清单（同一会话，共 5 次）

| Tool Call ID | 工具 | 命令 | 错误类型 |
|---|---|---|---|
| `call_0623c3816d9b47508f6ad079` | Bash | `pwd` | EPERM mkdir `/private/tmp/claude-501/...` |
| `call_2277b5404d0c455da0db355b` | Bash | `pwd` | EPERM mkdir `/private/tmp/claude-501/...` |
| `call_3400c1f44b76412e9bc0b258` | Bash | `echo $PWD` | EPERM mkdir `/private/tmp/claude-501/...` |
| `call_d44e1ea2a9c14d1fb200c6d9` | Glob | `*` | `spawn EPERM` |
| `call_b60209d94ce34affb3d032ec` | Bash | `ls -la` (含 `dangerouslyDisableSandbox:true`) | EPERM mkdir `/private/tmp/claude-501/...` |

注意：即使工具调用携带 `dangerouslyDisableSandbox: true`，依然失败。seatbelt 沙箱包裹的是整个引擎进程（进程级），不是单个工具调用。进程级的 seatbelt 限制无法被内部参数绕过。

---

## 3. 修复方案（三轮迭代）

### 3.1 第一轮：设置 TMPDIR 环境变量 → 失败

将 `TMPDIR`/`TEMP`/`TMP` 指向 `isolatedHome/tmp`。`isolatedHome/tmp/` 目录成功创建，但 claude-code 内部 Bash 工具不读取 `TMPDIR`，仍使用硬编码的 `/private/tmp/claude-{uid}/`。

**结论：TMPDIR 方案对 claude-code 无效。**（该代码保留 — 对其他场景仍有价值。）

### 3.2 第二轮：添加 `/private/tmp/claude-{uid}/` → 部分有效

将引擎特定的 `/private/tmp/claude-{uid}/` 加入 writablePaths。修复了 claude-code 的写入问题，但：
- 路径是引擎特定（claude-），不统一
- 没有覆盖 nuwaxcode 的 `rg` 执行问题
- 没有跨平台考虑

### 3.3 第三轮（最终方案）：统一跨平台修复

**四个改动，统一适用于所有引擎和所有平台：**

#### 改动 1：跨平台系统临时目录加入 writablePaths

**文件**: `acpClient.ts`

```typescript
const extraWritable: string[] = [isolatedHome, os.tmpdir()];
try {
  extraWritable.push(fs.realpathSync(os.tmpdir()));
} catch { /* skip */ }
if (process.platform === "darwin") {
  extraWritable.push("/tmp", "/private/tmp");
}
```

| 平台 | 添加的路径 |
|------|-----------|
| **macOS** | `os.tmpdir()` (`/var/folders/.../T`) + realpath + `/tmp` + `/private/tmp` |
| **Linux** | `os.tmpdir()` (`/tmp`) + realpath |
| **Windows** | `os.tmpdir()` (`C:\Users\...\AppData\Local\Temp`) + realpath |

所有引擎统一使用同一套路径，无引擎特定逻辑。

#### 改动 1b：应用数据目录加入 writablePaths

**文件**: `acpClient.ts`

```typescript
// App data directory (e.g. ~/.nuwaclaw) — engine writes logs, npm packages, etc.
const appDataDir = path.join(app.getPath("home"), APP_DATA_DIR_NAME);
extraWritable.push(appDataDir);
```

所有沙箱模式（strict / compat / permissive）和所有平台均可写入应用数据目录，引擎可正常写日志、访问 npm 包和配置缓存。

#### 改动 2：strict 模式也使用 startupExecAllowlist

**文件**: `SandboxInvoker.ts`

原代码中 `startupExecAllowlist` 只在 compat 模式生效。修改为 strict 和 compat 都使用：

```typescript
// Before: only compat used startupExecAllowlist
if (compat) {
  for (const p of startupExecAllowlist) execAllow.add(p);
}

// After: both strict and compat include engine-internal binaries
for (const p of startupExecAllowlist) execAllow.add(p);
```

#### 改动 3：writablePaths 自动添加 process-exec subpath 规则

**文件**: `SandboxInvoker.ts`

每个 writablePath 同时添加 `file-write*` 和 `process-exec` 的 subpath 规则：

```typescript
lines.push(`(allow file-write* (subpath "${p}"))`);
lines.push(`(allow process-exec (subpath "${p}"))`);
```

这解决了 nuwaxcode 的 `rg` 执行问题 — `rg` 位于 isolatedHome 内，isolatedHome 是 writablePath，现在也允许在其中执行二进制。

#### 改动 3b：Windows strict 模式使用完整 writablePaths

**文件**: `SandboxInvoker.ts`

Windows sandbox helper 的 strict 模式原来只取 `writablePaths[0]`（工作区），忽略了应用数据目录、isolatedHome、临时目录等。现在所有模式统一使用完整 `writablePaths`，不再区分 strict/compat：

```typescript
// Before:
if (sandboxMode === "strict") {
  sandboxPolicy.writable_roots = [params.writablePaths[0]!];
} else {
  sandboxPolicy.writable_roots = params.writablePaths;
}

// After:
sandboxPolicy.writable_roots = params.writablePaths;
```

### 3.4 修复后的 seatbelt profile（示例）

```seatbelt
(version 1)
(deny default)
(allow network*)
(allow file-read*)
(allow process-exec (regex #"^/usr/bin/"))
(allow process-exec (regex #"^/bin/"))
(allow process-exec (regex #"^/usr/lib/"))
(allow process-exec (literal ".../node"))          ; 引擎主二进制
(allow signal (target self))
(allow process-fork)
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix*)
(allow file-lock)
; writablePaths — 同时允许 file-write 和 process-exec
(allow file-write* (subpath "/Users/apple/project"))
(allow process-exec (subpath "/Users/apple/project"))
(allow file-write* (subpath ".../nuwaclaw-acp-xxx"))
(allow process-exec (subpath ".../nuwaclaw-acp-xxx"))  ; rg 等引擎内部二进制可执行
(allow file-write* (subpath "/Users/apple/.nuwaclaw"))
(allow process-exec (subpath "/Users/apple/.nuwaclaw"))  ; 应用数据目录（日志、npm 包等）
(allow file-write* (subpath "/var/folders/.../T"))
(allow file-write* (subpath "/private/tmp"))            ; claude-code Bash 工具
(allow process-exec (subpath "/private/tmp"))
(allow file-write* (subpath "/tmp"))
(allow process-exec (subpath "/tmp"))
(allow file-write* (literal "/dev/null"))
(allow file-write* (literal "/dev/dtracehelper"))
(allow file-write* (literal "/dev/urandom"))
```

---

## 4. 验证方式

1. 重新构建并启动 ACP 会话（strict 模式），发送 `pwd` → 应正常返回工作目录
2. 发送 `node -e "console.log('hello')"` → 应正常输出
3. 发送 `sandbox-testing-prompts.md` 中 A1 安全命令 → 全部正常执行
4. 确认 nuwaxcode 引擎也能正常执行 Glob/Grep 工具（`rg` 不再 EPERM）
5. 确认日志中 seatbelt profile 包含 `/private/tmp`、`process-exec (subpath isolatedHome)` 和 `~/.nuwaclaw`
6. 确认引擎可以写日志到 `~/.nuwaclaw/logs/`
7. 确认 compat/permissive 模式也正常工作
8. 确认 Windows strict 模式下引擎也能写日志和临时文件

---

## 5. 涉及文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `acpClient.ts` | 修改 | 跨平台系统临时目录 + 应用数据目录加入 extraWritablePaths |
| `SandboxInvoker.ts` | 修改 | strict 模式使用 startupExecAllowlist + writablePaths 添加 process-exec subpath + Windows strict 模式使用完整 writablePaths |
| `docs/sandbox-strict-tmpdir-fix.md` | 文档 | 本文档 |

---

## 6. 设计考量

### 为什么不直接去掉 ACP 引擎的 seatbelt 包裹

设计文档 (`sandbox-testing-prompts.md`) 提到 ACP 会话"不走 seatbelt"，但实际实现中 seatbelt 包裹是进程级安全隔离的重要层。通过修复 seatbelt profile 的路径和执行权限，可以在保留 seatbelt 保护的同时让引擎正常工作。工具级权限由 PermissionManager 管理。

### 为什么将 `/private/tmp/` 整体加入 writablePaths

- 引擎（claude-code）硬编码使用 `/private/tmp/claude-{uid}/`，无法通过 TMPDIR 重定向
- 未来其他引擎也可能使用系统临时目录
- 统一跨平台处理，避免引擎特定逻辑

---

## 7. Windows serve 模式 WRITE_RESTRICTED 修复（第四轮）

> 日期: 2026-04-09
> 状态: 已修复
> 影响范围: Windows strict/compat 模式下的 nuwaxcode 引擎

### 7.1 问题描述

前三轮修复后，nuwaxcode（opencode Go 二进制）的内部 `bash` 工具仍可写入 Desktop 等非工作区目录。Claude Code 引擎的 bash 通过 ACP Terminal API 已被正确沙箱化，但 nuwaxcode 的 bash 在内部执行，不经过 AcpTerminalManager。

### 7.2 根因

`nuwax-sandbox-helper.exe serve` 子命令硬编码 `write_restricted=false`（`main.rs:585`）。

没有 `WRITE_RESTRICTED` flag 和 restricting SIDs 时，Windows 访问检查不考虑 capability SID 的 DACL ACEs。结果：进程级沙箱提供**零写入保护**。

```
write_restricted=false → token: DISABLE_MAX_PRIVILEGE | LUA_TOKEN（无 restricting SIDs）
                       → add_allow_ace() / add_deny_write_ace() 对该 token 无效
                       → nuwaxcode bash 可写任意路径
```

### 7.3 修复方案

**原则**: 最小侵入，单一权威源。

#### 改动 1: Rust helper `serve` 子命令新增 `--write-restricted` flag

```rust
struct ServeArgs {
    common: CommonArgs,
    #[arg(long, default_value_t = false)]
    write_restricted: bool,
}
```

`write_restricted=true` 时，`create_restricted_token()` 添加：
- `WRITE_RESTRICTED` flag
- 3 个 restricting SIDs: capability SID + logon SID + everyone SID
- 只有带 ALLOW ACE 的路径可写

#### 改动 2: Policy JSON 新增 `sandbox_mode` 字段

```typescript
const sandboxPolicy = {
  type: "workspace-write",
  network_access: true,
  sandbox_mode: "strict",  // ← 新字段
  writable_roots: [...],
};
```

Rust `policy.rs` 的 `SandboxPolicy::WorkspaceWrite` 解析此字段，
`compute_allow_paths()` 根据它决定是否将 APPDATA/LOCALAPPDATA 加入 ALLOW ACEs。

#### 改动 3: SandboxInvoker 传递 `--write-restricted` 给 serve 模式

```typescript
if (subcommand === "serve" && sandboxMode !== "permissive") {
  helperArgs.push("--write-restricted");
}
```

#### 改动 4: acpEngine.ts 跨平台扩展

- 移除 `this.engineName === "claude-code"` 限制（两个引擎均受保护）
- 移除 `type === "windows-sandbox"` 限制（所有沙箱类型均受保护）
- sandboxed-fs MCP 和 disallowedTools 扩展到所有平台

### 7.4 修复后的行为

| Mode | serve 进程可写路径 | sandboxed-fs MCP |
|------|-------------------|-----------------|
| **strict** | workspace + TEMP/TMP（APPDATA 不可写） | 仅 workspace + TEMP/TMP |
| **compat** | workspace + TEMP/TMP + APPDATA/LOCALAPPDATA | workspace + TEMP/TMP + APPDATA |
| **permissive** | 无限制（WRITE_RESTRICTED=false） | 不注入 MCP |

### 7.5 涉及文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `crates/windows-sandbox-helper/src/main.rs` | 修改 | serve 子命令新增 `--write-restricted` flag |
| `crates/windows-sandbox-helper/src/policy.rs` | 修改 | `WorkspaceWrite` 新增 `sandbox_mode` 字段 |
| `crates/windows-sandbox-helper/src/allow.rs` | 修改 | strict 模式排除 APPDATA；compat/permissive 包含 |
| `SandboxInvoker.ts` | 修改 | 传递 `--write-restricted` + `sandbox_mode` 到 policy JSON |
| `sandboxProcessWrapper.ts` | 修改 | 移除冗余 APPDATA 添加（Rust 是单一权威源） |
| `acpEngine.ts` | 修改 | 跨平台/跨引擎扩展 sandboxed-fs MCP 和 disallowedTools |

### 7.6 设计决策

**为什么 Rust `compute_allow_paths()` 是 APPDATA 的单一权威源？**

之前 APPDATA 在 TypeScript（`sandboxProcessWrapper.ts`）和 Rust（`allow.rs`）两处添加，
导致 strict 模式下 TypeScript 总是添加 APPDATA，与 strict 语义矛盾。
现在统一由 Rust 根据 `sandbox_mode` 字段决定，TypeScript 只负责传递 `sandbox_mode`。

**为什么 strict 模式下 serve 进程的 APPDATA 不可写？**

strict 模式的目标是"最小写入面"。引擎基础设施日志写入通过 `isolatedHome`（TEMP 目录下）解决，
不依赖 APPDATA。sandboxed-fs MCP 对 AI agent 的文件写入做独立路径验证，
进程级和 MCP 级保护互不干扰。

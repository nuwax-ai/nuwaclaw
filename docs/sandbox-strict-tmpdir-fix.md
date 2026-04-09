# macOS Seatbelt Strict 模式下 ACP 引擎工具调用 EPERM 修复

> 日期: 2026-04-09
> 状态: 已修复（三轮迭代）
> 影响范围: macOS + seatbelt strict/compat 模式下的 ACP 引擎（claude-code / nuwaxcode）
> 跨平台: macOS / Linux / Windows 均已处理

---

## 1. 问题描述

在 macOS 上，ACP 引擎被 seatbelt 沙箱以 `strict` 模式包裹后，所有需要 spawn 子进程的工具（Bash、Glob 等）因 `EPERM` 失败，无法正常执行。

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

### 1.3 复现步骤

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

**三个改动，统一适用于所有引擎：**

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
5. 确认日志中 seatbelt profile 包含 `/private/tmp` 和 `process-exec (subpath isolatedHome)`
6. 确认 compat/permissive 模式也正常工作

---

## 5. 涉及文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `acpClient.ts` | 修改 | 跨平台系统临时目录加入 extraWritablePaths |
| `SandboxInvoker.ts` | 修改 | strict 模式使用 startupExecAllowlist + writablePaths 添加 process-exec subpath |
| `docs/sandbox-strict-tmpdir-fix.md` | 文档 | 本文档 |

---

## 6. 设计考量

### 为什么不直接去掉 ACP 引擎的 seatbelt 包裹

设计文档 (`sandbox-testing-prompts.md`) 提到 ACP 会话"不走 seatbelt"，但实际实现中 seatbelt 包裹是进程级安全隔离的重要层。通过修复 seatbelt profile 的路径和执行权限，可以在保留 seatbelt 保护的同时让引擎正常工作。工具级权限由 PermissionManager 管理。

### 为什么将 `/private/tmp/` 整体加入 writablePaths

- 引擎（claude-code）硬编码使用 `/private/tmp/claude-{uid}/`，无法通过 TMPDIR 重定向
- 未来其他引擎也可能使用系统临时目录
- 统一跨平台处理，避免引擎特定逻辑

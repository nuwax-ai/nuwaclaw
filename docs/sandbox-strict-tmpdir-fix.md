# macOS Seatbelt Strict 模式下 ACP 引擎工具调用 EPERM 修复

> 日期: 2026-04-09
> 状态: 已修复
> 影响范围: macOS + seatbelt strict/compat 模式下的 ACP 引擎（claude-code / nuwaxcode）

---

## 1. 问题描述

在 macOS 上，ACP 引擎（claude-code）被 seatbelt 沙箱以 `strict` 模式包裹后，所有需要 spawn 子进程的工具（Bash、Glob 等）因 `EPERM` 失败，无法正常执行。

### 复现步骤

1. 启动 NuwaClaw 桌面客户端，创建 ACP 会话（claude-code 引擎，sandbox mode = strict）
2. 发送提示词："运行 pwd 显示当前工作目录"
3. agent 尝试执行 Bash 工具 → EPERM

### 错误信息

```
EPERM: operation not permitted, mkdir '/private/tmp/claude-501/-Users-apple-Downloads-test-electron-client-computer-project-workspace-1746495851-1544430'
```

---

## 2. 根因分析

### 2.1 Seatbelt Profile 的 writablePaths

`SandboxInvoker.buildSeatbeltProfile()` 生成的 strict 模式 seatbelt profile，writablePaths 仅包含：

| 路径 | 来源 |
|------|------|
| `/Users/apple/Downloads/test-electron-client` | projectWorkspaceDir（用户工作区） |
| `/var/folders/.../nuwaclaw-acp-xxx` | isolatedHome（引擎隔离 HOME） |

### 2.2 claude-code 的临时目录行为

claude-code 通过 Node.js `os.tmpdir()` 获取临时目录路径。在 macOS 上，`os.tmpdir()` 返回 `/private/tmp/`（或 `$TMPDIR` 环境变量值）。

当 ACP 引擎进程的环境变量中未显式设置 `TMPDIR` 时：
- `os.tmpdir()` → `/private/tmp/`
- claude-code 尝试在 `/private/tmp/claude-501/` 下创建临时目录
- seatbelt profile 不包含 `/private/tmp/` 的写权限
- → **EPERM: operation not permitted, mkdir**

### 2.3 日志证据

```
[2026-04-09 16:14:43.359] [SandboxProcessWrapper] Sandbox wrapping succeeded: {
  type: 'macos-seatbelt',
  mode: 'strict',
  writablePaths: [
    '/Users/apple/Downloads/test-electron-client',
    '/var/folders/j7/83v2j_nd2ll9s4v4kf1j2dwc0000gn/T/nuwaclaw-acp-1775722483358-zxvgrf'
  ]
}
```

```
[2026-04-09 16:20:00.767] [AcpClient stdout] 📥 ... "status":"failed",
  "rawOutput":"EPERM: operation not permitted, mkdir '/private/tmp/claude-501/...'"
```

### 2.4 失败工具调用清单（同一会话，共 5 次）

| Tool Call ID | 工具 | 命令 | 错误 |
|---|---|---|---|
| `call_0623c3816d9b47508f6ad079` | Bash | `pwd` | EPERM mkdir `/private/tmp/claude-501/...` |
| `call_2277b5404d0c455da0db355b` | Bash | `pwd` | EPERM mkdir `/private/tmp/claude-501/...` |
| `call_3400c1f44b76412e9bc0b258` | Bash | `echo $PWD` | EPERM mkdir `/private/tmp/claude-501/...` |
| `call_d44e1ea2a9c14d1fb200c6d9` | Glob | `*` | `spawn EPERM` |
| `call_b60209d94ce34affb3d032ec` | Bash | `ls -la` (含 `dangerouslyDisableSandbox:true`) | EPERM mkdir `/private/tmp/claude-501/...` |

注意：即使工具调用携带 `dangerouslyDisableSandbox: true`，依然失败。因为 seatbelt 沙箱包裹的是整个引擎进程（进程级），不是单个工具调用。进程级的 seatbelt 限制无法被内部参数绕过。

---

## 3. 修复方案

### 3.1 方案：设置 `TMPDIR` 环境变量指向 isolatedHome/tmp

**改动文件**: `crates/agent-electron-client/src/main/services/engines/acp/acpClient.ts`

**原理**: 将 `TMPDIR`/`TEMP`/`TMP` 环境变量指向 `isolatedHome/tmp`，该路径已在 seatbelt profile 的 writablePaths 中。claude-code 的 `os.tmpdir()` 会读取 `TMPDIR`，从而在沙箱允许的路径下创建临时文件。

```typescript
const isolatedTmp = path.join(isolatedHome, "tmp");
fs.mkdirSync(isolatedTmp, { recursive: true });
env.TMPDIR = isolatedTmp;
env.TEMP = isolatedTmp;
env.TMP = isolatedTmp;
```

### 3.2 为什么不直接添加 `/private/tmp/` 到 writablePaths

| 方案 | 安全性 | 说明 |
|------|--------|------|
| 添加 `/private/tmp/` 到 writablePaths | 低 | 扩大写权限范围，违反最小权限原则 |
| **设置 TMPDIR 指向 isolatedHome/tmp** | **高** | 临时文件隔离在 isolatedHome 内，不扩大 seatbelt 写权限 |

### 3.3 影响范围

- **macOS**: seatbelt strict/compat 模式 → 修复 EPERM
- **Linux**: bwrap 模式 → 不受影响（bwrap 有独立的 tmpfs 处理）
- **Windows**: sandbox helper → 不受影响（无 TMPDIR 概念，使用 TEMP）
- **permissive 模式**: 本身就允许全局写入，不受影响

---

## 4. 验证方式

1. 重新启动 ACP 会话（strict 模式），发送 `pwd` → 应正常返回工作目录
2. 发送 `sandbox-testing-prompts.md` 中 A1 安全命令（git status, ls, node -e, cat, pwd）→ 全部正常执行
3. 确认临时文件创建在 `isolatedHome/tmp/` 而非 `/private/tmp/claude-501/`
4. 确认日志中 seatbelt profile 仍然正常生成（strict 模式生效）
5. 确认 compat/permissive 模式也正常工作

---

## 5. 相关文件

| 文件 | 说明 |
|------|------|
| `acpClient.ts` | 修复代码：设置 TMPDIR |
| `SandboxInvoker.ts` | seatbelt profile 生成（未修改） |
| `sandboxProcessWrapper.ts` | writablePaths 构建（未修改） |
| `docs/sandbox-testing-prompts.md` | 沙箱测试提示词 |
| `docs/sandbox-whitelist-blacklist-plan.md` | 沙箱白名单/黑名单设计文档 |

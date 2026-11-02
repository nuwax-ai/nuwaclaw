# Sandbox 测试验证方案

> 创建时间：2026/04/08
> 状态：已计划，待实施

## Context

目前三平台沙箱（macOS seatbelt / Linux bwrap / Windows helper）没有任何测试文件覆盖，无法验证危险操作是否被正确拦截。需要新增：
- 单元测试（无需真实沙箱二进制）
- 跨平台集成测试
- 并修复已发现的 4 个安全 Gap

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/main/services/sandbox/SandboxInvoker.ts` | seatbelt profile / bwrap args 生成 |
| `src/main/services/sandbox/sandboxProcessWrapper.ts` | ACP 进程包装 |
| `src/main/services/sandbox/policy.ts` | resolveSandboxType fallback |
| `vitest.config.ts` | 测试配置（已包含 `tests/**`） |

---

## 实现计划

### 1. 单元测试（`src/main/services/sandbox/`）

#### SandboxInvoker.test.ts

- mock `fs/promises.writeFile`，捕获 profile 内容
- **macOS**：
  - profile 以 `(version 1)` `(deny default)` 开头
  - `(allow network*)` 当 networkEnabled=true
  - seatbeltProfilePath 返回值非 undefined，供调用方清理
- **Linux**：
  - `--ro-bind / /` 存在于 bwrap args
  - `--tmpfs /tmp` 存在
  - `--dev-bind /dev /dev` 存在（记录 rw gap）
  - networkEnabled=false → `--unshare-net` 存在
  - networkEnabled=true → `--unshare-net` 不存在
  - 每个 writablePath 生成 `--bind <p> <p>`，精确索引
- **Windows**：
  - helper 不存在时抛 `SANDBOX_UNAVAILABLE` reject
  - networkEnabled=false 时 policy JSON network_access=false（JSON 解析验证）
  - writable_roots 含 workspace（JSON 解析验证）
- **none**：原样返回 command/args
- **docker**：返回原始命令并 log.warn

#### sandboxProcessWrapper.test.ts

- 测试 `buildSandboxedSpawnArgs()` 对各平台的包装结果
- enabled=false → 原样返回
- docker backend → 透传 + warn

#### policy.test.ts

- mock `fs.existsSync` 全返回 false + mock SQLite
- enabled=false → type=none, degraded=false
- 后端不可用 → degraded=true, reason 非空
- fallback 结果永远是 none，不会是其他可用类型

### 2. 集成测试（`tests/sandbox-integration/`）

#### shared-integration-utils.ts

```typescript
runInSeatbelt(profileContent: string, shellCommand: string): Promise<{exitCode, stdout, stderr, timedOut}>
runInBwrap(bwrapArgs: string[]): Promise<{exitCode, stdout, stderr, timedOut}>
expectBlocked(result): void
expectAllowed(result): void
```

#### macos-seatbelt.integration.test.ts

```typescript
describe.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))
```

使用与生产完全一致的 profile 格式（`(deny default)` + explicit allows，workspace writable，no network）：

| 类别 | 命令 | 期望 |
|------|------|------|
| 文件写入 | `echo ... >> /etc/hosts` | BLOCKED |
| 文件写入 | `echo ... >> /etc/passwd` | BLOCKED |
| 文件写入 | `touch /usr/bin/evil-binary` | BLOCKED |
| 文件写入 | `touch ~/Documents/exfil.txt` | BLOCKED |
| 文件写入 | `touch /tmp/attacker-file.txt`（/tmp 不在 writablePaths）| BLOCKED |
| 文件写入 | workspace 内写入 | ALLOWED |
| 文件删除 | `rm /etc/resolv.conf` | BLOCKED |
| 文件删除 | `rm /usr/bin/ls` | BLOCKED |
| 提权 | `sudo id` | BLOCKED |
| 系统命令 | `/sbin/shutdown -h now`（exec 允许但 root 权限不足）| 输出 Permission 字样 |
| 网络 | `curl http://example.com`（无 allow network*）| BLOCKED |

含 `(allow network*)` 的 profile 下 curl 应 ALLOWED。

#### linux-bwrap.integration.test.ts

```typescript
describe.skipIf(process.platform !== 'linux')
```

测试场景（含 `--unshare-net`、`--tmpfs /tmp`、workspace bind）：

| 类别 | 命令 | 期望 |
|------|------|------|
| 文件写入 | `/etc/hosts`, `/etc/passwd`, `/usr/bin/evil`, `/home/exfil.txt` | BLOCKED |
| 文件写入 | workspace 内 | ALLOWED |
| 文件写入 | `/tmp/sandbox-tmp.txt`（tmpfs） | ALLOWED，但宿主 /tmp 无此文件 |
| 文件删除 | `/etc/hostname`, `/bin/sh` | BLOCKED |
| 网络 | curl（--unshare-net） | BLOCKED |
| 网络 | loopback ping（--unshare-net 下仍有 lo）| ALLOWED（localhost 可用）|
| 提权 | `sudo id` | BLOCKED |
| 系统命令 | `reboot`, `halt` | BLOCKED |
| /dev gap | `mknod /dev/test-device` | BLOCKED |
| /dev gap | `echo evil > /dev/sda` | BLOCKED |
| PID 命名空间 | `ps aux \| wc -l` | < 10 行（与宿主隔离）|

---

### 3. 修复 4 个安全 Gap

#### Gap 1：`allow signal` 过于宽泛（macOS）

- **位置**：`SandboxInvoker.ts` `buildSeatbeltProfile()`
- **风险**：允许向任意可 reach 进程发信号（UNIX 权限仍阻止 PID 1，但若以 root 运行则有风险）
- **修复**：改为 `(allow signal (target self))`

#### Gap 2：`allow process-exec` 无限制（macOS）

- **位置**：`SandboxInvoker.ts` `buildSeatbeltProfile()`
- **风险**：可 exec `/sbin/shutdown`、`/sbin/reboot` 等系统命令，依赖权限不足阻止而非沙箱
- **修复**：用路径白名单限制可 exec 的目录

#### Gap 3：`--dev-bind /dev /dev` 可读写（Linux）

- **位置**：`SandboxInvoker.ts` `buildBwrap()`
- **风险**：若 `--unshare-user-try` fallback 失败（内核不支持），/dev 可写
- **修复**：改为最小 device allowlist（`--dev-bind /dev/null`、`/dev/urandom`、`/dev/zero`、`/dev/random`）

#### Gap 4：降级到 none 无用户提示

- **位置**：`policy.ts` `resolveSandboxType()`
- **风险**：用户以为有沙箱保护，实际在无沙箱运行
- **修复**：降级时 emit `sandbox:unavailable` 事件，日志级别从 debug 改为 warn

---

## 文件清单（新增）

```
src/main/services/sandbox/
  SandboxInvoker.test.ts          # 新增
  sandboxProcessWrapper.test.ts   # 新增
  policy.test.ts                  # 新增

tests/sandbox-integration/
  shared-integration-utils.ts               # 新增
  macos-seatbelt.integration.test.ts         # 新增
  linux-bwrap.integration.test.ts            # 新增
```

## 运行方式

```bash
cd crates/agent-electron-client

# 单元测试（全平台）
npm run test:run -- src/main/services/sandbox/

# macOS 集成（在 macOS 机器上）
npm run test:run -- tests/sandbox-integration/macos-seatbelt.integration.test.ts

# Linux 集成（在 Linux 机器上）
npm run test:run -- tests/sandbox-integration/linux-bwrap.integration.test.ts
```

## CI 建议

在 `package.json` 增加集成测试的 platform-specific 配置，确保 CI 在对应平台运行。

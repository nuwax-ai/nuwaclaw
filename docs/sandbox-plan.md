# 沙箱多平台测试方案（源码校准版）

> 更新日期：2026-04-09
> 审查范围：`SandboxInvoker.ts`、`policy.ts`、`@shared/types/sandbox.ts`、`windows-sandbox-helper/*.rs`
> 审查目标：准确性、完整性、一致性、深度、可操作性、安全性

---

## 1. 以源码为准的当前实现

### 1.1 模式与后端（事实）

- 沙箱模式：`strict | compat | permissive`（默认 `compat`）。
- 后端：`auto | docker | macos-seatbelt | linux-bwrap | windows-sandbox`。
- `auto` 映射：`darwin -> macos-seatbelt`，`linux -> linux-bwrap`，`win32 -> windows-sandbox`。
- `docker` 在 `SandboxInvoker.buildInvocation()` 中仅返回未包装命令并记录 warning（进程级未实现）。

### 1.2 macOS（seatbelt）

- 基线固定是 `(deny default)`。
- 非 `permissive`：
  - 允许 `file-read*`。
  - 允许 `process-exec` 的 regex：`^/usr/bin/`、`^/bin/`、`^/usr/lib/`。
  - 允许 command 本身（literal）及其 `realpath`。
  - `compat` 才会额外并入 `startupExecAllowlist`。
- `permissive`：`(allow file-write*)` + `(allow process-exec)` + `(allow signal)`。
- 非 `permissive` 的写权限仅来自 `writablePaths`（会同时尝试加入 `realpath`）。
- 额外固定写白名单：`/dev/null`、`/dev/dtracehelper`、`/dev/urandom`。

### 1.3 Linux（bwrap）

- `strict/compat` 都启用：
  - `--unshare-user-try --unshare-pid --unshare-uts --unshare-cgroup-try`
  - `networkEnabled=false` 时加 `--unshare-net`
  - `--tmpfs /tmp`
  - 仅绑定 `/dev/null`、`/dev/urandom`、`/dev/zero`
- `strict`：只读挂载最小面 + 命令相关目录：
  - 固定目录：`/usr /bin /sbin /lib /lib64 /etc /opt /usr/local`
  - 额外加入 `dirname(command)`，以及绝对参数对应目录（或目录本身）
- `compat`：`--ro-bind / /`。
- `permissive`：`--bind / / --dev-bind /dev /dev --proc /proc`，且不做 namespace 隔离；`networkEnabled` 在此模式下不生效。

### 1.4 Windows（nuwax-sandbox-helper）

- 调用格式：`nuwax-sandbox-helper run|serve --mode --cwd --policy-json -- <cmd>`。
- `run` 默认 `write_restricted=true`；`permissive + run` 时会加 `--no-write-restricted`。
- `serve` 模式固定 `write_restricted=false`（为允许孙进程）。
- `workspace-write` 且有 `writablePaths`：
  - `strict` 仅传第一个 root；
  - `compat/permissive` 传全部 roots。
- helper 内部策略关键点：
  - `WorkspaceWrite` 才有 `writable_roots` 与 `network_access` 字段。
  - `ReadOnly` 固定 `has_full_network_access=false`。
  - 网络“禁用”通过环境变量与 denybin stub（`ssh/scp`）实现，不是内核级网络隔离。
  - `compute_allow_paths()` 会在 `WorkspaceWrite` 下始终放行 `command_cwd`、`TEMP/TMP`。
  - `.git` deny 仅在被加入的 writable root 下且目录存在时生效。
  - `workspace-write` 下 ACE 默认持久化（`persist_aces=true`），不在进程退出时回滚。

### 1.5 回退策略（policy.ts）

- `enabled=false` => 直接 `type=none`。
- 后端不可用：
  - `autoFallback=manual` 抛 `SANDBOX_UNAVAILABLE`；
  - 否则统一降级 `none`，并 `app.emit("sandbox:unavailable", ...)`。
- 当前实现里 `startup-only` 与 `session` 没有行为差异（都走统一降级逻辑）。

---

## 2. 发现的问题清单（含修改建议）

### 2.1 critical

1. **Windows 网络隔离被文档描述为“全阻断”，与实现不符**
- 问题：helper 仅做环境变量与命令桩劫持，无法强制阻断所有二进制直连网络。
- 位置：原文网络章节（Windows）。
- 建议修改：明确标注为“best-effort 网络抑制”，并新增绕过测试（自带 socket 客户端二进制）。

2. **Windows strict 写范围描述过度乐观，存在 `cwd` 放行面**
- 问题：helper 在 `WorkspaceWrite` 下总是放行 `command_cwd`；若上游未约束 `cwd`，可扩大写面。
- 位置：原文“strict 仅第一个 writablePath 可写”。
- 建议修改：文档加入前置条件“调用方必须保证 `cwd` 在工作区内”；新增负例测试。

### 2.2 major

3. **`autoFallback=session` 被描述为会话级差异，但源码无差异实现**
- 问题：`startup-only` 与 `session` 当前都降级为 `none`。
- 建议修改：文档改为“预留枚举，当前行为一致”；补充后续实现 TODO。

4. **`compat` 的 startup allowlist 价值被夸大**
- 问题：当前两个调用点仅传入 command 本身，通常不增加额外可执行路径。
- 建议修改：文档改为“机制已支持，但当前调用链默认未传额外启动链”。

5. **Linux strict 挂载面文档遗漏 `/usr/local`**
- 问题：源码已包含 `/usr/local`。
- 建议修改：更正目录清单，并统一所有章节。

6. **Linux permissive 网络行为描述前后冲突**
- 问题：原文一处写“由 networkEnabled 控制”，另一处写“无隔离”；实现是不会 `unshare-net`。
- 建议修改：统一为“permissive 下不做 net namespace 隔离”。

7. **Windows read-only 与 `network_access` 字段关系未说明**
- 问题：`ReadOnly` 变体不消费 `network_access`，实际固定无 full network。
- 建议修改：在文档中写清“read-only 下网络默认受限，不依赖 policy_json 的 network_access 字段”。

8. **Windows ACL 持久化副作用未纳入测试计划**
- 问题：`workspace-write` 下 ACE 持久化可能造成长期 ACL 污染。
- 建议修改：新增“重复运行/卸载后 ACL 回收”测试与清理策略。

9. **现有 Linux 集成测试样例不可直接执行风险高**
- 问题：测试文件内 `await exec(...)` 用法与 Node API 不匹配，计划中的“可直接执行”不成立。
- 建议修改：文档明确当前仅 macOS/Linux 部分集成用例存在，且需先修复测试脚本后纳入门禁。

### 2.3 minor

10. **术语不一致（strict/compact 拼写混用）**
- 建议：统一为 `strict/compat/permissive`。

11. **macOS 设备写白名单漏写 `/dev/dtracehelper`**
- 建议：补全为 `/dev/null`、`/dev/dtracehelper`、`/dev/urandom`。

12. **部分“绝对结论”缺少前置条件**
- 建议：在表格增加“前置条件/调用方约束”列（如 cwd 约束、路径存在性）。

---

## 3. 需要补充的内容

1. **Windows 真实集成测试**（当前仓库缺失）
- `run` / `serve` 两路径；`strict/compat/permissive` 三模式；`read-only/workspace-write` 两子模式。

2. **Windows 安全回归专项**
- `cwd` 越界写入、`TEMP/TMP` 放行面、`.git` deny 仅在存在时生效、world-writable 扫描上限（200 子目录 + 1 秒）。

3. **回退可观测性测试**
- 校验 `app.emit("sandbox:unavailable")` 是否被 UI/日志消费；避免“以为开了沙箱，实际 none”。

4. **模式一致性断言**
- `startup-only` 与 `session` 当前等价，应有显式测试防止文档与实现再次漂移。

5. **调用方约束测试**
- ACP terminal/create 的 `cwd` 是否被限制在工作区（当前未在 `AcpTerminalManager` 内做路径校验）。

---

## 4. 修订后的测试矩阵（可执行）

### 4.1 已有且可运行（先行）

- 单元测试：
  - `src/main/services/sandbox/SandboxInvoker.test.ts`
  - `src/main/services/sandbox/sandboxProcessWrapper.test.ts`
  - `src/main/services/sandbox/policy.test.ts`
- 集成测试（现有文件）：
  - `tests/sandbox-integration/macos-seatbelt.integration.test.ts`
  - `tests/sandbox-integration/linux-bwrap.integration.test.ts`

执行命令：

```bash
cd crates/agent-electron-client
npm run test:run -- src/main/services/sandbox/SandboxInvoker.test.ts src/main/services/sandbox/sandboxProcessWrapper.test.ts src/main/services/sandbox/policy.test.ts
npm run test:run -- tests/sandbox-integration/macos-seatbelt.integration.test.ts
npm run test:run -- tests/sandbox-integration/linux-bwrap.integration.test.ts
```

### 4.2 必补（Windows）

| ID | 场景 | 预期 |
|----|------|------|
| WN-01 | `workspace-write + strict`，`cwd` 在 workspace 内写文件 | 成功 |
| WN-02 | `workspace-write + strict`，`cwd` 指向 workspace 外 | 必须失败（若成功则判定逃逸） |
| WN-03 | `read-only` 下写 workspace | 失败 |
| WN-04 | `run + permissive`（`--no-write-restricted`）创建子进程管道 | 成功 |
| WN-05 | `serve` 模式孙进程启动 | 成功 |
| WN-06 | `network_access=false` 下原生 socket 直连外网 | 应失败（若成功，标记为当前设计限制） |
| WN-07 | `.git` deny：root 存在 `.git` 时写入 `.git/index.lock` | 失败 |
| WN-08 | world-writable 目录审计超 200 子目录 | 仅扫描前 200，日志可见 |
| WN-09 | `workspace-write` 退出后 ACL 残留检查 | 残留可观测并有清理方案 |

---

## 5. 安全逃逸路径与当前状态

1. **Windows 网络旁路（critical）**
- 状态：未彻底解决。
- 原因：仅 env/proxy/stub 抑制，无内核网络隔离。

2. **Windows `cwd` 扩写面（critical）**
- 状态：依赖调用方约束。
- 原因：`compute_allow_paths()` 默认允许 `command_cwd`。

3. **Windows ACL 持久化污染（major）**
- 状态：已存在设计行为。
- 原因：`workspace-write` 设置 `persist_aces=true`。

4. **Linux permissive 全盘可写（known risk）**
- 状态：设计如此，仅用于排障。
- 控制：禁止作为默认策略，需审计日志。

5. **回退到 `none` 的误感知风险（major）**
- 状态：已有 `sandbox:unavailable` 事件，但需 UI 与监控闭环。

---

## 6. CI 门禁建议（修订）

1. `PR required`：三份单元测试必须通过。
2. `platform required`：macOS + Linux 集成测试通过。
3. `release required`：Windows 集成测试通过后再允许发布。
4. `security required`：
   - 回退到 `none` 必须有告警事件；
   - permissive 运行必须记录 warning；
   - Windows 网络“best-effort”限制必须在报告中明确声明。

---

## 7. 里程碑（更新）

| 周次 | 目标 |
|------|------|
| 第1周 | 修正文档与现有测试脚本可执行性（尤其 Linux 集成脚本） |
| 第2周 | 补齐 Windows helper 集成测试（WN-01~WN-05） |
| 第3周 | 完成 Windows 安全回归（WN-06~WN-09） |
| 第4周 | 打通 CI 门禁与降级告警可视化 |

---

## 8. 第二轮复审：第一轮修正核验结果（逐项对源码）

> 结论：第一轮 12 条修正中，10 条“准确”，2 条“部分准确（需补充限定）”。

| ID | 第一轮修正 | 复审结论 | 源码依据 |
|----|------------|----------|----------|
| R1 | Windows 网络并非“全阻断” | ✅ 准确 | `windows-sandbox-helper/src/env.rs` 的 `apply_no_network_to_env()` 仅设置代理/离线变量与 denybin（ssh/scp），非内核级隔离 |
| R2 | strict 写范围受 `cwd` 影响 | ✅ 准确 | `acpTerminalManager.ts` 将 `cwd` 加入 `writablePaths`；`allow.rs` 的 `compute_allow_paths()` 总是放行 `command_cwd` |
| R3 | `autoFallback=session` 与 `startup-only` 当前无行为差异 | ✅ 准确 | `policy.ts` 中 backend 不可用时，非 `manual` 统一返回 `type=none,degraded=true` |
| R4 | compat 启动链 allowlist 被高估 | ⚠️ 部分准确 | 机制有效；`sandboxProcessWrapper.ts` 当前仅传 `[originalCommand]`，但未来可扩展，文档应写“当前调用链价值有限” |
| R5 | Linux strict 漏写 `/usr/local` | ✅ 准确 | `SandboxInvoker.ts` strict ro-bind 列表包含 `/usr/local` |
| R6 | Linux permissive 网络描述冲突 | ✅ 准确 | `SandboxInvoker.ts` permissive 分支不做 `--unshare-net`，`networkEnabled` 在此分支不生效 |
| R7 | Windows read-only 与 `network_access` 关系未说明 | ✅ 准确 | `policy.rs` `ReadOnly => has_full_network_access=false`，不消费 `network_access` 字段 |
| R8 | ACL 持久化副作用未纳入测试 | ✅ 准确 | `main.rs` `persist_aces = is_workspace_write`；cleanup 仅在 `!persist_aces` 回滚 ACE |
| R9 | Linux 集成测试可执行性描述偏乐观 | ✅ 准确 | `linux-bwrap.integration.test.ts` 存在 `await exec("which bwrap")` 等 callback API 误用 |
| R10 | strict/compact 术语混用 | ✅ 准确 | 当前实现统一为 `strict/compat/permissive`（`@shared/types/sandbox.ts`） |
| R11 | macOS 设备白名单漏写 `/dev/dtracehelper` | ✅ 准确 | `SandboxInvoker.ts` 固定写白名单含 `/dev/dtracehelper` |
| R12 | 缺少前置条件声明 | ⚠️ 部分准确 | 实现已隐含多项调用方前置约束（如 `cwd`、路径存在、MCP 进程 env），文档需显式化 |

---

## 9. 第二轮新增发现（第一轮遗漏）

### 9.1 环境变量链路存在“分层过滤不一致”

- `AcpTerminalManager`（Windows `terminal/create` 路径）确实使用 `safeKeys` 最小白名单构造 env（可降低敏感变量泄露面）。
- 但 `windows-sandbox-helper` 的 `SandboxContext::setup()` 以 `std::env::vars()` 作为基底，`env.rs` 内没有独立的 `safeKeys` 白名单逻辑。
- `sandboxed-bash-mcp.mjs` 执行 helper 时使用 `env = { ...process.env }`，仅删除 `ELECTRON_RUN_AS_NODE`，因此若 MCP 进程继承到敏感变量，可能继续传入 helper/子命令。

结论：需要把“safeKeys 白名单”在文档中明确为“仅 terminal/create 路径有效，不是 helper 全局机制”，并新增泄露测试（见第 12 节）。

### 9.2 `sandboxed-bash-mcp` 强制 `--no-write-restricted`

- MCP 脚本构造 helper 参数时固定包含 `run --no-write-restricted`。
- 这意味着该路径始终依赖 DACL ACE 控制写权限，不使用 WRITE_RESTRICTED token 的二次约束。

结论：文档应把该行为从“可选/模式相关”改为“当前实现固定开启”。

### 9.3 world-writable 审计是“尽力而为”，且不会 fail-closed

- `audit.rs` 只扫描 `cwd` 直接子目录，最多 200 个，最长 1 秒。
- 发现风险目录后仅尝试加 deny ACE；失败仅记日志，不阻断运行。
- 对工作区 root 下目录（`starts_with(workspace_roots)`）会跳过 deny。

结论：文档需明确这是补偿性审计，不是强制安全边界。

---

## 10. 深度审查补充（指定模块）

### 10.1 AcpTerminalManager（Windows `terminal/create` 路径）

- Windows + helper 可用时：`terminal/create` 通过 `SandboxInvoker.buildInvocation(...subcommand=run)` 走 `nuwax-sandbox-helper run`，`parseJson=true`。
- `writablePaths` 传参为 `[workspaceRoot, cwd]`（strict 下 helper policy 仅保留首个 root，但 helper 内仍会允许 `command_cwd`）。
- env 构建：
  - 沙箱路径：仅取 `safeKeys`；
  - 非沙箱路径：透传宿主 env；
  - `params.env` 直接覆盖（无二次过滤）。
- 直接执行分支（macOS/Linux 或未启用 helper）在 Windows 下会 `shell: true`，helper 分支 `shell: false`。

### 10.2 sandboxed-bash-mcp（Windows 专属 MCP 注入）

- 仅在 `engine=claude-code` 且 `windows-sandbox` 启用时注入，且通过 `_meta` 禁用内置 Bash。
- MCP 工具名仍为 `Bash`，实际命令固定走 helper：
  - `run --no-write-restricted --mode <...> --cwd <process.cwd()> --policy-json <...> -- <bash/powershell> -c/-Command <user command>`
- shell 优先级：
  - 优先 Git Bash（支持 bash 语法）；
  - 否则回退 PowerShell。
- 该路径的 env 继承策略与 `terminal/create` 不同（见 9.1）。

### 10.3 env.rs（环境变量处理）

- 当前职责是网络抑制、分页器设置、`/dev/null` 归一化，不负责敏感键白名单过滤。
- `apply_no_network_to_env()` 会注入代理与离线相关变量，并 prepend denybin（`ssh/scp` stub）。
- 实际安全语义是“网络访问抑制 + 常见命令劫持”，不是“环境最小化”。

### 10.4 audit.rs（world-writable 扫描）

- 扫描范围：仅 `cwd` 下一级目录，忽略 symlink/非目录。
- 资源上限：`MAX_CWD_CHILDREN=200`，`AUDIT_TIME_LIMIT_SECS=1`。
- 判定：检查 DACL 中是否存在 world SID 的 write allow ACE。
- 处置：尝试对 capability SID 添加 deny write ACE；失败仅日志，流程继续。

### 10.5 acl.rs（DACL/ACE 细节）

- `add_allow_ace`：为 capability SID 授予 `FILE_GENERIC_READ|WRITE|EXECUTE`，继承到子对象。
- `add_deny_write_ace`：deny mask 包含 `FILE_GENERIC_WRITE` 与 `FILE_WRITE_*` 细项。
- `revoke_ace`：cleanup 阶段用 `REVOKE_ACCESS` 回收（仅 `persist_aces=false` 时执行）。
- `allow_null_device`：对 `\\.\NUL` 追加 allow ACE，避免 null 设备访问异常。

### 10.6 token.rs（Restricted Token）

- 基础标志：`DISABLE_MAX_PRIVILEGE | LUA_TOKEN`。
- `write_restricted=true` 时额外加 `WRITE_RESTRICTED`，并附加 3 个 restricting SIDs：
  - capability SID
  - 当前 logon SID
  - everyone SID
- `write_restricted=false`（serve 或 run+`--no-write-restricted`）时不加 restricting SIDs，主要依赖 DACL。
- 创建后仅重新启用 `SeChangeNotifyPrivilege`。

---

## 11. 与既有文档发现的纳入情况

### 11.1 `sandbox/TEST-PLAN.md` 纳入状态

| 项 | 状态 | 备注 |
|----|------|------|
| Gap-1~Gap-4（signal/exec/dev-bind/降级告警） | 已纳入 | 第 1/2/6 节已覆盖 |
| macOS/Linux 集成思路 | 部分纳入 | 已引用测试文件，但需补“当前脚本可执行性风险” |
| Windows 集成缺口 | 已纳入 | 第 4 节 WN-01~WN-09 |
| 并发/长稳/泄漏 | 未充分纳入 | 本轮第 12 节补全 |

### 11.2 `sandbox/CODE-REVIEW.md` 纳入状态

- 该文档多数问题属于 `DockerSandbox/PermissionManager/WorkspaceManager` 通用模块，不全是“多平台 sandbox-plan”范围。
- 与本计划直接相关且应跟踪的项：
  - 降级可观测性（已纳入）
  - 测试覆盖不足（已纳入）
  - 安全检测可绕过类问题（应在独立 `PermissionManager` 安全计划跟进，不并入本计划的门禁结论）

结论：`CODE-REVIEW` 需在文档中标注“范围交集清单”，避免误解为“全部已在本计划闭环”。

---

## 12. 新增测试用例（第二轮补充）

### 12.1 环境变量泄露测试

| ID | 路径 | 步骤 | 预期 |
|----|------|------|------|
| ENV-01 | `terminal/create` | 预置宿主 `ANTHROPIC_API_KEY=leak_test`，在沙箱内执行 `env` | 输出中不应出现该键（除非通过 `params.env` 显式注入） |
| ENV-02 | `sandboxed-bash-mcp` | 同样预置敏感键，经 MCP Bash 执行 `set`/`env` | 若出现敏感键，标记高危并推动 MCP 路径加白名单过滤 |
| ENV-03 | helper `run` 直调 | 传入最小 env 与全量 env 对比 | 证明 helper 无内置 `safeKeys` 过滤（文档与实现一致） |

### 12.2 并发沙箱实例测试

| ID | 场景 | 预期 |
|----|------|------|
| CONC-01 | 50 个并发 `terminal/create`（上限） | 全部可创建并可回收 |
| CONC-02 | 第 51 个 `terminal/create` | 返回“Terminal limit reached”错误 |
| CONC-03 | 并发 `run` + `serve` 混合 | 无死锁；退出码与输出互不串扰 |

### 12.3 长时间运行稳定性

| ID | 场景 | 指标/阈值 |
|----|------|-----------|
| SOAK-01 | 单实例 `serve` 连续 24h | 无异常退出；内存增长斜率可控（例如 < 5%/h） |
| SOAK-02 | 周期性 `run`（每分钟一次，持续 12h） | 成功率 >= 99.9%，无句柄持续上涨 |

### 12.4 资源泄漏测试

| ID | 场景 | 预期 |
|----|------|------|
| LEAK-01 | 批量创建/释放 terminal 1000 次 | 无孤儿进程、无句柄持续累积 |
| LEAK-02 | `workspace-write` 退出后 ACL 检查 | 记录持久 ACE 残留；清理脚本可回收 |
| LEAK-03 | seatbelt profile 清理 | `sandboxProcessWrapper` cleanup 后临时 `.sb` 文件不存在 |

---

## 13. CI/CD 细化（GitHub Actions 可落地模板）

### 13.1 Workflow 建议

1. `sandbox-unit.yml`
   - 触发：`pull_request`、`push` 到主干
   - 矩阵：`ubuntu-latest`, `macos-latest`, `windows-latest`
   - 运行：`SandboxInvoker/policy/sandboxProcessWrapper` 单元测试
2. `sandbox-integration-unix.yml`
   - 触发：`pull_request`
   - 矩阵：`ubuntu-latest`, `macos-latest`
   - 运行：`tests/sandbox-integration/*`（先修复 Linux 脚本 API 误用）
3. `sandbox-integration-windows.yml`
   - 触发：`workflow_dispatch` + `release/*` 分支必跑
   - 运行：WN/ENV/CONC/SOAK/LEAK 中可自动化子集
4. `sandbox-security-report.yml`
   - 汇总各 job 产物，生成单一 `sandbox-report.json` + Markdown 摘要并上传 artifact。

### 13.2 报告格式与指标

- 建议统一 JSON schema：
  - `platform`, `backend`, `mode`, `case_id`, `status`, `duration_ms`, `exit_code`, `notes`
- 关键指标：
  - `pass_rate`（按平台/后端/模式分组）
  - `degrade_to_none_count`
  - `policy_violation_count`（如 strict 下越权写成功）
  - `env_leak_count`
  - `resource_leak_signals`（handle/process/tempfile/acl）
- PR 门禁阈值建议：
  - `critical` 用例 100% 通过
  - `major` 用例 >= 99%
  - `env_leak_count == 0`
  - `degrade_to_none_count` 必须附带告警记录与原因

---

## 14. 迁移与兼容性补充

### 14.1 旧版本策略迁移

- 已有兼容：`policy.ts` 支持 `windows.sandbox.mode -> windowsMode` 映射。
- 建议新增迁移规则：
  1. 缺失 `autoFallback` 时默认补 `startup-only`。
  2. 缺失 `mode` 时默认补 `compat`。
  3. 旧值非法时回退到 `DEFAULT_SANDBOX_POLICY` 并记录一次迁移日志。

### 14.2 跨版本兼容要求

1. 新增字段必须向后兼容（unknown 字段忽略，不影响旧客户端读取）。
2. 禁止静默改变默认安全语义：
   - 例如 `windowsMode` 默认值变更必须伴随版本门禁与迁移提示。
3. `SandboxAutoFallback` 新枚举落地前，需先保证旧版本按“最安全可运行”路径降级（当前即 `none + degraded=true + 事件告警`）。
4. helper 与主程序版本协商：
   - 建议在 helper 启动时输出 `version/capabilities`，主程序按能力选择参数，避免跨版本参数不兼容。

### 14.3 升级回滚策略

- 升级前备份 `sandbox_policy`（SQLite）。
- 新版本启动首轮执行策略 normalize + migrate，并写入 `policy_migration_audit` 日志。
- 回滚时保留可识别字段，删除新版本专有字段（或降级到默认策略），确保旧版本不崩溃。

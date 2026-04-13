# 沙箱白名单/黑名单矩阵与验证计划（跨平台 + 多模式）

> 更新日期：2026-04-09
> 上游审查依据：`sandbox-plan.md`（两轮审查，12 条问题已确认）

---

## 1. 范围边界

### 1.1 In Scope

- 平台：macOS / Linux / Windows
- 后端：`macos-seatbelt` / `linux-bwrap` / `windows-sandbox` / `docker`（当前未实现，显式标注 `unsupported`）
- 沙箱模式（`mode`）：`strict` / `compat` / `permissive`（全平台通用，含 Windows）
- Windows 子模式（`windowsMode`，独立维度）：`read-only` / `workspace-write`，与 `mode` 正交组合
- 双层覆盖：
  1. **沙箱层**：文件系统、网络、进程执行、设备访问的 allow/block/conditional 行为
  2. **命令权限层**：`PermissionManager` 的 safeCommands 白名单与危险命令黑名单行为

### 1.2 Out of Scope

- GUI Agent 沙箱策略与测试
- 非沙箱业务功能

---

## 2. 核心设计决策

### 决策 1：矩阵是"规范文档"（normative），而非从实现反向生成

若矩阵从实现代码自动提取，则实现的 bug 会被误记为"正确行为"，规范价值丧失。

**确定方向**：矩阵由人工审查后手动维护 → 测试验证实现是否符合矩阵 → CI 检查矩阵与生成文档是否同步。

```
手工维护 sandbox-matrix.spec.json  ←  专家审查 + PR review
        ↓
测试驱动（从 spec 生成表驱动用例）
        ↓
验证实现是否符合矩阵
        ↓
CI: spec → 生成 Markdown，git diff 检查一致性
```

生成脚本（`crates/agent-electron-client/scripts/generate-sandbox-matrix-doc.js`）的职责是：`spec.json → .md`，方向单向，不反向提取。

### 决策 2：两层矩阵严格分离

| 层 | Spec 文件 | 内容 |
|---|---|---|
| 沙箱层 | `docs/sandbox/sandbox-matrix.spec.json` | 平台/后端/模式下各操作的 verdict |
| 命令权限层 | `docs/sandbox/permission-matrix.spec.json` | safeCommands 白名单 + 危险命令黑名单行为 |

两层不混入同一文件，避免审查与测试范围混淆。

---

## 3. 产物定义

### 3.1 规范文件（手工维护，单一真源）

**`docs/sandbox/sandbox-matrix.spec.json`** — 沙箱层：

```json
{
  "cases": [
    {
      "id": "MAC-SEATBELT-COMPAT-workspace_write",
      "platform": "darwin",
      "backend": "macos-seatbelt",
      "mode": "compat",
      "operationId": "workspace_write",
      "verdict": "allow",
      "evidence": "SandboxInvoker.ts buildSeatbelt: writablePaths → allow file-write*"
    },
    {
      "id": "WIN-SANDBOX-COMPAT-WW-network_external",
      "platform": "win32",
      "backend": "windows-sandbox",
      "mode": "compat",
      "windowsMode": "workspace-write",
      "operationId": "network_external",
      "verdict": "conditional",
      "condition": "best-effort suppression via env vars + denybin stubs (ssh/scp); does not block raw socket connections",
      "evidence": "windows-sandbox-helper/src/env.rs apply_no_network_to_env()"
    },
    {
      "id": "ALL-DOCKER-ANY-any",
      "platform": "*",
      "backend": "docker",
      "mode": "*",
      "operationId": "*",
      "verdict": "unsupported",
      "reason": "process-level docker wrapping not implemented; SandboxInvoker returns unwrapped command with warning log"
    }
  ]
}
```

**操作枚举（operationId）**：

| ID | 说明 |
|----|------|
| `workspace_write` | 工作区内写文件 |
| `outside_workspace_write` | 工作区外写文件 |
| `system_path_write` | 系统路径写（`/etc`, `/usr`, `C:\Windows`） |
| `file_read` | 任意路径读 |
| `network_external` | 外网 TCP/UDP |
| `network_loopback` | loopback（127.0.0.1）访问 |
| `process_exec_whitelist` | 白名单路径可执行文件 |
| `process_exec_arbitrary` | 任意路径可执行文件 |
| `privilege_escalation` | sudo/su/提权命令 |
| `device_write` | `/dev` 设备节点写 |

**Verdict 语义**：

| 值 | 含义 | 必填字段 |
|----|------|---------|
| `allow` | 操作被允许 | — |
| `block` | 操作被阻断 | — |
| `conditional` | 取决于前置条件或调用方约束 | `condition` |
| `unsupported` | 该组合当前未实现 | `reason` |

所有条目必须有 `evidence` 字段，引用具体源码位置（如 `SandboxInvoker.ts:L123`）。

**通配符语义**：`"*"` 表示"适用于该维度的所有值"（如 `"platform": "*"` 表示全平台）。测试代码需显式处理：`c.platform === process.platform || c.platform === "*"`。

**`docs/sandbox/permission-matrix.spec.json`** — 命令权限层：

```json
{
  "safeCommands": {
    "commands": ["node", "npm", "npx", "git", "ls", "cat", "..."],
    "expectedBehavior": "auto-approve for command:execute without user confirmation",
    "evidence": "PermissionManager.ts DEFAULT_PERMISSION_POLICY.safeCommands"
  },
  "dangerousCommands": {
    "cases": [
      {
        "id": "PERM-SUDO",
        "input": "sudo rm -rf /",
        "matchedPattern": "sudo",
        "expectedResult": "allowed: false",
        "evidence": "PermissionManager.ts DANGEROUS_COMMANDS + checkDangerousOperation word-boundary regex"
      },
      {
        "id": "PERM-CHMOD-777",
        "input": "chmod 777 /etc",
        "matchedPattern": "chmod 777",
        "expectedResult": "allowed: false"
      },
      {
        "id": "PERM-CHMOD-755-FP",
        "input": "chmod 755 file",
        "matchedPattern": null,
        "expectedResult": "allowed: true",
        "note": "word-boundary regression: must NOT match 'chmod 777' pattern"
      }
    ]
  },
  "sensitivePaths": {
    "cases": [
      {
        "id": "PERM-SSH",
        "type": "file:write",
        "target": "/home/user/.ssh/id_rsa",
        "expectedResult": "allowed: false"
      },
      {
        "id": "PERM-ETC-PASSWD",
        "type": "file:write",
        "target": "/etc/passwd",
        "expectedResult": "allowed: false",
        "note": "sensitiveEtcPaths 精确匹配；/etc/hosts 当前不在阻止列表中"
      }
    ]
  },
  "denyList": {
    "cases": [
      {
        "id": "PERM-SYS-PKG",
        "type": "package:install:system",
        "target": "curl",
        "expectedResult": "allowed: false, no confirmation prompt"
      }
    ]
  }
}
```

### 3.2 已知 conditional 条目（需在 spec 中显式标注）

| 组合 | operationId | condition |
|------|-------------|-----------|
| Windows / any / `workspace_write` strict | `outside_workspace_write` | `helper 始终放行 command_cwd；调用方必须保证 cwd 在 workspace 内` |
| Windows / `windows-sandbox` / any | `network_external` | `best-effort env/stub 抑制，不是内核级隔离` |
| All / `autoFallback=session` | 全部 | `当前与 startup-only 行为一致，预留枚举，TBD` |
| macOS seatbelt / `sudo` exec | `process_exec_whitelist` | `/usr/bin/sudo` 在 exec 白名单（`^/usr/bin/`），可被执行；但权限提升被 seatbelt deny，结果为 conditional |
| Windows / `sandboxed-bash-mcp` | 全部 | `MCP 路径固定传 --no-write-restricted，不使用 WRITE_RESTRICTED token；依赖 DACL ACE 控制写权限` |
| Linux / `linux-bwrap` / permissive | `network_external`, `network_loopback` | `permissive 走独立代码分支（SandboxInvoker.ts:228-239），不执行 --unshare-net；即使 networkEnabled=false 也不隔离网络` |

### 3.3 生成产物（CI 检查）

- `docs/sandbox/sandbox-matrix.generated.md` — 由 `crates/agent-electron-client/scripts/generate-sandbox-matrix-doc.js` 从 spec 生成，提交至仓库
- `sandbox-report.json` — 测试执行结果汇总，上传 CI artifact

**CI 一致性检查**：每次 spec 变更后重新生成 `.md`；若生成结果与仓库已提交版本不一致，PR 门禁失败。

### 3.4 CI 报告 schema

```json
{
  "platform": "darwin|linux|win32",
  "backend": "macos-seatbelt|linux-bwrap|windows-sandbox",
  "mode": "strict|compat|permissive",
  "windowsMode": "read-only|workspace-write|null",
  "case_id": "MAC-SEATBELT-COMPAT-workspace_write",
  "status": "pass|fail|skip",
  "duration_ms": 123,
  "exit_code": 0,
  "notes": ""
}
```

关键指标：`pass_rate`（按平台/后端/模式分组）、`degrade_to_none_count`、`env_leak_count`、`policy_violation_count`。

---

## 4. 测试方案

### 4.1 沙箱层核心测试清单

> 注：Windows 列的行为取决于 `mode` × `windowsMode` 组合，下表以 `compat` + `workspace-write`（默认配置）为基准。

| 操作 | macOS seatbelt | Linux bwrap | Windows sandbox（compat + workspace-write） |
|------|---------------|-------------|----------------------------------------------|
| workspace 内写 | allow | allow | allow |
| workspace 外写 | block | block | conditional（helper 放行 `command_cwd`，需调用方约束） |
| 系统路径写/删 | block | block | block |
| 外网访问 | 按 `networkEnabled`（true → `(allow network*)`，适用所有模式） | strict/compat：按 `networkEnabled`（false → `--unshare-net`）；**permissive：不隔离网络**（走独立分支，`--unshare-net` 不执行） | conditional（best-effort env/stub，非内核级） |
| loopback 访问 | 同外网，受 `networkEnabled` 控制（与 mode 无关） | 同外网（permissive 例外：始终可访问） | 需实测 |
| `sudo`（`/usr/bin/sudo`） | **conditional**：exec 被放行（路径在白名单 `^/usr/bin/`），但权限提升被 seatbelt deny | block（`/usr/bin/` 不在 strict 挂载面 / bwrap 命名空间隔离） | block（PermissionManager 层拦截） |
| `reboot`/`shutdown`（`/sbin/`） | block（`/sbin/` 不在 exec 白名单） | block | block |
| workspace 内写（`read-only` 模式时） | N/A | N/A | **block**（`ReadOnly` 策略无 `writable_roots`） |

### 4.2 命令权限层测试（PermissionManager）

**新增测试文件**：`src/main/services/sandbox/PermissionManager.test.ts`

关键断言：

注意：`checkPermission` 返回 `Promise<PermissionResult>`（`{ allowed: boolean; reason: string }`），不抛出异常。危险操作返回 `allowed: false`，不进入用户确认队列。

```typescript
// safeCommands 自动放行
it("should auto-approve safeCommands", async () => {
  for (const cmd of DEFAULT_PERMISSION_POLICY.safeCommands) {
    const r = await pm.checkPermission(sid, "command:execute", cmd);
    expect(r.allowed).toBe(true);
  }
});

// 危险命令拦截（直接返回 allowed:false，不抛出）
it("should block dangerous commands", async () => {
  const sudo = await pm.checkPermission(sid, "command:execute", "sudo rm -rf /");
  expect(sudo.allowed).toBe(false);

  const nc = await pm.checkPermission(sid, "command:execute", "nc -l 8080");
  expect(nc.allowed).toBe(false);
});

// word-boundary 回归：DANGEROUS_COMMANDS 包含 "chmod 777" 字面串
// 应 block "chmod 777 file"，不应误杀 "chmod 755 file"
it("should not false-positive on chmod 755", async () => {
  const block = await pm.checkPermission(sid, "command:execute", "chmod 777 /etc");
  expect(block.allowed).toBe(false);

  const safe = await pm.checkPermission(sid, "command:execute", "chmod 755 file");
  expect(safe.allowed).toBe(true); // 755 不在危险命令黑名单
});

// 敏感路径拦截
// 注意：sensitiveEtcPaths 仅含 /etc/passwd, /etc/shadow, /etc/sudoers, /etc/group
// /etc/hosts 当前 **不在** 阻止列表中（待评估是否需要补入）
it("should block file:write to sensitive paths", async () => {
  const passwd = await pm.checkPermission(sid, "file:write", "/etc/passwd");
  expect(passwd.allowed).toBe(false);

  const shadow = await pm.checkPermission(sid, "file:write", "/etc/shadow");
  expect(shadow.allowed).toBe(false);

  // .ssh 检测使用 .includes(".ssh")，存在子串误判风险
  // "not.sshrc" 也会被拦截（已知限制，需评估是否改为路径段匹配）
  const ssh = await pm.checkPermission(sid, "file:write", "/home/user/.ssh/id_rsa");
  expect(ssh.allowed).toBe(false);
});

// workspaceOnly 注意：PermissionManager 中 workspaceOnly 检查为占位注释，
// 实际路径边界由 WorkspaceManager 在执行时校验。
// 此处仅测试 PermissionManager 不会越权放行 denyList/dangerousOp。

// system packages 在 denyList 中 → checkDangerousOperation 直接返回 allowed:false
it("should deny package:install:system without user confirmation", async () => {
  const r = await pm.checkPermission(sid, "package:install:system", "curl");
  expect(r.allowed).toBe(false);
  // 验证：不应出现在待审批队列中（即未调用 requestPermission）
});
```

### 4.3 表驱动集成测试（复用 spec）

**新增文件**：`tests/sandbox-integration/matrix-driven.test.ts`

```typescript
import spec from "../../docs/sandbox/sandbox-matrix.spec.json";

const runnable = spec.cases.filter(c =>
  (c.platform === process.platform || c.platform === "*") &&
  c.verdict !== "unsupported"
);

describe.each(runnable)("[$id] $platform/$backend/$mode $operationId", (tc) => {
  it(`verdict: ${tc.verdict}`, async () => {
    const result = await runSandboxedOperation(tc);
    if (tc.verdict === "block") {
      expect(result.exitCode).not.toBe(0);
    } else if (tc.verdict === "allow") {
      expect(result.exitCode).toBe(0);
    }
    // conditional: 由 tc.condition 描述约束，测试结果写入 notes 字段
  });
});
```

**`runSandboxedOperation` 职责**：

1. 根据 `tc.backend` 构造 `SandboxInvoker` 实例
2. 根据 `tc.operationId` 映射到具体 shell 操作（如 `workspace_write` → `echo test > <workspaceDir>/test.txt`，`network_external` → `curl -s --max-time 2 https://example.com`）
3. 调用 `buildInvocation()` 包装命令，`spawn` 执行，返回 `{ exitCode, stdout, stderr }`
4. 需维护一个 `operationId → shell command` 映射表，确保测试操作可复现

### 4.4 环境变量泄露测试

**新增文件**：`tests/sandbox-integration/env-leak.test.ts`

| ID | 路径 | 步骤 | 预期 |
|----|------|------|------|
| ENV-01 | `terminal/create` | 预置 `ANTHROPIC_API_KEY=leak_test`，沙箱内执行 `env` | 输出不含该键 |
| ENV-02 | `sandboxed-bash-mcp` | 同上，经 MCP Bash 路径 | 若出现则标记高危（当前已知风险：仅删 `ELECTRON_RUN_AS_NODE`） |
| ENV-03 | helper 直调 | 对比最小 env vs 全量 env | 证明 helper 无内置 safeKeys 过滤（文档与实现一致） |

### 4.5 降级可观测性测试

**文件**：`tests/sandbox-integration/fallback-observability.test.ts`

| ID | 场景 | 预期 |
|----|------|------|
| OBS-01 | 模拟 backend 不可用（`autoFallback` 非 manual），检查 `app.emit("sandbox:unavailable")` 是否触发 | 事件必须触发，并携带 `reason` |
| OBS-02 | 降级后实际 sandbox type 为 `none`，日志中必须有明确记录 | 日志可查，不静默 |
| OBS-03 | `permissive` 模式启动时，必须有 warning 日志 | warning 可查 |

### 4.6 Windows 集成测试（WN 系列，来自 sandbox-plan.md §4.2）

| ID | 场景 | 预期 |
|----|------|------|
| WN-01 | `workspace-write + strict`，cwd 在 workspace 内写文件 | 成功 |
| WN-02 | `workspace-write + strict`，cwd 指向 workspace 外 | 失败（逃逸判定） |
| WN-03 | `read-only` 下写 workspace | 失败 |
| WN-04 | `run + permissive`（`--no-write-restricted`）创建子进程管道 | 成功 |
| WN-05 | `serve` 模式孙进程启动 | 成功 |
| WN-06 | `network_access=false` 下原生 socket 直连外网 | 应失败（若成功，标记为当前设计限制并写入矩阵 conditional） |
| WN-07 | `.git` deny：root 存在 `.git` 时写入 `.git/index.lock` | 失败 |
| WN-08 | world-writable 目录审计超 200 子目录 | 仅扫描前 200，日志可见 |
| WN-09 | `workspace-write` 退出后 ACL 残留检查 | 残留可观测并有清理方案 |

---

## 5. CI 门禁（分层）

**新增 workflow**：`.github/workflows/sandbox-gates.yml`

### 5.1 PR 必跑

| Job | 说明 |
|-----|------|
| `sandbox-unit` | matrix: ubuntu/macos/windows，运行 `src/main/services/sandbox/` 单元测试 |
| `sandbox-matrix-consistency` | `generate-sandbox-matrix-doc.js` 生成后 `git diff --exit-code`，不一致则失败 |
| `sandbox-integration-unix` | matrix: ubuntu/macos，运行 `tests/sandbox-integration/` |

### 5.2 Release 分支必跑

| Job | 说明 |
|-----|------|
| `sandbox-integration-windows` | `runs-on: windows-latest`，运行 WN-01~WN-09 可自动化子集 |
| `sandbox-security-report` | 汇总所有 job 产物，生成 `sandbox-report.json` artifact |

### 5.3 门禁阈值

- `system_path_write` / `outside_workspace_write` critical 用例：100% block
- `env_leak_count == 0`（ENV-01~ENV-03）
- `degrade_to_none_count > 0` 时必须有对应 `sandbox:unavailable` 事件日志

---

## 6. 交付物一览

| 文件 | 类型 | 说明 |
|------|------|------|
| `docs/sandbox/sandbox-matrix.spec.json` | 规范（手工维护） | 沙箱层单一真源 |
| `docs/sandbox/permission-matrix.spec.json` | 规范（手工维护） | 命令权限层单一真源 |
| `docs/sandbox/sandbox-matrix.generated.md` | 生成（CI 检查） | 从 spec 生成，人类可读 |
| `crates/agent-electron-client/scripts/generate-sandbox-matrix-doc.js` | 工具 | spec.json → .md 单向转换 |
| `crates/agent-electron-client/scripts/generate-sandbox-report.js` | 工具 | 测试结果 → sandbox-report.json |
| `src/main/services/sandbox/PermissionManager.test.ts` | 测试（新增） | 命令权限层专项 |
| `tests/sandbox-integration/matrix-driven.test.ts` | 测试（新增） | 从 spec 驱动的沙箱层集成测试 |
| `tests/sandbox-integration/env-leak.test.ts` | 测试（新增） | 环境变量泄露测试 |
| `tests/sandbox-integration/fallback-observability.test.ts` | 测试（新增） | 降级可观测性测试（OBS-01~03） |
| `.github/workflows/sandbox-gates.yml` | CI（新增） | 分层门禁 workflow |

---

## 7. 执行顺序：macOS → Windows → Linux

### Phase 1：macOS（Week 1~2）

1. **Week 1**：手工编写 `sandbox-matrix.spec.json`（macOS seatbelt 为第一批 verdict，含 `sudo` conditional 条目）
2. **Week 1**：新增 `PermissionManager.test.ts`（`allowed` 字段断言、word-boundary 回归；平台无关，最早可并行）
3. **Week 1**：新增 `fallback-observability.test.ts`（OBS-01~03；平台无关，最早可并行）
4. **Week 2**：新增 `env-leak.test.ts` ENV-01~ENV-02（terminal/create + sandboxed-bash-mcp）
5. **Week 2**：实现 `matrix-driven.test.ts`（先只运行 macOS 部分）；打通 macOS seatbelt 集成门禁

### Phase 2：Windows（Week 3）

6. 补写 `sandbox-matrix.spec.json` Windows 部分（conditional：cwd 约束、网络 best-effort、sandboxed-bash-mcp `--no-write-restricted`）
7. 实现 WN-01~WN-05（基础行为：workspace write、read-only、run/serve）
8. ENV-03 + WN-06~WN-09（安全回归：网络旁路、ACL 持久化清理）
9. 打通 `sandbox-integration-windows.yml`（release 分支门禁）

### Phase 3：Linux（Week 4）

10. 修复 `linux-bwrap.integration.test.ts` callback API 误用（改为 `promisify(exec)` 或 `execa`）
11. 补写 `sandbox-matrix.spec.json` Linux bwrap 部分；扩展 `matrix-driven.test.ts`
12. 打通全平台 `sandbox-gates.yml`；生成 `sandbox-report.json`

---

## 8. 已锁定假设

1. GUI Agent 沙箱不纳入本计划。
2. 采用双层模型（沙箱层 + 命令权限层），两层矩阵严格分离，不混入同一 spec 文件。
3. 交付形式固定为 JSON + Markdown + 自动化测试。
4. CI 采用分层门禁：PR 强制单元测试 + 一致性检查；Windows 集成在 release 分支强制。
5. 矩阵为规范（normative）文档，人工维护；生成脚本仅做 spec→md，不从实现反向提取。
6. `docker` 全平台显式标注 `unsupported`，不伪装为已支持。
7. `autoFallback=session` 与 `startup-only` 当前等价，矩阵注释标明"预留枚举，TBD"。
8. Windows 的 `mode`（strict/compat/permissive）与 `windowsMode`（read-only/workspace-write）是正交组合，矩阵条目需覆盖两个维度。
9. CONC（并发）、SOAK（长稳）、LEAK（资源泄漏）测试不纳入本计划，作为后续独立专项。

---

## 9. 与现有文档的关系

- **`sandbox-plan.md`**：保留为"问题发现与决策记录"文档，本计划不替换它。本计划将其 §12 中的 **ENV 测试用例**和 §13（CI 建议）转化为可执行代码与 workflow。§12 中的 CONC（并发）、SOAK（长稳）、LEAK（资源泄漏）测试用例当前不纳入本计划，作为后续独立专项跟进。
- **`sandbox/TEST-PLAN.md`**、**`sandbox/CODE-REVIEW.md`**：已有内容仍有效，本计划以 spec + 表驱动测试为主干，与之互补。
- **`sandbox-matrix.spec.json`**：作为"当前正确行为"的规范真源，与 `sandbox-plan.md` 中的问题列表形成问题→修复→验证闭环。

---

## 10. Deep Research 发现（实施前需评估）

以下问题在源码审查中发现，需在 Phase 1 实施前决定处置方式（修复 or 标注为已知限制）：

### 10.1 PermissionManager 层

| # | 问题 | 严重度 | 源码位置 | 建议 |
|---|------|--------|----------|------|
| DR-1 | `/etc/hosts` 不在 `sensitiveEtcPaths` 列表中，当前不会被拦截 | 中 | PermissionManager.ts:651-657 | 评估是否补入；若不补入则在矩阵中标注为 `allow` |
| DR-2 | `.ssh` 检测用 `lowerTarget.includes(".ssh")`，会误拦含 `.ssh` 子串的非 SSH 路径（如 `not.sshrc`） | 中 | PermissionManager.ts:642 | 改为路径段匹配（如 `/.ssh/` 或 `path.basename` 检查） |
| DR-3 | `workspaceOnly` 在 PermissionManager 中为注释占位，实际由 WorkspaceManager 执行路径边界检查 | 高 | PermissionManager.ts:203-205 | 测试需跨模块验证（PermissionManager + WorkspaceManager 联合），不能仅测 PermissionManager |

### 10.2 沙箱层

| # | 问题 | 严重度 | 源码位置 | 建议 |
|---|------|--------|----------|------|
| DR-4 | Linux permissive 模式走独立代码分支，不执行 `--unshare-net`（即使 `networkEnabled=false`） | 中 | SandboxInvoker.ts:228-239 | 在矩阵中标注为 conditional；若需修复则在 permissive 分支末尾补入 `--unshare-net` 判断 |
| DR-5 | macOS strict/compat 下 signal 规则为 `(allow signal (target self))`，permissive 为无限制 `(allow signal)` | 低 | SandboxInvoker.ts:428,464 | 在矩阵中记录差异即可 |
| DR-6 | Windows `serve` 模式固定 `write_restricted=false`（main.rs:585），仅靠 DACL ACE 保护写权限 | 中 | windows-sandbox-helper/src/main.rs:585 | 已知设计决策，需在矩阵 conditional 中标注 |
| DR-7 | `sandboxed-bash-mcp` 使用 `{ ...process.env }` 仅删除 `ELECTRON_RUN_AS_NODE`，所有其他环境变量透传至沙箱 | 高 | resources/sandboxed-bash-mcp/sandboxed-bash-mcp.mjs:197-202 | ENV-02 测试覆盖；长期应补入 safeKeys 白名单过滤 |
| DR-8 | Windows helper (`env.rs`) 无独立 safeKeys 白名单，以 `std::env::vars()` 全量继承再修改 | 中 | windows-sandbox-helper/src/main.rs:256, env.rs:100-135 | ENV-03 测试覆盖；与 DR-7 一起作为 env 安全专项跟进 |

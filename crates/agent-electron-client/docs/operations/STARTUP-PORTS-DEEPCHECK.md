# Deepcheck：启动端口与统一 Bash 实现

## 1. 实现范围

- **shared/startupPorts.ts**：端口默认值、配置键、`resolvePortsFromSettings(getSetting)`、`getPortsToCheck(ports, includeVite)`
- **main/services/startupPorts.ts**：`getConfiguredPorts()`、`getPortList()`、`checkPortsInUse()`、`isPortInUse()`（bash 优先，Windows 回退 cmd+netstat）
- **scripts/tools/check-port.sh**：单端口占用检查（netstat/lsof），供 bash 执行
- **scripts/tools/check-startup-ports.js**：CLI，读 DB、解析端口、调用 bash+check-port.sh 或回退 Node 内联

---

## 2. 正确性

### 2.1 三处脚本逻辑一致性

| 位置 | 来源 | 端口参数 | Windows 分支 | Unix 分支 | 输出/exit |
|------|------|----------|--------------|-----------|-----------|
| **check-port.sh** | 文件 | `$1` | cmd //c "netstat -ano \| findstr \":${port} \"" | lsof -t -i ":${port}" | 占用: exit 0 + echo PID；未占用: exit 1 |
| **main CHECK_PORT_SCRIPT** | 内嵌字符串 | `$1` | 同上（\\":$1 \\" 在 JS 中产生 \":$1 \"） | lsof -t -i ":$1" | 同左 |
| **脚本** | 读 check-port.sh | spawnSync(..., '_', port) | 由 .sh 决定 | 由 .sh 决定 | 同左 |

- **结论**：.sh 与内嵌脚本语义一致；端口均通过 `$1` 传入，无注入（端口为数字的 String(port)）。
- **已修复**：CLI 原先用 `execSync(bashPath, [args], options)`，Node 的 `execSync` 仅支持 `(command, options)`，第二个参数被当成 options，导致 bash 未按参数执行。已改为 `spawnSync(bashPath, ['-c', scriptContent, '_', String(port)], options)`。

### 2.2 配置解析（shared + 脚本）

- **step1_config**：`step1?.agentPort ?? default`、`step1?.fileServerPort ?? default`。若 DB 存的是 `{}` 或缺失，则用默认值；若 `agentPort: 0`，会得到 0（端口 0 在部分系统上表示“任选”，可能不符合预期，见 4.1）。
- **mcp_proxy_port**：兼容 number 与 string；`parseInt` 失败或非整数时用默认值。
- **脚本 DEFAULTS**：与 shared/constants 数值一致，需人工与 shared 同步（见 4.2）。

### 2.3 端口占用结果

- **spawnSync**：`status === 0` 表示脚本 exit 0（端口占用）；stdout 取首行/最后一列解析 PID；空 stdout 时 `inUse: true, pid: undefined`，行为合理。
- **回退路径**（Windows 无 bash / 脚本无 .sh）：main 用 `execSync` + cmd；脚本用 `execSync` + shell: true（或 lsof），行为与之前一致。

---

## 3. 平台与环境

### 3.1 Windows

- **有 prepare-git**：`getBundledGitBashPath()` 返回 `resources/git/bin/bash.exe`（或 usr/bin），main 与 CLI 均用该 bash 执行脚本；脚本内 `OSTYPE=msys*`，走 cmd+netstat+findstr，一致。
- **无 prepare-git**：main 回退 cmd+netstat；脚本 `winBashPath` 不存在则回退 Node netstat，逻辑一致。
- **路径**：DB 路径 `%USERPROFILE%\.nuwaclaw\`；脚本中 sqlite3 路径用正斜杠归一化，避免反斜杠转义问题。

### 3.2 macOS / Linux

- main 与脚本均用系统 `bash`；脚本来自文件或内嵌，均包含 `$OSTYPE` 判断，非 msys/cygwin 走 lsof。
- **无 bash**（如 Alpine 仅 ash）：`spawnSync('bash', ...)` 会失败，当前实现将 `status !== 0` 视为未占用并返回 `inUse: false`，属保守回退，可接受；若需严格“未知”可再区分 error/status。

### 3.3 check-port.sh 被读入后的执行

- 通过 `bash -c "<scriptContent>"` 执行时，首行 `#!/usr/bin/env bash` 被当作注释（`#` 起头），不影响执行，无需 strip。

---

## 4. 边界与改进建议

### 4.1 端口合法性

- 当前未校验端口范围（1–65535）及 0。若配置了 `agentPort: 0` 或错误大数，会直接传给 `startComputerServer`/lsof/netstat。
- **建议**：在 `resolvePortsFromSettings` 或调用方对端口做范围校验，非法时回退默认或报错。

### 4.2 脚本与 shared 同步

- **check-startup-ports.js** 的 DEFAULTS/LABELS 与 shared/constants、shared/startupPorts 需人工同步；脚本无法 require 编译后的 shared。
- **建议**：在脚本顶部注释中写明“与 shared/startupPorts.ts、constants 保持一致”；或考虑 build 时生成一份 ports-defaults.json 供脚本读取（可选）。

### 4.3 错误与超时

- `spawnSync` 未设 timeout；若 bash 或子命令卡住会阻塞。
- **建议**：若需在 UI 或敏感路径调用，可加 `timeout` 选项或异步封装。

### 4.4 安全性

- 端口来自配置或常量，`String(port)` 后传入 spawn，无用户自由输入，无命令注入风险；脚本内 `$1` 仅用于端口，且由调用方控制。
- sqlite3 的 key 做单引号转义，key 来自内部常量，风险可控。

---

## 5. 调用链与依赖

- **startup.ts**：`getConfiguredPorts().agent` → ComputerServer 端口。
- **serviceManager.ts**：`getConfiguredPorts().fileServer` → File Server 端口。
- **processHandlers.ts**：动态 import `getConfiguredPorts`，取 `fileServer` → 重启时的 File Server 端口。
- **dependencies.ts**：导出 `getBundledGitBashPath()`，供 main startupPorts 使用；prepare-git 仅 Windows 下载并解压 Git 到 `resources/git/`。

---

## 6. 测试建议

- **单元**：`resolvePortsFromSettings` 用 mock getSetting 测默认值、step1 部分键、mcp 为 number/string/非法。
- **集成**：在 macOS 上运行 `npm run check-ports` 与 `npm run check-ports:dev`，确认有 bash + check-port.sh 时输出与 exit code 正确；关闭应用后再次检查，确认“未占用”与 exit 0。
- **Windows**：在装有 prepare-git 与未装两种情况下各跑一次 CLI，确认有 bash 时走脚本、无时走 netstat 回退。

---

## 7. 小结

| 项 | 状态 |
|----|------|
| 三处脚本逻辑一致（.sh / 内嵌 / CLI 调用方式） | ✅ 一致 |
| CLI 使用 spawnSync 传参（原 execSync 误用已修复） | ✅ 已修复 |
| 配置解析与默认值 | ✅ 合理，0 与范围未校验见 4.1 |
| Windows 有/无 bash 回退 | ✅ 正确 |
| Unix 使用 bash，无 bash 时保守回退 | ✅ 可接受 |
| 安全与注入 | ✅ 端口与 key 受控 |
| 改进点 | 端口范围校验、DEFAULTS 同步方式、可选 timeout |

---

*Deepcheck 完成；CLI 中 execSync 误用已改为 spawnSync。*

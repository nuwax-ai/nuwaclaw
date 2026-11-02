# Code Review：启动端口聚合实现

## 1. 总体评价

- **聚合度**：端口默认值、配置键、解析规则集中在 `shared/startupPorts.ts`；主进程通过 `main/services/startupPorts.ts` 对接 DB 与 lsof/netstat，启动与重启均使用 `getConfiguredPorts()`，逻辑集中、无散落硬编码。
- **可维护性**：新增/修改端口只需改 shared 默认值与解析，main 与脚本行为一致。
- **安全性**：端口来自配置或常量，`execSync` 仅传入数字端口，无 shell 注入风险；脚本内 SQL 的 key 仅用内部常量并做引号转义。

---

## 2. 文件审阅

### 2.1 `src/shared/startupPorts.ts`

| 项 | 结论 |
|----|------|
| **step1 解析** | `step1?.agentPort ?? default` 正确；若 DB 存的是字符串或空对象会回退默认值。 |
| **mcp 解析** | 兼容 `number` / `string`，`parseInt` 失败用默认值，逻辑正确。 |
| **类型** | `GetSettingFn`、`StartupPorts` 清晰，便于 main/测试复用。 |
| **STORAGE_KEYS** | 与 `constants.ts` 一致，避免键名硬编码。 |

**可选增强**：若将来需要严格校验，可对端口做范围检查（1–65535）并在解析后统一校验。

---

### 2.2 `src/main/services/startupPorts.ts`

| 项 | 结论 |
|----|------|
| **getConfiguredPorts()** | 在 `readSetting` 可用后调用（startup 在 DB 初始化之后），无时序问题。 |
| **isPortInUse** | `port` 为 number，拼接进命令安全；Windows 使用 `:${port} ` 带空格，避免 60001 误匹配 600011。 |
| **多 PID** | `lsof -t` 可能多行，只取第一行 PID 足够用于“是否占用”判断。 |
| **异常** | `execSync` 失败时 catch 返回 `{ inUse: false }`，避免进程崩溃。 |

**跨平台**：Windows 用 netstat + findstr，且必须传 `shell: process.env.ComSpec || 'cmd.exe'` 才能正确解析管道与 `2>nul`；macOS/Linux 用 lsof（单命令无需 shell）。netstat 输出取首行最后一列作为 PID；行尾为 `\r\n` 时用 `split(/\r?\n/)` 兼容。

---

### 2.3 `scripts/tools/check-startup-ports.js`

| 项 | 结论 |
|----|------|
| **与 shared 一致** | 默认值、键名、解析顺序与 `shared/startupPorts.ts` 一致，注释已说明需同步修改。 |
| **getSetting** | 使用 `key.replace(/'/g, "''")` 转义，key 仅来自内部常量，安全。 |
| **DB 不存在** | 使用默认端口并打日志，行为合理。 |
| **sqlite3 不可用** | 若 `resolvePortsFromSettings` 内调用 getSetting 时 `execSync('sqlite3 ...')` 抛错（如未安装 sqlite3），main() 的 try/catch 会捕获并回退默认端口 + 提示“读取 DB 失败”。 |

**已做修改**：删除未使用的 `projectRoot`；为 key 做 `String(key)` + 引号转义并加注释；DB 存在但读取失败时统一走默认端口并打明确日志。

---

### 2.4 调用方

| 位置 | 用法 | 结论 |
|------|------|------|
| **startup.ts** | `getConfiguredPorts().agent` 作为 ComputerServer 端口 | 正确，在 DB 已初始化后调用。 |
| **serviceManager.ts** | `getConfiguredPorts().fileServer` 启动 File Server | 正确；其余仍用 step1Config（workspaceDir 等）无重复。 |
| **processHandlers.ts** | 动态 `import('../services/startupPorts')` 后取 `fileServer` | 正确，避免循环依赖。 |

---

## 3. 边界情况

- **step1_config 为 null/undefined**：解析得到全部默认端口，符合预期。
- **mcp_proxy_port 为非法字符串**：`parseInt` 得 NaN，使用默认 18099。
- **端口被占用**：由各服务自己的 `listen()` 报 EADDRINUSE；`checkPortsInUse` / 脚本仅做启动前检查与提示。
- **Windows 无 lsof**：使用 netstat，逻辑正确；脚本与 main 一致。

---

## 4. Windows 兼容性（已落实）

| 项 | 说明 |
|----|------|
| **管道与 shell** | 主进程与脚本在 Windows 上执行 netstat 与 findstr 管道命令时，必须传入 `shell: true`（脚本）或 `shell: process.env.ComSpec \|\| 'cmd.exe'`（main，满足 @types/node 的 shell: string），否则管道不生效。 |
| **PID 解析** | netstat 输出可能多行（IPv4/IPv6），取首行并用 `split(/\s+/).pop()` 取最后一列作为 PID；行分隔用 `/\r?\n/` 兼容 CRLF。 |
| **findstr 无匹配** | 无匹配时 exit code 1，execSync 抛错，catch 后返回 inUse: false，行为正确。 |
| **DB 路径** | 脚本用 `path.join(home, '.nuwaclaw', 'nuwaclaw.db')`，Windows 为 `%USERPROFILE%\\.nuwaclaw\\nuwaclaw.db`；调用 sqlite3 时路径可转为正斜杠以规避反斜杠转义，且 Windows 下传 `shell: true` 便于执行 sqlite3.cmd。 |
| **sqlite3** | Windows 上多数环境未预装 sqlite3，脚本读 DB 失败时已回退到默认端口并提示。 |

---

## 5. 建议（可选）

1. **端口范围**：若需严格校验，可在 `resolvePortsFromSettings` 返回前或 `startComputerServer`/`startFileServer` 前统一校验 `1 <= port <= 65535`。
2. **脚本与 shared 同步**：修改 `shared/startupPorts.ts` 的默认值或键时，记得同步改 `scripts/tools/check-startup-ports.js` 的 DEFAULTS/LABELS 和键名；必要时可考虑从 build 产物 require 解析逻辑以彻底单源（需解决 path alias 与运行环境）。
3. **IPC 暴露**：若需要“设置页一键检查端口”，可在 preload 暴露 `startup:getConfiguredPortsWithStatus`，由渲染进程调 main 的 `getConfiguredPortsWithStatus(includeVite)` 并展示结果。

---

## 6. 小结

实现满足“逻辑尽量聚合”的目标，类型与异常处理合理，调用关系清晰。本次 review 中已做的小改动：脚本去掉未使用变量、key 转义与注释、DB 存在但读取失败时的回退与日志。其余为可选增强，可按需再做。

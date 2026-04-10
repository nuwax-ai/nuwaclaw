# Agent 开发指南

## Agent 输出规则

**优先使用中文输出**：回复用户、编写注释与文档、解释逻辑与方案时，默认使用中文；仅在专有名词、代码、命令、配置键名等保持英文。

---

## 项目概览

**Nuwax Agent** Electron 客户端：多引擎 AI 助手（通过 ACP 支持 claude-code / nuwaxcode）。跨平台、本地运行并可选沙箱，支持 IM（Telegram / Discord / 钉钉 / 飞书），持久化偏好。沙箱支持：Docker / WSL / Firejail。

---

## 架构

- **主进程**：窗口、托盘、SQLite、引擎管理（ACP）、沙箱管理、IM 网关、进程清理、40+ IPC、上下文隔离。
- **渲染进程**：React 18 + Ant Design，仅通过 IPC 通信。状态通过 React Context + useState + IPC + SQLite 管理（无 Redux）。

---

## 服务

**主进程**（`src/main/services/`）：统一 Agent `engines/unifiedAgent.ts`，ACP `engines/acp/`，引擎管理，依赖/Shell/工作区 `system/`，MCP/包定位/管理 `packages/`，Computer Server `computerServer.ts`。

**渲染进程**（`src/renderer/services/`）：Setup/认证/AI，文件服务/Lanproxy/Agent Runner，沙箱/权限/技能/IM/调度/日志/API。

**组件**（`src/renderer/components/`）：EmbeddedWebview、SetupWizard、SetupDependencies、ClientPage、SettingsPage、DependenciesPage、AgentSettings、AgentRunnerSettings、MCPSettings、LanproxySettings、SkillsSync、IMSettings、TaskSettings。

---

## 统一 Agent 与引擎

- **引擎**：claude-code → `claude-code-acp-ts`（npm 本地包，无参数），nuwaxcode → `nuwaxcode acp`（npm 本地包，参数：`['acp']`）。二者均通过 stdin/stdout 使用 ACP/NDJSON。
- **架构**：UnifiedAgentService（统一入口、事件总线）→ AcpEngine（会话、同步/异步 prompt、权限、MCP 注入、SSE）。
- **用法**：`agentService.init({ engine, apiKey, model, workspaceDir, env?, mcpServers? })` → `createSession` → `prompt` / `promptAsync` → `on('message.updated'|'permission.updated')` → `respondPermission` → `destroy`。详见 `unifiedAgent.ts`。
- **隔离**：`PATH`/`NODE_PATH` 指向 `~/.nuwaclaw`，`HOME` 等设为 `/tmp/nuwaclaw-run-*`，API 密钥通过环境变量注入。
- **会话过滤**：`listAllSessionsDetailed()` 仅返回 `isReady` 为 true 的引擎会话，避免崩溃/终止的 ACP 进程污染活跃会话列表。

---

## 沙箱与权限

- **沙箱**：macOS Docker/App Sandbox，Windows Docker/WSL，Linux Docker/Firejail。`sandboxManager.init({ enabled, workspaceDir })` → `execute(cmd, args)`。见 `sandbox.ts`。
- **权限**：tool:read/file:read → 直接放行；tool:edit/file:write/command:bash/network:http → 需用户确认。`permissionManager.checkPermission(...)` / `approveRequest(...)`。见 `permissions.ts`。

---

## 依赖与路径

- **必需**：uv（随包分发）、nuwax-file-server、claude-code-acp-ts、nuwaxcode、nuwax-mcp-stdio-proxy（均为 npm 本地包）。Node 由 Electron 提供。
- **数据目录**：`~/.nuwaclaw/`（engines、workspaces、node_modules、bin、logs、nuwaclaw.db）。不使用 `app.getPath('userData')`。
- **环境**：子进程会注入 `PATH`（含 `.nuwaclaw/node_modules/.bin`、`resources/uv/bin`）和 `NODE_PATH`。见 `system/dependencies.ts` 中 `getAppEnv()`。
- **随包资源**：`resources/uv/bin/uv`（打包后路径：`process.resourcesPath`）。

---

## 会话与工作区

一个会话对应一个工作区。工作区目录由用户指定，保存前校验，随后供引擎使用。

---

## MCP 代理与容错

- **日志**：MCP 代理写入 `MCP_PROXY_LOG_FILE`（默认 `~/.nuwaclaw/logs/mcp-proxy.log`）。Electron 通过 `fs.watchFile` 尾随并转发到 electron-log。由 `McpProxyManager.start/stop` 控制。
- **ResilientTransport**：基于 URL 的 MCP 使用 20s 心跳，连续 3 次失败后重连，指数退避上限 60s，请求队列上限 100。

---

## 日志

使用 **electron-log v5**，按天轮转。配置在 `src/main/bootstrap/logConfig.ts`。

- **日志目录**：`~/.nuwaclaw/logs/main.YYYY-MM-DD.log`，并有 `latest.log` 符号链接。
- **级别**：文件 → debug/info，控制台 → debug。
- **保留**：生产 7 天，开发 30 天。
- **PERF 性能日志**：独立文件 `perf.YYYY-MM-DD.log`，详见 [docs/PERF-LOG-REFACTOR-2026-03-24.md](docs/PERF-LOG-REFACTOR-2026-03-24.md)

---

## 注册同步与启动顺序

- **注册**：`POST /api/sandbox/config/reg`，`registerClient()`（core/api.ts），`syncConfigToServer()`（core/auth.ts）。同步端口等，返回写入 `lanproxy_config` 的 `serverHost`/`serverPort`。**必须在启动 lanproxy 之前调用。**
- **统一流程**：**reg** → mcpProxy → agent → fileServer → lanproxy（reg 在所有服务启动之前完成）
- **场景**：
  - 登录 → loginAndRegister → **reg** → 启动所有服务
  - 启动全部 → **reg** → 启动所有服务
  - 手动启动单个 → 直接启动（不调用 reg）
  - 自动重连 → **reg** → 启动所有服务
- **注册参数**：username、password、savedKey?、sandboxConfigValue。响应：configKey、serverHost/serverPort、online、name、**token**。
- **详细文档**：见 `docs/REG-FLOW.md`。

---

## 登录状态同步（Token → Webview Cookie）

reg 接口返回的 `token` 用于同步登录状态到 webview，实现桌面端与 web 端的登录打通。

### 流程

```
reg 接口返回 token
  ↓
1. 保存到 AUTH_TOKEN（持久化）      ← 给后续打开 webview 用
  ↓
2. 尝试立即同步到 webview cookie（name="ticket"）
  ↓
  ├─ 成功 → 清除 AUTH_TOKEN        ← 已消费，清空
  │
  └─ 失败 → 保留 AUTH_TOKEN        ← 等 webview 打开时再同步
```

### 触发点

| 函数 | 场景 | 文件 |
|------|------|------|
| `loginAndRegister` | 用户登录 | `core/auth.ts` |
| `reRegisterClient` | 自动重注册 | `core/auth.ts` |
| `syncConfigToServer` | 配置同步 | `core/auth.ts` |
| `syncCookieAndBuildUrl` | 打开 webview（兜底） | `utils/sessionUrl.ts` |

### 核心函数

- **`syncSessionCookie(domain, token)`**：将 token 写入 webview cookie（name="ticket"），不设 domain（host-only），不设 secure（主进程根据 URL scheme 自动判断）
- **`syncCookieAndBuildUrl()`**：打开 webview 前同步 token。有 token → 检查 JWT exp 是否过期（30s 宽限容忍时钟偏移）→ 未过期则覆盖 cookie；已过期则只清除对应来源缓存并跳过；无 token → 跳过（不清空）
- **`persistTicketCookie(domain)`**：webview 内登录成功后，将 ticket cookie 刷盘并清除 settings 中所有旧 token 缓存（`AUTH_TOKEN` + domain key），防止下次打开 webview 时旧缓存覆盖新 ticket

### 安全考虑

- token 不长期驻留内存，同步成功后立即清除
- 日志中不记录敏感 token 值
- 失败时保留 token 以便重试，但不影响用户体验
- Cookie 属性：host-only（不设 domain，避免 count=2）、httpOnly、secure 由主进程根据 URL scheme 自动判断
- 过期 token 清除精确到来源（one-shot 清 `AUTH_TOKEN`，domain cache 清 domain key），避免误清另一个有效缓存

---

## 进程清理

退出时顺序：agentService.destroy → Agent Runner → Lanproxy → File Server → MCP Proxy → 引擎进程 → DB。主进程变量：agentRunnerProcess（`agentRunner:*`）、lanproxyProcess（`lanproxy:*`）、fileServerProcess（`fileServer:*`）。引擎通过 IPC `agent:init` / `agent:destroy` / `agent:serviceStatus` 通信。

---

## 测试

使用 **Vitest**。主进程、渲染进程与共享代码中共 29+ 个测试文件，475+ 用例。

```bash
npm test              # 监听模式
npm run test:run      # 单次运行
npm run test:coverage # 带覆盖率
```

### 测试分层

| 层级 | 范围 | 说明 |
|------|------|------|
| **Unit** | 单文件/类，外部依赖 mock | 纯逻辑与状态断言 |
| **Integration** | 多模块协作 | 如 IPC handler + serviceManager |

### 可测试性设计

- **DI 模式**：如 `runManualStartService(key, deps)` 抽离依赖注入，便于 mock 和断言调用顺序
- **私有属性访问**：单测中使用 `as any` 访问私有属性（如 `engines`），生产代码通过 public 方法访问

---

## 开发

```bash
npm install && npm run dev
npm run build
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

- **跨平台打包（Mac → Win）**：支持。若出现 `zip: not a valid zip file`，清理缓存（`~/Library/Caches/electron`、`electron-builder` 或 `node_modules/app-builder-bin`）后重试。Win x64 须在 Windows/CI 上构建（原生模块跨平台编译限制）。
- **CI**：标签 `electron-v*` → `release-electron.yml`（独立 Release）。push/PR 导致路径变更 → `ci-electron.yml`（测试构建）。Tauri 仍使用 `v*` → release-tauri。本地 OSS 同步：`./scripts/sync-oss.sh <tag>`（需 gh、jq）。

**目录结构**：`src/main/`（main.ts、preload、ipc、services/engines|packages|system|utils），`src/renderer/`（main.tsx、App、components、services、styles），`src/shared/`，`resources/uv/`，`scripts/`，`docs/`（项目文档如 TESTING-0.9.1-2026-03-19.md）。别名：`@main/*` → main，`@renderer/*` → renderer，`@shared/*` → shared。

---

## 配置与平台

- **敏感配置存于 SQLite**（明文，未加密）：anthropic_api_key、default_model、server_host。
- **兼容性**：多引擎 / 沙箱(Docker) / IM / 托盘 / 无命令行弹窗 — 全平台。WSL 仅 Windows。Firejail 仅 Linux。

---

## 国际化（i18n）规则

### 多语言机制

- **Locale 文件**：`src/shared/locales/` 下 4 个文件（en-US、zh-CN、zh-HK、zh-TW），key 必须完全对齐。
- **翻译函数**：renderer 用 `t(key, ...values)`（`src/renderer/services/core/i18n.ts`），主进程用 `t(key)`（`src/main/services/i18n.ts`）。
- **Key 格式**：`{Client}.{Scope}.{Domain}.{key}`，如 `Claw.Auth.error.loginExpired`。
- **占位符**：位置占位符 `t(key, arg1, arg2)` → `{0}` `{1}`；命名占位符 `t(key, {error: "xxx"})` → `{error}`。
- **I18N_KEYS 常量**：`src/shared/constants.ts` 中集中定义，避免拼写错误。新增 locale key 时须同步更新此常量。

### 启动初始化命中逻辑（新客户端）

1. **并行初始化**：`src/renderer/main.tsx` 启动时并行执行 `initSupportedLangs()` 与 `initI18n()`。
2. **动态语言列表**：`src/renderer/services/i18n.ts` 调 `/api/i18n/lang/list`，按当前接口格式读取 `data[].lang`，仅纳入 `status === 1` 的语言，合并到 `i18next.supportedLngs`。`fetchI18nLangList()` 使用 Promise 缓存，避免多处调用重复请求。
3. **当前语言来源**：`src/renderer/services/core/i18n.ts` 优先用缓存 `i18n.active_lang`，无缓存则用 `navigator.language`。`navigator.language` 为 BCP 47 格式（如 `en-US`、`zh-CN`、`zh-TW`、`zh-HK`），内部统一转小写比较（如 `zh-tw`）。
4. **主进程语言优先级**：`src/main/main.ts` 在 `app.whenReady()` 后同步语言，优先级：本地保存（`i18n.active_lang`）> Electron 系统语言（`app.getLocale()`）> 英文兜底（`"en"`）。
5. **主进程同步**：`initI18n()` 完成后，渲染进程会通过 `window.electronAPI.i18n.setLang()` 同步主进程语言，保证托盘/对话框与页面语言一致。
6. **antd locale 命中**：优先精确命中 `zh-tw` / `zh-hk`，再落到泛中文 `zh`，避免繁体用户被错误命中简体组件文案。

### 语言切换流程

1. **预拉取**：`handleLangConfirm()` 调 `prefetchLangMap(lang)` 与 `minLoadingDelay` 并行，将目标语言翻译缓存到 DB（`Promise.allSettled`，失败不阻塞）。
2. **reload**：页面刷新后 `_doInitI18n()` 从 DB 缓存读取翻译，无需等待网络。
3. **非本地 locale 文件的语言**（如日语）：无本地 JSON 文件，`getLocaleMap()` 回退 `enUS`。依赖 DB 缓存提供翻译。首次切换时 `prefetchLangMap` 确保缓存已写入。
4. **中文反向映射**：非中文语言使用本地 `zh-CN.json` 构建反向映射（`buildZhValueToKeyMap`），不再额外请求 `query?lang=zh-cn`。

### 日志 vs UI 的语言规则

| 场景 | 函数 | 语言要求 | 是否走 i18n |
|------|------|----------|------------|
| 日志文件输出 | `log.*()` / `logger.*()` / `perfLog()` | **仅英文** | 否 |
| UI 提示 | `message.*()` / `notification.*()` | **跟随用户语言** | 是（`t()`） |
| 错误消息展示 | `getAuthErrorMessage()` 等 | **跟随用户语言** | 是（`t()`） |
| 错误消息抛出 | `throw new Error()` / `reject()` | **英文**（可能被 catch 后记入日志） | 否 |
| HTTP 响应 message | `{ code: "0000", message: "..." }` | **英文**（API 协议） | 否 |
| CSV 导出表头 | `exportLogs()` | **跟随用户语言** | 是（`t()`） |
| 权限默认名称 | `DEFAULT_CONFIG.rules` | **跟随用户语言** | 是（`t()`） |

### 权限相关命名空间

| Namespace | Keys | 用途 |
|-----------|------|------|
| `Claw.Permissions.*` | command/envVars/file/tool/url/second/deny/allowOnce/allowAlways | 权限弹窗内的按钮标签、描述文本 |
| `Claw.PermissionRules.*` | defaultToolRead/Edit/Bash/defaultNetwork/FileRead/FileWrite | 默认权限规则名称（DEFAULT_CONFIG.rules） |
| `Claw.PermissionsPage.*` | title/description/refresh/openSettings/allGranted/cannotOpenSettings + macosAccessibility/Desc等 | 权限设置页面 UI + macOS 系统权限项名称/描述 |

**避免混用**：代码中引用时须与 locale key 命名空间严格对应，不可交叉使用。

### 核心原则

1. **logger 输出只用英文，不进 locale 文件**。日志是开发者工具，应保持语言一致性。
2. **用户可见的 UI 文本必须走 `t()`**，包括 `message.success/error/info/loading`、按钮标签、表单提示等。
3. **新增 locale key 时**：4 个 locale 文件 + `I18N_KEYS` 常量 + 代码中 `t()` 调用，三者同步。
4. **主进程中的用户可见文案**（如 `MCP_RECONNECT_PROMPT_MESSAGE`）通过主进程 `t()` 走 i18n，避免硬编码英文。
5. **调试工具组件不接入 i18n**：`src/renderer/components/dev/` 下的调试工具面板（如 `DevToolsPanel.tsx`）仅在开发模式加载，所有 UI 文案硬编码英文，不走 `t()`，不在 locale 文件中维护对应 key。

*最后更新：2026-04-10*

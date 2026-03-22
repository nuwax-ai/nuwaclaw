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

---

## 注册同步与启动顺序

- **注册**：`POST /api/sandbox/config/reg`，`registerClient()`（core/api.ts），`syncConfigToServer()`（core/auth.ts）。同步端口等，返回写入 `lanproxy_config` 的 `serverHost`/`serverPort`。**必须在启动 lanproxy 之前调用。**
- **统一流程**：**reg** → mcpProxy → agent → fileServer → lanproxy（reg 在所有服务启动之前完成）
- **场景**：
  - 登录 → loginAndRegister → **reg** → 启动所有服务
  - 启动全部 → **reg** → 启动所有服务
  - 手动启动单个 → 直接启动（不调用 reg）
  - 自动重连 → **reg** → 启动所有服务
- **注册参数**：username、password、savedKey?、sandboxConfigValue。响应：configKey、serverHost/serverPort、online、name。
- **详细文档**：见 `docs/REG-FLOW.md`。

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

**目录结构**：`src/main/`（main.ts、preload、ipc、services/engines|packages|system|utils），`src/renderer/`（main.tsx、App、components、services、styles），`src/shared/`，`src/test/harness/`（日志驱动测试工具），`resources/uv/`，`scripts/`，`docs/`（项目文档如 TESTING-0.9.1-2026-03-19.md）。别名：`@main/*` → main，`@renderer/*` → renderer，`@shared/*` → shared。

---

## 配置与平台

- **敏感配置存于 SQLite**（明文，未加密）：anthropic_api_key、default_model、server_host。
- **兼容性**：多引擎 / 沙箱(Docker) / IM / 托盘 / 无命令行弹窗 — 全平台。WSL 仅 Windows。Firejail 仅 Linux。

*最后更新：2026-03-19*

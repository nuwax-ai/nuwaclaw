# Agent Mode Workbench Plan

## Summary
- 基于 `origin/feature/electron-client-0.11` 新建独立 git worktree 实施，不碰当前 `feature/electron-client-0.12` 脏工作区。
- NuwaClaw 新增顶部右侧 `Agent Mode` 入口，本地渲染一个与 nuwax PC Web `/app/{agentId}` 等价的工作台。
- NuwaClaw 只做宿主：登录、token、窗口壳、本地服务启动、Open Editor；`/app` 业务与会话执行全部走 Nuwax 远端 API。
- 为小侵入和后续复用，新建独立 workspace 包 `crates/agent-workbench`，NuwaClaw 只接入这个包。

## Key Changes
- Worktree:
  - 创建 `codex/agent-workbench-0.11` from `origin/feature/electron-client-0.11`。
  - 建议路径：`/Users/apple/workspace/nuwaclaw-agent-workbench-0.11`。
- 新包 `crates/agent-workbench`:
  - 保真迁移 nuwax `/app` 核心结构：`OpenApp/BaseTemplate`、`AppDetails`、`HistoryConversation`、会话详情、输入框、历史列表、消息流、权限卡片、页面预览入口。
  - 包内自带必要 assets/icons/tokens 和最小 zh/en 字典。
  - 保留 Less 风格，必要依赖可加，但限制在 workbench 包或 electron-client 构建接入范围内。
  - 不引入 Umi 运行时；提供包内兼容层承接 `history/useParams/useLocation/useRequest/request/useModel`。
- NuwaClaw 接入：
  - `App.tsx` 只新增 Agent Mode 状态、顶部入口、渲染 workbench、退出回正常页面。
  - `electron-client` 只新增 workspace dependency、少量构建支持、认证桥和 Open Editor 回调。
  - 不改现有 `SessionsPage`、服务状态轮询、agent IPC 会话逻辑。
- 远端 API adapter:
  - API base 使用当前登录域名 `auth.userInfo.currentDomain`。
  - Bearer token 使用 `/reg` 返回并缓存的 token，兼容 nuwax `ACCESS_TOKEN` 请求语义。
  - 复用 nuwax endpoints：`/api/published/agent/{appAgentId}`、`/api/agent/conversation/list`、`/api/agent/conversation/create`、`/api/agent/conversation/{id}`、`/api/agent/conversation/message/list`、`/api/agent/conversation/chat` SSE、stop/suggest/model/options 等。
- ID contract:
  - 不再使用 `SandboxConfigDto.id` 作为 `/app` agentId。
  - 支持 `/reg` 返回 `appAgentId`，并持久化到 auth/workbench config。
  - 后端未就绪时提供临时设置项或环境项兜底 `appAgentId`，用于联调。
- 页面预览:
  - 主 `/app` UI 本地重写。
  - 自定义页面和 page preview 使用 Electron `<webview>` 加载远端页面，以兼容 cookie、CSP、跳转和下载。
- `Open Editor`:
  - 优先尝试用本地 IDE 打开当前 workspace，建议顺序：Cursor/VS Code 可用则打开，否则 fallback 到 `shell.openPath(workspaceDir)`。

## Public Interfaces
- `@nuwax-ai/agent-workbench` 暴露：
  - `AgentWorkbench`
  - `AgentWorkbenchProvider`
  - `createWebApiAdapter`
  - `WorkbenchHostBridge`
  - `AgentWorkbenchConfig`
- `AgentWorkbenchConfig` 至少包含：
  - `baseUrl`
  - `accessToken`
  - `appAgentId`
  - `workspaceDir`
  - `locale`
  - `previewContainer: "electron-webview"`
- NuwaClaw auth 类型扩展：
  - `AuthUserInfo.appAgentId?: number`
  - `/reg` response type 增加 `appAgentId?: number`

## Test Plan
- Workbench package:
  - request adapter adds `Authorization: Bearer <token>` and baseUrl correctly.
  - Umi compat history handles `/app/:agentId`、`/app/chat/:agentId/:id`、`/app/history/conversation/:agentId`。
  - SSE parser handles message chunk、thought chunk、final、error、permission events.
- NuwaClaw renderer:
  - 顶部 Agent Mode 入口在有 `appAgentId` 或兜底配置时可进入。
  - 无 `appAgentId` 时显示明确配置缺失状态。
  - Open Editor fallback 链路可用。
  - 退出 Agent Mode 不影响原侧边栏、设置页、Sessions 页。
- Build/check:
  - `npm run build:renderer`
  - `npm run test:run`
  - 对 `/app` 主链路手动验收：加载详情、新建会话、发送消息、流式输出、停止、历史列表、历史详情、权限处理、页面预览。

## Assumptions
- 本次只改 NuwaClaw，不改 `workspace/nuwax` PC Web。
- `crates/agent-workbench` 先在 NuwaClaw 仓库内维护，后续再抽独立仓库给 NuwaClaw 和 nuwax 共用。
- “完整功能”指与 nuwax 当前 `/app/{agentId}` 等价，不额外实现不属于 `/app` 的全局管理页。
- 后端最终会提供真实 `appAgentId`；前端兜底只用于过渡联调。

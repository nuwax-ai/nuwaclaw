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

## Implementation Status

### Phase 0 — 已完成 ✅ (commit 22cdd992)
- [x] `@nuwax-ai/agent-workbench` 包骨架：types, routes, SSE, web/mock adapter, Provider, AgentWorkbench
- [x] `NuwaxOpenApp.tsx` 核心 UI（1111 行）：侧边栏、会话列表、聊天视图、历史页、权限卡片、页面预览
- [x] Electron 客户端集成：App.tsx Agent Mode 入口、auth appAgentId、workbenchHandlers、workbenchConfig
- [x] 完整 CSS 样式（响应式）
- [x] 44 个单元测试全部通过
- [x] 构建验证：typecheck + vite build + tests

---

### Phase 1 — API 与聊天增强（高优先级）✅ (commit e373725d)

#### 1.1 补充 chat body 字段
**文件**: `crates/agent-workbench/src/adapters/webApiAdapter.ts`
- `sendMessage` 请求体增加 `variableParams`, `modelId`, `agent_config.agent_mode`
- 类型 `WorkbenchSendMessageRequest` 增加可选字段：
  ```ts
  variableParams?: Record<string, unknown>;
  modelId?: string;
  agentMode?: 'ask' | 'yolo';
  attachments?: unknown[];
  skillIds?: string[];
  sandboxId?: string;
  ```

#### 1.2 Suggest 端点
**文件**: `crates/agent-workbench/src/adapters/webApiAdapter.ts`, `types.ts`
- 新增 `WorkbenchApiAdapter.getSuggestQuestions(conversationId, agentId, variableParams?)`
- 端点: `POST /api/agent/conversation/chat/suggest`
- 返回 `string[]`，用于 SSE 流结束后展示追问推荐

#### 1.3 Model Options 端点
**文件**: `crates/agent-workbench/src/adapters/webApiAdapter.ts`, `types.ts`
- 新增 `WorkbenchApiAdapter.getModelOptions(agentId)`
- 端点: `GET /api/agent/conversation/model/options/{agentId}`
- 返回 `ModelOption[]`（id, name, icon?）

#### 1.4 测试 ✅
- 新增 webApiAdapter 测试：suggest、modelOptions、sendMessage 扩展字段

---

### Phase 2 — 输入区功能补全（中高优先级）✅ (commit d0f920bf)

#### 2.1 变量表单 ✅
**文件**: 新建 `crates/agent-workbench/src/components/VariableForm/index.tsx`
- 当 `agent.variables` 非空且为新会话首条消息时，渲染表单
- 支持 inputType: `input` / `textarea` / `select` / `cascader`
- 校验 `require` 字段，收集为 `variableParams` 传入 `sendMessage`
- 从 nuwax `NewConversationSet` 保真迁移，去掉 Ant Design 依赖，用原生 form

#### 2.2 Model 选择器 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx` (内联，非独立组件)
- 调用 `getModelOptions(agentId)` 获取模型列表
- 渲染下拉选择，选中后存入 state 传入 `sendMessage` 的 `modelId`
- 替换现有 stub model chip 按钮

#### 2.3 Agent Mode 切换 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
- Ask/YOLO 按钮增加 state 管理（`agentMode`）
- 切换时更新 state，`sendMessage` 时传入 `agent_config.agent_mode`
- 样式：active 状态高亮

#### 2.4 Suggest 追问推荐 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
- SSE 流结束后调用 `getSuggestQuestions`
- 将结果渲染为推荐气泡列表（复用现有 `.open-app-recommend-list` 样式）
- 点击后直接 `sendPrompt(text)`

---

### Phase 3 — 消息渲染增强（中优先级）✅ (commit 31676e20)

#### 3.1 Markdown 渲染 ✅
**依赖**: 添加 `react-markdown` + `remark-gfm`（或 `marked`）
**文件**: 新建 `crates/agent-workbench/src/components/MarkdownRenderer/index.tsx`
- 渲染 assistant 消息中的 Markdown 内容
- 支持代码块高亮（`highlight.js` 或 `prism`）
- 替换现有纯文本 `<pre>` 渲染

#### 3.2 消息分页（延后）
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
- `getConversation` 支持分页参数
- 聊天区顶部 Intersection Observer 触发加载更多
- `MESSAGE_PAGE_SIZE = 10`
- **状态**: 延后实现，需要后端 API 支持分页参数

---

### Phase 4 — 页面预览增强（中优先级）✅ (commit pending)

#### 4.1 Electron Webview 集成
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
- `PagePreviewIframe` 已支持 `previewContainer === 'electron-webview'` 时使用 `<webview>` 标签
- preload bridge IPC (cookie 注入、CSP 绕过、下载拦截) 需后续 Electron preload 层配合

#### 4.2 自定义页面菜单自动打开 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
- Agent detail 加载后检查 `agent.customPageMenus[].selected === true`，自动调用 `openPreview(path)`
- sessionStorage key `openApp:autoOpenedDefaultPage:{agentId}` 避免重复打开

#### 4.3 可调分割布局 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`, `styles.css`
- `splitRatio` state (0.25–0.75) 控制 grid-template-columns 动态比例
- 鼠标拖拽 `open-app-split-handle` 分隔条实时调整宽度
- 拖拽时禁用文本选择和设置 col-resize cursor

---

### Phase 5 — 深度链接与高级功能（低优先级）✅ (commit pending)

#### 5.1 URL 参数注入 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
- 解析 `?params=` JSON 或 `?prompt=`/`?message=` 查询参数
- 预填 `variableParams` 和 `prompt`，agent 加载后自动应用
- `urlParamsAppliedRef` 防止重复应用

#### 5.2 文件上传 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`, `styles.css`
- `ChatInputHome` 增加隐藏 `<input type="file" multiple>` 和点击触发
- 文件列表预览：文件名、大小、移除按钮
- `attachments` state 传入 `sendMessage` 的 `attachments` 字段
- **注意**: 后端 multipart upload 端点就绪后，需将 File 对象转为上传后的 URL/ID

#### 5.3 @ 技能提及 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`, `styles.css`
- @ 按钮点击弹出技能列表下拉（`showSkillList` state）
- 选中技能以 chip 形式展示，可移除
- `selectedSkillIds` 传入 `sendMessage` 的 `skillIds` 字段
- 技能列表数据待后端 API 就绪后填充

---

## Phase 优先级与排期

| Phase | 优先级 | 状态 | 依赖 |
|-------|--------|------|------|
| Phase 1: API 增强 | P0 | ✅ 完成 | 无 |
| Phase 2: 输入区功能 | P0 | ✅ 完成 | Phase 1 |
| Phase 3: 消息渲染 | P1 | ✅ 完成（分页延后） | 无 |
| Phase 4: 页面预览 | P1 | ✅ 完成 | Electron IPC |
| Phase 5: 深度链接 | P2 | ✅ 完成 | Phase 1-2 |

**建议执行顺序**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

每个 Phase 完成后提交一次，保持 commit 粒度清晰。

---

## Assumptions
- 本次只改 NuwaClaw，不改 `workspace/nuwax` PC Web。
- `crates/agent-workbench` 先在 NuwaClaw 仓库内维护，后续再抽独立仓库给 NuwaClaw 和 nuwax 共用。
- “完整功能”指与 nuwax 当前 `/app/{agentId}` 等价，不额外实现不属于 `/app` 的全局管理页。
- 后端最终会提供真实 `appAgentId`；前端兜底只用于过渡联调。

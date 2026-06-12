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
  - 使用 plain CSS（`styles.css`），必要依赖可加，但限制在 workbench 包或 electron-client 构建接入范围内。
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
- [x] `NuwaxOpenApp.tsx` 核心 UI（1563 行）：侧边栏、会话列表、聊天视图、历史页、权限卡片、页面预览
- [x] Electron 客户端集成：App.tsx Agent Mode 入口、auth appAgentId、workbenchHandlers、workbenchConfig
- [x] 完整 CSS 样式（响应式）
- [x] 18 个单元测试通过（workbench 包），另含 electron-client workbenchConfig 10 个测试共 28 个
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

### Phase 2 — 输入区功能补全（中高优先级）✅ 全部完成 (commit cca382f8)

> 状态更新 (2026-06-12)：
> - 2.1 变量表单：✅ 全部 6 种类型已实现（Text/Paragraph/Number/Select/MultipleSelect/AutoRecognition），含 Cascader + PLUGIN 模式
> - 2.2 Model 选择器：✅ 完成
> - 2.3 Agent Mode 切换：✅ 完成
> - 2.4 Suggest 追问推荐：✅ 完成

> 状态更新 (2026-05-21)：
> - 2.1 变量表单：✅ 全类型组件 `VariableForm` 已建（types.ts 扩展 + Text/Paragraph/Number/Cascader），待接线 NuwaxOpenApp.tsx
> - 2.2 Model 选择器：✅ 完成
> - 2.3 Agent Mode 切换：✅ 完成
> - 2.4 Suggest 追问推荐：✅ 完成

#### 2.1 变量表单 ✅ (部分完成)
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx` (内联，行 650-714)
**nuwax 参考**: `src/components/NewConversationSet/index.tsx`，`src/types/enums/agent.ts` InputTypeEnum
- 当 `agent.variables` 非空且为新会话首条消息时，渲染表单
- 校验 `require` 字段，收集为 `variableParams` 传入 `sendMessage`
> 已补全（见上方 ✅ 状态更新）

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

### Phase 3 — 消息渲染增强（中优先级）✅ 全部完成 (commit cca382f8)

> 状态更新 (2026-06-12)：
> - 3.1 Markdown 渲染：✅ 全部完成（代码高亮/KaTeX/Mermaid/Thinking/RunOver/ExecutionPlan/OptimizedImage）
> - 3.2 消息分页：✅ 已实现 — adapter 游标分页 + IntersectionObserver + 上拉加载
> - ds-markdown 流式打字效果仍未迁移（低优先级）

> 状态更新 (2026-05-28)：
> - 3.1 Markdown 渲染：✅ react-markdown + remark-gfm + remark-math + rehype-katex + rehype-raw + prism-react-renderer 代码高亮 + 复制按钮 + 语言标签
> - Thinking 折叠 / RunOver / OptimizedImage 全部接线完成 (commit 283c2c6b SSE 路由修复)
> - 3.2 消息分页：✅ 已实现 — adapter 游标分页 + IntersectionObserver 上拉加载

#### 3.1 Markdown 渲染 ✅
**依赖**: 添加 `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-raw` + `prism-react-renderer`
**文件**: `crates/agent-workbench/src/components/MarkdownRenderer/index.tsx`
**nuwax 参考**: `src/components/MarkdownRenderer/index.tsx`（使用 `ds-markdown` 库）
- 渲染 assistant 消息中的 Markdown 内容
- 自定义渲染 `<pre>`、`<code>`、`<table>`、`<a>`、`<img>`
- ✅ 代码块语法高亮 (prism-react-renderer + CodeBlock 组件)
- ✅ KaTeX 数学公式 (remark-math + rehype-katex)
- ✅ Mermaid 图表 (MermaidBlock 组件)
- ✅ `<markdown-custom-process>` 标签 (parseSegments + RunOver 组件)
- ✅ `<task-result>` 标签 (TaskResult 组件)
- ✅ Thinking 折叠 (ThinkingBlock 组件, SSE thought 事件路由到 metadata.thinking)
- ✅ RunOver 工具可视化 (SSE PROCESSING 事件路由到 metadata.runOverSteps)
- ✅ 图片点击放大 (OptimizedImage + lightbox)
> 已补全（见上方 ✅ 状态更新）

#### 3.2 消息分页（延后）
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
**nuwax 参考**: `src/models/conversationInfo.ts`（行 580-628 消息分页）, `src/components/business-component/HistoryConversationList/ConversationList/index.tsx`（会话列表分页）
- `getConversation` 支持分页参数
- 聊天区顶部 Intersection Observer 触发加载更多
- `MESSAGE_PAGE_SIZE = 10`
- **状态**: 延后实现，需要后端 API 支持分页参数
- **nuwax 实现**:
  - 消息列表：基于 `index` 字段的游标分页，`POST /api/agent/conversation/message/list { conversationId, index, size }`，向上加载旧消息
  - 会话列表：基于 `lastId` 的游标分页，`POST /api/agent/conversation/list { agentId, lastId, limit, topic }`，滚动到底部加载更多

---

### Phase 4 — 页面预览增强（中优先级）✅ 全部完成

> 状态更新 (2026-06-12)：
> - 4.1 Electron Webview 集成：✅ 完整实现 — preload 路径、persist:workbench-preview partition、cookie 注入、token 获取、下载拦截
> - 4.2 自定义页面菜单自动打开：✅ 完成
> - 4.3 可调分割布局：✅ 完成

> 状态更新 (2026-05-21)：
> - 4.1 Webview preload bridge：✅ 主进程 IPC + preload + partition + cookie 注入 + 下载拦截全部到位
> - 4.2 自定义页面菜单自动打开：✅
> - 4.3 可调分割布局：✅

#### 4.1 Electron Webview 集成 ✅ (部分完成)
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`, `PagePreviewIframe`
- `PagePreviewIframe` 已支持 `previewContainer === 'electron-webview'` 时使用 `<webview>` 标签，fallback 到 `<iframe>`
> 已补全（见上方 ✅ 状态更新）

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

### Phase 5 — 深度链接与高级功能（低优先级）✅ 全部完成

> 状态更新 (2026-06-12)：
> - 5.1 URL 参数注入：✅ 完成
> - 5.2 文件上传：✅ 已是真实 FormData multipart 实现
> - 5.3 @ 技能提及：✅ 三 tab API 全部实现（listSkillsForAtPaged / listRecentSkills / listCollectedSkills）

> 状态更新 (2026-05-21)：
> - 5.1 URL 参数注入：✅
> - 5.2 文件上传：✅ Adapter `uploadFile` (FormData 真实 multipart) + `ChatUploadFile` 组件 + `usePasteUpload` + ChatInputHome 集成全部完成
> - 5.3 @ 技能提及：✅ Adapter 三 tab (listSkillsForAtPaged / listRecentSkills / listCollectedSkills) + `MentionPopup` 组件 + ChatInputHome 集成完成；`allowAtSkill` gate 待 types 扩展

#### 5.1 URL 参数注入 ✅
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`
- 解析 `?params=` JSON 或 `?prompt=`/`?message=` 查询参数
- 预填 `variableParams` 和 `prompt`，agent 加载后自动应用
- `urlParamsAppliedRef` 防止重复应用

#### 5.2 文件上传 ✅ (部分完成)
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`, `ChatInputHome`, `styles.css`
**nuwax 参考**: `src/components/ChatInputHome/index.tsx`（行 228-340 粘贴上传）, `src/components/ChatUploadFile/index.tsx`（文件预览）, 常量 `UPLOAD_FILE_ACTION = '/api/file/upload'`
- `ChatInputHome` 增加隐藏 `<input type="file" multiple>` 和点击触发
- 文件列表预览：文件名、大小、移除按钮
- `attachments` state 传入 `sendMessage` 的 `attachments` 字段
> 已补全（见上方 ✅ 状态更新）

#### 5.3 @ 技能提及 ✅ (部分完成)
**文件**: `crates/agent-workbench/src/components/NuwaxOpenApp.tsx`, `styles.css`
**nuwax 参考**: `src/components/ChatInputHome/MentionPopup/atSkill.ts`（API）, `MentionPopup/index.tsx`（弹窗）, `MentionEditor/index.tsx`（编辑器）
- @ 按钮点击弹出技能列表下拉（`showSkillList` state）
- 选中技能以 chip 形式展示，可移除
- `selectedSkillIds` 传入 `sendMessage` 的 `skillIds` 字段
> 已补全（见上方 ✅ 状态更新）

---

## Phase 优先级与排期

| Phase | 优先级 | 状态 | 依赖 |
|-------|--------|------|------|
| Phase 1: API 增强 | P0 | ✅ 完成 | 无 |
| Phase 2: 输入区功能 | P0 | ✅ 全部完成（6 种变量类型 + Cascader + PLUGIN） | Phase 1 |
| Phase 3: 消息渲染 | P1 | ✅ 全部完成（含分页 IntersectionObserver） | 无 |
| Phase 4: 页面预览 | P1 | ✅ 全部完成（webview preload + cookie 注入 + 下载拦截） | Electron IPC |
| Phase 5: 深度链接 | P2 | ✅ 全部完成（FormData multipart + 三 tab 技能 API） | Phase 1-2 |

**建议执行顺序**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

每个 Phase 完成后提交一次，保持 commit 粒度清晰。

---

## nuwax 已有但 agent-workbench 未迁移的功能

> 以下功能在 `workspace/nuwax` PC Web `/app` 中已实现，但 agent-workbench 尚未开始。按优先级排列。

### P1 — 核心体验（影响基本可用性）✅ (commit 283c2c6b)

| 功能 | nuwax 源码位置 | 状态 |
|------|---------------|------|
| **Thinking/推理过程展示** | `MarkdownRenderer` 内 collapsible "Thinking/Thought" 区域 | ✅ 完成 — SSE thought 事件路由到 metadata.thinking，ThinkingBlock 组件渲染 |
| **工具执行可视化（RunOver）** | `RunOver` 组件 + `<markdown-custom-process>` 标签 | ✅ 完成 — SSE PROCESSING 事件路由到 metadata.runOverSteps，RunOver 组件渲染 |
| **剪贴板粘贴图片上传** | `ChatInputHome/index.tsx` 行 228-340 | ✅ 完成 — ChatInputHome → ChatUploadFile → usePasteUpload → uploadFile 全链路 |
| **图片点击放大预览** | `OptimizedImage` 组件 + Ant Design `Image preview` | ✅ 完成 — MarkdownRenderer img 组件已使用 OptimizedImage + lightbox |
| **预设推荐问题** | `guidQuestionDtos` from agent detail | ✅ 完成 — ChatArea 渲染 guidQuestionDtos 为可点击推荐 |

### P2 — 增强功能（提升完整度）

| 功能 | nuwax 源码位置 | 说明 |
|------|---------------|------|
| **会话重命名** | ✅ 已实现 — `adapter.updateConversation` + `onRenameConversation` | 历史会话可修改标题 |
| **Cmd+J 新建会话快捷键** | ✅ 已实现 — `useEffect` keydown listener | 快速新建对话 |
| **URL 参数自动发送** | ✅ 已实现 — `?message=` 参数加载后自动发送，`?prompt=` 仅预填 | 与 nuwax 一致 |
| **Agent 侧边栏详情** | ✅ 已实现 — 点击 agent title 展开 description + openingChatMsg | 展开查看完整 agent 信息 |
| **手动组件选择** | ✅ 已实现 — `manualComponents` 类型 + adapter 解析 + ChatArea 组件选择 chip bar + `selectedComponents` 传入 sendMessage | 发送消息前可选择附加组件 |
| **会话分享** | ✅ 已实现 — `adapter.shareConversation` + 聊天头部/历史列表分享按钮 + 剪贴板复制 | 生成分享链接 |
| **Debug 视图** | ✅ 已实现 — `DebugBar` 组件：最后一条 assistant 消息下方显示 token 用量（从 SSE final event 提取） | 显示运行时长、token 数 |

### P3 — 次要功能（按需迁移）

| 功能 | nuwax 源码位置 | 说明 |
|------|---------------|------|
| **付费订阅** | `PaymentSubscriptionModal` | Agent 可设为付费，打开时弹出订阅弹窗 |
| **文件树 / VNC 桌面** | `FileTreeView` + VNC 预览 | Task Agent 专属，查看沙箱文件 |
| **导出项目文件** | `handleExportProject` → `apiDownloadAllFiles(id)` | 下载沙箱内全部文件 |
| **Computer 类型选择器** | `ComputerTypeSelector` | 选择沙箱/本地电脑运行 |
| **模板复制** | `MoveCopyComponent` | 复制 agent 到其他工作区 |
| **"Generated by AI" 声明** | 聊天输入框底部文案 | 合规声明 |

---

## nuwax OpenApp 真实接口 vs agent-workbench 实现差异

> 基于 `workspace/nuwax` 源码 (`src/services/agentConfig.ts`, `src/types/interfaces/conversationInfo.ts`) 审查

### 1. ID 类型不匹配 (CRITICAL)

| 字段 | nuwax 真实 API | agent-workbench | 影响 |
|------|----------------|-----------------|------|
| `conversationId` | `number` | `string` | createConversation/getConversation 返回值不一致 |
| `agentId` | `number` | `string` | getAgentDetail/listConversations 参数类型不一致 |
| `skillIds` | `number[]` | `string[]` | sendMessage 时类型错误 |
| `modelId` | `number` | `string` | sendMessage/getModelOptions 类型不一致 |

**现状**: webApiAdapter 在 normalize 函数中隐式做了 `String()` 转换，但类型声明和调用方并未统一处理。

### 2. sendMessage 请求体字段差异

```typescript
// nuwax 真实 (ConversationChatParams)
interface ConversationChatParams {
  conversationId: number;
  message: string;
  attachments: AttachmentFile[];      // 具体类型，非 unknown[]
  debug: boolean;                       // ✅ 已实现 (toNuwaxChatBody)
  selectedComponents: AgentSelectedComponentInfo[]; // ✅ 已实现 (manualComponents + ChatArea chip bar)
  variableParams?: Record<string, string | number>;
  sandboxId?: string;
  skillIds?: number[];
  modelId?: number;
}

// workbench 现状 (WorkbenchSendMessageRequest)
interface WorkbenchSendMessageRequest {
  agentId: string;
  conversationId: string;
  content: string;
  agentMode?: 'ask' | 'yolo';   // nuwax API 无此字段（前端模拟）
  attachments?: unknown[];
  skillIds?: string[];
  sandboxId?: string;
}
```

**差异说明**:
- `message` vs `content` — 字段名不同，webApiAdapter 已做映射
- `agentMode` — workbench 独有，nuwax 前端通过 UI 切换但未传给 API
- `debug` / `selectedComponents` — 完全缺失，影响组件选择功能

### 3. SSE 事件类型映射

| nuwax `ConversationEventTypeEnum` | agent-workbench `WorkbenchStreamEventType` | 说明 |
|-----------------------------------|------------------------------------------|------|
| `PROCESSING` | `processing` | ✅ 已实现 — SSE PROCESSING 路由到 runOverSteps
| `MESSAGE` | `chunk` | 消息片段，已对齐 |
| `FINAL_RESULT` | `final` | 最终结果，已对齐 |
| `ERROR` | `error` | 错误，已对齐 |
| 无独立类型 | `thought` | workbench 独有，nuwax 在 MESSAGE 内嵌套 |
| 无独立类型 | `permission` | workbench 独有，nuwax 在 FINAL_RESULT 内 |

### 4. Variable 类型不完整

nuwax `BindConfigWithSub[]` 支持:
- `InputTypeEnum`: `Text` / `Paragraph` / `Number` / `Select` / `MultipleSelect` / `AutoRecognition`
- `selectConfig`: `MANUAL`（硬编码选项）| `PLUGIN`（插件数据源）
- 树形 Cascader 选项: `{ value, label, children }`

workbench `WorkbenchVariable`:
```typescript
interface WorkbenchVariable {
  name: string;
  label?: string;
  require?: boolean;
  placeholder?: string;
  defaultValue?: string | number;
  // ✅ 已实现: type (6种), selectConfig (MANUAL/PLUGIN), Cascader 树形选项
}
```

### 5. @ 技能列表 API 不完整

nuwax 有三个 tab：
- 全部: `POST /api/published/skill/list-for-at` (后端分页搜索) ✅ 已实现
- 最近: `GET /api/published/skill/recentlyUsed/list` ✅ 已实现 (listRecentSkills)
- 收藏: `POST /api/published/skill/collect/list` ✅ 已实现 (listCollectedSkills)

workbench `listSkillsForAt` 只实现了后端搜索一个端点。

### 6. getConversation 分页边界

nuwax: `POST /api/agent/conversation/message/list { conversationId, index, size }`
- `hasMore = messages.length >= size` 时可能有假阳性（恰好 size 条不一定是最后一页）

webApiAdapter 已实现，但 `hasMore` 判断逻辑可优化。

---

## Assumptions
- 本次只改 NuwaClaw，不改 `workspace/nuwax` PC Web。
- `crates/agent-workbench` 先在 NuwaClaw 仓库内维护，后续再抽独立仓库给 NuwaClaw 和 nuwax 共用。
- “完整功能”指与 nuwax 当前 `/app/{agentId}` 等价，不额外实现不属于 `/app` 的全局管理页。
- 后端最终会提供真实 `appAgentId`；前端兜底只用于过渡联调。

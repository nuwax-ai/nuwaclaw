# @nuwax-ai/agent-workbench

NuwaClaw (Electron) 内嵌的 Agent Mode 工作台。对标 [nuwax](https://github.com/nuwax-ai/nuwax) PC Web `/app/{agentId}` 体验。

宿主：NuwaClaw（`crates/agent-electron-client`）只做登录、token、窗口壳、本地服务启动、Open Editor。`/app` 业务和会话执行全部走 nuwax 远端 API。

## 状态

正在开发中。详细进度见仓库根 `docs/PLAN.md` 与本目录 `NUWAX_SYNC.md`。

## 核心导出

```typescript
import {
  AgentWorkbench,
  AgentWorkbenchProvider,
  createWebApiAdapter,
  createMockApiAdapter,
} from '@nuwax-ai/agent-workbench';
```

业务组件（也可独立使用）：

```typescript
import {
  MentionPopup,         // @ 技能选择（3 tab）
  ChatUploadFile,       // 文件上传 + 粘贴
  VariableForm,         // 会话变量表单（含 Cascader）
  usePasteUpload,       // 剪贴板粘贴 hook
} from '@nuwax-ai/agent-workbench';
```

## 与 nuwax 的关系

本包从 nuwax `/app` 迁移而来，目录布局尽量镜像 nuwax 源，以便未来同步：

| nuwax 源 | workbench 落点 |
|---------|----------------|
| `src/pages/OpenApp/{BaseTemplate,AppDetails,HistoryConversation}` | `src/components/OpenApp/{同名}` |
| `src/components/ChatInputHome` | `src/components/ChatInputHome` |
| `src/components/MarkdownRenderer` | `src/components/MarkdownRenderer` |
| `src/services/agentConfig.ts` (函数签名) | `src/adapters/webApiAdapter.ts`（adapter 方法签名一致） |
| `src/models/conversationInfo.ts` | `src/components/OpenApp/hooks/useConversation.ts` |

详见 `NUWAX_SYNC.md`。同步 nuwax 上游变更时跑 `scripts/diff-from-nuwax.sh` 对比。

## 关键边界

- **ID 契约**：workbench 内部 ID 全部 `string`，nuwax API 用 `number`。转换只发生在 `src/adapters/idCoercion.ts` 的 `toApiId` / `fromApiId`。详见 `src/types.ts` 顶部注释。
- **Umi 隔离**：所有 Umi 风格 hook（`useRequest` / `useParams` / `useLocation` / `history` / `useModel`）从 `src/compat/umi.ts` 引入，是 nuwax 迁移代码的唯一查找替换点。
- **预览渲染**：在 Electron 环境用 `<webview>`，浏览器环境 fallback 到 `<iframe>`。`hostBridge.previewContainer === 'electron-webview'` 时启用 webview 模式 + preload bridge。

## 开发命令

```bash
pnpm install
pnpm run typecheck
pnpm run build
pnpm run test:run
```

测试通过 vitest，断言主要用 `react-dom/server` `renderToStaticMarkup`（避免 jsdom 依赖）。

## 包结构

```
src/
├── adapters/
│   ├── idCoercion.ts          # ID string ↔ number 边界
│   ├── webApiAdapter.ts       # nuwax HTTP adapter
│   ├── mockApiAdapter.ts      # 离线 mock
│   └── README.md              # adapter 方法 ↔ nuwax 服务映射
├── components/
│   ├── NuwaxOpenApp.tsx       # 主壳，逐步拆分中
│   ├── ChatInputHome/         # 输入区
│   ├── ChatUploadFile/        # 文件上传
│   ├── MarkdownRenderer/      # Markdown + 高亮 + Thinking + RunOver
│   ├── MentionPopup/          # @ 技能
│   ├── VariableForm/          # 变量表单
│   ├── OpenApp/               # 主区域子组件（镜像 nuwax）
│   │   ├── AppDetails/
│   │   ├── BaseTemplate/      # Sidebar 等
│   │   ├── HistoryConversation/
│   │   └── hooks/             # useConversation 等
│   └── business-component/
│       ├── ConversationDetails/
│       ├── HistoryConversationList/
│       └── PagePreviewIframe/
├── compat/
│   └── umi.ts                 # Umi 兼容层（nuwax 迁移目标）
├── routes.ts                  # 路由解析/构建
├── sse.ts                     # SSE stream 解析
├── types.ts                   # 公共类型 + ID 契约说明
└── index.ts                   # 公开导出
```

## License

Internal. 不发布到公开 npm。

# ACP 模式切换 + 权限审批/Ask 表单 —— 多端落地实施方案

| 项 | 内容 |
|---|---|
| 状态 | Plan approved,待实施 |
| 覆盖仓库 | A: `agents-a53ea2a4d3/crates/agent-electron-client/`(Electron 客户端);B: `nuwax/`(Web 前端);C: `nuwax-mobile/`(UniApp X 移动端) |
| 关联文档 | [universal-agent-acp-hooks-human-intervention-v3.md](./universal-agent-acp-hooks-human-intervention-v3.md)(上层方案);[agent-intervention-channel-calling.md](./agent-intervention-channel-calling.md)(多端调用降级) |
| 目标读者 | 接手实施的 AI Agent / 工程师(三端可分别交付不同 Agent) |
| 创建日期 | 2026-05-13 |

---

## 0. 给接手 Agent 的交付说明

### 0.1 文档定位

- **上层方案 v3**:`docs/universal-agent-acp-hooks-human-intervention-v3.md` 定义全局架构与最终形态。
- **多端调用降级方案**:`docs/agent-intervention-channel-calling.md` 定义跨端能力分级、Mobile M0–M5 路线图、IM 降级策略。
- **本文档**:把 v3 + channel-calling 落地到**当下三端 MVP**,覆盖 Electron / Web / Mobile,**不含 IM**。

### 0.1.1 ACP 协议两侧:Engines(Server)与 Clients

ACP 协议分两端:

**Engines(ACP Server,本期对接)**:

| 引擎 ID | 实现语言 | 说明 |
|---|---|---|
| `claude-code` | Node.js | Anthropic 官方 |
| `nuwaxcode` | Node.js | OpenCode 变体 |
| `codex` | Node.js | 占位,后续接入 |

所有 engine 在 ACP 协议层完全一致,客户端代码不做引擎特化分支。

**Clients(ACP Client 实现,本仓库与兄弟项目)**:

| 客户端 | 实现语言 | 部署形态 | 仓库 | 与本文档关系 |
|---|---|---|---|---|
| **Electron 客户端** | TypeScript | 桌面应用(macOS/Windows/Linux) | `agents-a53ea2a4d3/crates/agent-electron-client/` | **本文档主要交付目标(仓库 A)** |
| **rcoder** | Rust | 端云电脑实例内运行 | rcoder 独立仓库 | 兄弟项目,**按本文档同等设计原则**在 Rust 中实现 |

两个 client 是**同级关系**,都连接同样的 ACP engines。rcoder 在云电脑环境运行,作为云端用户接入 ACP 的工具,与本 Electron 客户端是用户使用场景的互补:本地工作走 Electron,云端工作走 rcoder。本文档不实施 rcoder 代码,详见 §4.10 关于 rcoder 的设计共识。

### 0.2 三端在多端方案中的角色

| 端 | 角色 | 渲染基准 |
|---|---|---|
| **Electron 客户端** | ACP 主控 + 本地兜底 UI | Ant Design `Modal`,与 Web 共用数据契约 |
| **Nuwax Web**(Chat 页面) | **完整渲染基准** | 内嵌消息卡片(`AgentInterventionCard` + 表单/wizard) |
| **Nuwax Mobile** | 移动端会话渲染 | M0 fallback + M1 卡片 + M2 drawer + 复杂走 H5 |

### 0.3 三端共同遵守的契约

无论哪个仓库的接手 Agent,以下契约**严格对齐**:

- 数据格式:`InterventionRequest` + `InteractionUISchema` + `InterventionResponse`(详见 §3)
- ACP 协议:client 端硬约定 mode id `ask` / `auto` / `yolo`(详见 §2)
- SSE 事件类型(Web/Mobile 共用):`INTERVENTION_REQUEST` / `INTERVENTION_UPDATE`(详见 §3.4)
- 响应回传 API:`POST /api/agent-interventions/:interventionId/respond`(后端统一 endpoint)

### 0.4 不在本期范围(明确不做)

1. **IM 渠道**(飞书/钉钉/企业微信/Telegram/Discord)—— v3 / channel-calling 已规划,但本期不实施
2. **Mobile M3–M5**(独立表单页 / wizard / diff 审阅)—— 复杂场景本期通过 webUrl 跳转 Web 完成
3. **后端 hooks 注入**—— `nuwax-file-server` 负责,与本期 UI 解耦
4. **审计/历史回看 SQLite 表**—— Electron 本期纯内存,Web/Mobile 端只渲染当前 pending
5. **新开发的 Ask MCP 工具(server 端实现)**—— 由独立 MCP 服务承担(详见 §3.7),客户端只负责通过 chat 下发通道接收 InterventionRequest 并渲染、回传响应
6. **P/ACP Proxy Pipeline**—— v3 中长期演进项

### 0.5 实施前必读

| # | 文档/代码 | 目的 |
|---|---|---|
| 1 | 本文档 §1–§4(背景、ACP 协议、跨端契约、Electron 章节) | 理解协议与契约 |
| 2 | `docs/universal-agent-acp-hooks-human-intervention-v3.md` §3–§5 | 理解架构分层与数据模型 |
| 3 | `docs/agent-intervention-channel-calling.md` §1–§3 | 理解 Mobile 分阶段路线 |
| 4 | ACP 官方:https://agentclientprotocol.com/protocol/session-modes 与 /protocol/tool-calls | 协议权威定义 |
| 5 | 接手仓库对应章节(§4 Electron / §5 Web / §6 Mobile) | 具体实施步骤 |

---

## 1. 背景与核心交付物

### 1.1 改造起因

- hooks 完全由后端 `nuwax-file-server` 在项目初始化时按 engine 写入(claude-code → `.claude/settings.json`、codex/nuwaxcode → 各自配置文件)。Electron 客户端不再注入 hooks。
- 客户端职责**重新聚焦**:模式选择 + 权限审批/Ask 表单 UI。
- 本期目标 = **放开模式选择**:把 nuwaclaw 当前隐藏的 yolo 行为(`acpEngine.ts:2483-2487` 通过设置 allow 模拟)提升为用户可见、可切换的三档模式系统。

### 1.2 三档模式语义(client 硬约定)

| modeId | 客户端 `handlePermissionRequest` 行为 |
|---|---|
| `ask` | 所有 ACP `session/request_permission` 全部弹窗等待用户响应 |
| `auto` | `toolCall.kind` ∈ `{read, search, think, fetch}` 自动 `allow_once`;`{edit, delete, move, execute, other}` 走 UI |
| `yolo` | 维持现有 `allow_always > allow_once > options[0]` 自动选择(保留 strict-sandbox guard) |

未知 mode → fail-safe 降级 `ask`。**出厂默认 mode = `auto`**。

### 1.3 三端架构

```
                  ┌─────────────────────────────────────────────────┐
                  │  Electron Main Process (仓库 A,ACP Client)        │
                  │  - AcpEngine (连接 claude-code / nuwaxcode /      │
                  │               codex ACP engines)                  │
                  │  - HumanInterventionService                       │
                  │  - 当前 Mode 状态、SQLite 持久化、IPC + SSE 调度    │
                  └────┬─────────────────┬──────────────────┬────────┘
                       │ IPC             │ deliverTo("web") │ deliverTo("mobile")
       ┌───────────────┘                 ▼                  ▼ (经 Nuwax Backend SSE)
       ▼                          ┌───────────────┐  ┌──────────────────────┐
┌──────────────────┐               │ Nuwax Web      │  │ Nuwax Mobile         │
│ Electron Renderer │ ← 本地兜底   │ (仓库 B)        │  │ (仓库 C)              │
│ InterventionModal │               │ Chat 页面内嵌  │  │ M0 fallback +        │
│ SessionModeSelector│              │ AgentIntervention│  │ M1 approval 卡片 +   │
└──────────────────┘               │ Card / 表单     │  │ M2 drawer 单/多选   │
                                   └───────────────┘  └──────────────────────┘
                                              │                  │
                                              └────回调:POST /api/agent-interventions/:id/respond
```

**响应汇聚**:任一端响应后,Nuwax Backend 通过 SSE `INTERVENTION_UPDATE` 同步状态到其他端,其他端置灰/关闭。

---

## 2. ACP 协议约束(三端共用依据)

来源:https://agentclientprotocol.com/

### 2.1 ACP 原生 mode 机制(关键)

- `SessionMode { id, name, description }`
- `SessionModeState { currentModeId, availableModes[] }`
- `session/new` 响应可携带 `modes: SessionModeState | null`
- `session/set_mode { sessionId, modeId }`(Client → Agent)
- `session/update` 的 `current_mode_update { currentModeId }`(Agent → Client)
- 典型语义:`ask` / `architect` / `code` —— 本方案用 `ask` / `auto` / `yolo`

### 2.2 审批闭环时序

```
Agent: session/update(tool_call, status=pending)
Agent: session/request_permission(sessionId, toolCall, options[])
Client: 渲染 UI / 自动决策 → 返回 { outcome: "selected", optionId } | { outcome: "cancelled" }
Agent: session/update(tool_call_update, status=in_progress) → 执行 → completed/failed
```

### 2.3 协议层强约束(MUST)

- session/cancel 时,Client **必须**对所有 pending permission 回 `cancelled` + **必须**把未完成 tool call 标记 `cancelled`
- Agent **必须**用 `cancelled` 作为 stopReason 回应原始 prompt
- 客户端自动决策:`Clients MAY automatically allow or reject permission requests according to the user settings`(yolo / auto 自动选项合规)

### 2.4 UI 渲染信息来源(三端共用映射)

| UI 元素 | 协议字段 | 说明 |
|---|---|---|
| 主标题 | `toolCall.title` | human-readable |
| 工具图标 | `toolCall.kind` | read/edit/delete/move/search/execute/think/fetch/other |
| 详情区 | `toolCall.rawInput` + `locations[]`(uri/name/size) + `content[]` | 折叠展开 |
| 按钮文案 | `PermissionOption.name` | 协议保证 human-readable,**无需翻译** |
| 按钮样式 | `PermissionOption.kind` 派生 | allow_always → 主蓝;allow_once → 次;reject_* → 危险红 |
| Severity 标签 | 客户端自生成 | 基于 toolCall.kind + locations 路径白名单/黑名单推导 |

### 2.5 关键启示:客户端 mode 与 Agent mode 是双轨

- **Agent 侧 mode**(ACP `session/set_mode`)→ 影响 Agent 发不发 permission
- **客户端侧 mode**(本方案的 `currentModeId`)→ 控制 `handlePermissionRequest` 收到后弹不弹窗
- 二者**独立、互不替代**

### 2.6 协议没有 `question` ToolKind

ACP ToolKind 枚举只有:`read / edit / delete / move / search / execute / think / fetch / other`。当前 `acpEngine.ts:2408` 对 `kind === "question"` 的处理是 nuwaxcode 私有扩展。

**通用 ask/question 不走 ACP**,走**独立开发的 MCP 工具**,通过 chat 通道下发(详见 §3.7)。Electron 主进程对 ask 路径不感知。

---

## 3. 跨端契约(三端必须严格对齐)

### 3.1 InterventionRequest

**单一来源** = Electron 主进程的 `src/shared/types/intervention.ts`。Web / Mobile 端引用相同 schema(可通过 codegen 或手动同步),字段名一字不差。

```ts
type InterventionKind = "approval" | "question";
type InterventionStatus = "pending" | "answered" | "approved" | "rejected" | "cancelled" | "expired" | "superseded";

interface InterventionRequest {
  id: string;
  revision: number;
  kind: InterventionKind;
  status: InterventionStatus;
  sessionId: string;
  engine: "claude-code" | "nuwaxcode" | "codex";
  source: "acp_permission" | "mcp_ask";
  title: string;
  description?: string;
  severity: "info" | "warning" | "danger";
  approval?: {
    acpInternalId?: string;
    toolCall: {
      toolCallId: string;
      name?: string;
      kind: string;
      rawInput?: unknown;
      locations?: Array<{ uri: string; name?: string; size?: number }>;
    };
    options: Array<{
      optionId: string;
      kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
      label: string;
    }>;
  };
  ui: InteractionUISchema;
  timeoutMs: number;
  createdAt: number;
}
```

### 3.2 InteractionUISchema

```ts
interface InteractionUISchema {
  version: "nuwaclaw.interaction.v1";
  presentation: "modal" | "inline" | "wizard";
  title: string;
  description?: string;
  schema: JsonSchemaObject;
  uiSchema?: Record<string, unknown>;
  steps?: Array<{ id: string; title: string; description?: string; fields: string[] }>;
  submitLabel?: string;
  cancelLabel?: string;
  fallback?: { text: string; webUrl?: string; mobileUrl?: string };
}
```

### 3.3 InterventionResponse / ChannelInterventionCallback

```ts
type InterventionAction = "submit" | "cancel" | "skip" | "timeout";

interface InterventionResponse {
  interventionId: string;
  revision: number;
  action: InterventionAction;
  formData?: Record<string, unknown>;
  receivedAt: number;
}

// 后端 callback 形态(Web/Mobile 端 POST 时携带)
interface ChannelInterventionCallback {
  interventionId: string;
  revision: number;
  channel: "electron-local" | "nuwax-web" | "nuwax-mobile";
  actor: { platformUserId?: string; displayName?: string };
  action: InterventionAction;
  formData?: Record<string, unknown>;
  receivedAt: number;
}
```

**Action 语义**:

| action | 语义 | UI 触发 | approval 映射(ACP outcome) | ask 映射(MCP tool_result) |
|---|---|---|---|---|
| `submit` | 用户提交 formData | 主按钮(允许/确认/提交) | `{ outcome: "selected", optionId }` | `{ ...formData }` |
| `cancel` | 用户主动取消/拒绝 | 取消/关闭按钮、关闭键盘快捷键 | `{ outcome: "cancelled" }` | `{ cancelled: true }` |
| `skip` | 用户跳过,**不阻断 agent**,让其按默认逻辑继续 | "跳过"按钮(可选 UI,仅在 schema 允许时显示) | `{ outcome: "cancelled" }` + `_meta: { reason: "skipped" }` | `{ skipped: true }` |
| `timeout` | 客户端 / 后端超时自动产生(非用户主动) | 无,系统生成 | `{ outcome: "cancelled" }` + `_meta: { reason: "timeout" }` | `{ timeout: true }` |

**skip 与 cancel 的区别**:

- `cancel` = 用户明确拒绝或中止操作,语义上倾向"不要做这件事"
- `skip` = 用户不想参与决策,让 agent 自行处理(可能采用默认值、跳过此步骤、继续后续流程),语义上倾向"我不管,你看着办"
- 二者在 ACP outcome 上都映射为 `cancelled`(协议限制),但通过 `_meta.reason` 区分;Agent / MCP server 可据此采取不同后续策略(skip 时 Agent 可继续尝试,cancel 时 Agent 应停止)
- **UI 上 skip 按钮可选**:仅在 `InteractionUISchema.uiSchema.allowSkip = true` 时显示(默认不显示);允许 schema 作者按场景控制是否提供跳过选项

### 3.4 SSE 事件契约(Web/Mobile)

通过 Nuwax Backend 会话 SSE 推送,Web/Mobile 监听:

```json
// INTERVENTION_REQUEST
{
  "eventType": "INTERVENTION_REQUEST",
  "sessionId": "session-xxx",
  "timestamp": 1770000000000,
  "data": <InterventionRequest>
}

// INTERVENTION_UPDATE(状态变化,如另一端已响应/超时/取消)
{
  "eventType": "INTERVENTION_UPDATE",
  "sessionId": "session-xxx",
  "data": {
    "interventionId": "int-xxx",
    "revision": 1,
    "status": "approved" | "rejected" | "cancelled" | "expired" | "superseded",
    "resolvedBy": { "channel": "nuwax-web", "displayName": "User Name" }
  }
}
```

### 3.5 响应 API

`POST /api/agent-interventions/:interventionId/respond` ,body 为 `ChannelInterventionCallback`(去掉 `interventionId` 字段,以 URL 为准)。

后端校验 `revision + idempotencyKey + actor`,通过后回调 Electron 主进程的 `HumanInterventionService.respond()`,resolve 对应 pending Promise。

### 3.7 Ask / Question 路径(新开发 MCP 工具 + chat 下发)

**approval 与 ask 的源头不同,但 UI 渲染、响应回传完全共用同一套数据格式与组件**:

```
┌─────────────────────────────────────────────────────────────────────┐
│ approval 路径(ACP 协议)                                             │
│                                                                     │
│ Agent ──session/request_permission──► Electron Main ──┐             │
│                                                       │             │
│                                              HumanInterventionService
│                                                       │             │
│                            ┌──────────────────────────┴─────┐       │
│                            ▼                                ▼       │
│                    Electron Modal           Nuwax Backend → SSE     │
│                                                    │                │
│                                                    ▼                │
│                                            Web / Mobile / (webview) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ ask / question 路径(新 MCP 工具,通过 chat 下发)                     │
│                                                                     │
│ Agent ──tool_call(nuwax_ask_user)──► MCP server(新开发)             │
│                                            │                        │
│                                            ▼                        │
│                                     Nuwax Backend                   │
│                                            │  通过会话 chat SSE      │
│                                            ▼                        │
│                          ┌─────────────────┼─────────────────┐      │
│                          ▼                 ▼                 ▼      │
│                  Nuwax Web Chat      Nuwax Mobile     Electron(webview │
│                  AgentInterventionCard  M1/M2 卡片     里的 Nuwax Web) │
│                          │                 │                 │      │
│                          └────POST /api/agent-interventions/:id/respond
│                                            │                        │
│                                            ▼                        │
│                                     MCP server tool_result          │
│                                            │                        │
│                                            ▼                        │
│                                          Agent                      │
└─────────────────────────────────────────────────────────────────────┘
```

**关键约定**(本文档客户端范围内):

| 项 | 约定 |
|---|---|
| MCP 工具名 | 由 MCP 团队最终命名(候选 `nuwax_ask_user` / `nuwaclaw_ask_user`) |
| MCP 工具输入参数 | 即 `InteractionUISchema`(§3.2),Agent 直接传 JSON Schema + uiSchema + steps |
| MCP 工具输出 | 用户填写的 `formData`,与 `InterventionResponse.formData` 形态一致 |
| 客户端识别字段 | `InterventionRequest.source = "mcp_ask"` + `InterventionRequest.kind = "question"` |
| 客户端渲染逻辑 | 与 approval 完全一致(SchemaForm / StepWizard 复用) |
| 客户端响应回传 | 共用 §3.5 的 `POST /api/agent-interventions/:id/respond` |
| Electron 主进程角色 | **不感知** ask 路径(ask 不经过 ACP 也不经过 Electron 主进程);Electron 内的 Nuwax Web webview 走 SSE 接收 |

**对客户端的影响汇总**:

- Electron 主进程的 `HumanInterventionService` 只负责 approval 一侧(ACP 来源),ask 一侧由 MCP server + Nuwax Backend 闭环,Electron 主进程不参与
- Web / Mobile 端的 SSE 监听需要**同时处理 approval 和 ask 两类 INTERVENTION_REQUEST**,但 UI 渲染逻辑统一
- Electron 本地 Modal(InterventionModal)**只渲染 approval**,ask 在 webview 内由 Nuwax Web 渲染
- 跨端竞态规则(§3.4 INTERVENTION_UPDATE)对两类请求都生效

### 3.6 approval schema 自动生成规则(Electron 主进程内)

把 ACP `PermissionOption[]` 转成:

```json
{
  "version": "nuwaclaw.interaction.v1",
  "presentation": "modal",
  "title": "<toolCall.title>",
  "severity": "warning",
  "schema": {
    "type": "object",
    "required": ["decision"],
    "properties": {
      "decision": {
        "type": "string",
        "oneOf": [
          { "const": "allow_once", "title": "<PermissionOption.name>" },
          { "const": "allow_always", "title": "<PermissionOption.name>" },
          { "const": "reject_once", "title": "<PermissionOption.name>" }
        ]
      },
      "reason": { "type": "string", "maxLength": 500 }
    }
  },
  "uiSchema": {
    "decision": { "ui:widget": "buttonGroup" },
    "reason": { "ui:widget": "textarea", "ui:visibleWhen": { "decision": ["reject_once", "reject_always"] } }
  }
}
```

---

## 4. 仓库 A:Electron 客户端(`agents-a53ea2a4d3/crates/agent-electron-client/`)

### 4.1 现状起点

- `acpEngine.ts:2483-2487` 的 auto-select 逻辑等同于**唯一且隐藏的 yolo**,用户无切换入口
- `PermissionModal.tsx` 是孤立组件未挂载,本期标 legacy
- `SessionsPage.tsx` 用 `<webview>` 嵌入 Nuwax Chat,本地无消息流容器 → UI 落点 = 全局 Modal
- `pendingPermissions` Map + `respondPermission()` 已存在(`acpEngine.ts:145, :1723`),本期接入

### 4.2 关键文件清单

| 操作 | 路径 |
|---|---|
| 修改 | `src/main/services/engines/acp/acpEngine.ts` (`newSession`:740 读 modes / 新增 `setMode` / `handleSessionUpdate` 增 `current_mode_update` 分支 / `handlePermissionRequest`:2399 重写 / `destroy`:783 加 `cancelBySession`) |
| 修改 | `src/main/services/engines/unifiedAgent.ts`(暴露 `setMode`、转发 `mode.updated`) |
| 修改 | `src/main/ipc/*`(新增 mode / intervention IPC handler) |
| 修改 | `src/main/preload.ts`(暴露 7 个新 API) |
| 修改 | `src/renderer/App.tsx`(挂载 `<InterventionRoot />`) |
| 修改 | `src/renderer/components/pages/SessionsPage.tsx`(顶部挂 `<SessionModeSelector />`) |
| 新增 | `src/main/services/engines/acp/humanInterventionService.ts` |
| 新增 | `src/main/services/engines/acp/interventionDelivery.ts`(channel 抽象:本地 / Nuwax Web) |
| 新增 | `src/main/db/sessionModes.ts` |
| 新增 | `src/shared/types/acpMode.ts` |
| 新增 | `src/shared/types/intervention.ts` |
| 新增 | `src/renderer/components/intervention/InterventionRoot.tsx` |
| 新增 | `src/renderer/components/intervention/InterventionModal.tsx` |
| 新增 | `src/renderer/components/intervention/SchemaForm.tsx` |
| 新增 | `src/renderer/components/intervention/StepWizard.tsx` |
| 新增 | `src/renderer/components/intervention/SessionModeSelector.tsx` |
| 处置 | `src/renderer/components/modals/PermissionModal.tsx` 加 `@deprecated`(不删除,沙箱本地路径如还在用) |

### 4.3 ACP mode 接入

```ts
// newSession: 从响应读取 modes
const newSessionResult = await connection.newSession({ cwd, mcpServers, _meta });
const sessionModes: SessionModeState | null = (newSessionResult as any).modes ?? null;
session.currentModeId = sessionModes?.currentModeId ?? null;
session.availableModes = sessionModes?.availableModes ?? null;

// 新增 setMode
async setMode(sessionId: string, modeId: string): Promise<void> {
  if (this.acpConnection && session.availableModes) {
    await this.acpConnection.setSessionMode({ sessionId: session.acpSessionId, modeId });
  }
  session.localMode = modeId;
  await persistSessionMode(sessionId, modeId);
  this.emit("mode.updated", { sessionId, modeId, source: session.availableModes ? "acp" : "local" });
}

// handleSessionUpdate 新增
case "current_mode_update":
  session.currentModeId = update.currentModeId;
  this.emit("mode.updated", { sessionId, modeId: update.currentModeId, source: "acp" });
  break;
```

**mode 解析优先级**(`resolveSessionMode`):

```
session.currentModeId (ACP 设置过)
  └─ 缺失则 → session.localMode (用户切换并持久化)
       └─ 缺失则 → settings.intervention.defaultMode (全局默认)
            └─ 缺失则 → 硬编码 "auto"
```

### 4.4 handlePermissionRequest 重写(按 mode 分流)

```ts
private async handlePermissionRequest(params: AcpPermissionRequest): Promise<AcpPermissionResponse> {
  const session = this.sessions.get(params.sessionId);
  if (!session) return { outcome: { outcome: "cancelled" } };

  // 1) legacy: strict-sandbox 越界 fail closed
  const strictCheck = evaluateStrictWritePermission(params, /* ... */);
  if (strictCheck.blocked) return { outcome: { outcome: "cancelled" } };
  const strictWriteMode = this.isStrictSandboxActiveForNuwaxcode() && strictCheck.isWriteRequest;

  // 2) nuwaxcode 私有 question kind 兼容
  if (params.toolCall.kind === "question") return { outcome: { outcome: "cancelled" } };

  // 3) 解析当前 mode
  const mode = this.resolveSessionMode(session);

  // 4) yolo: 维持现状
  if (mode === "yolo" && !strictWriteMode) {
    const selected =
      params.options.find(o => o.kind === "allow_always") ||
      params.options.find(o => o.kind === "allow_once") ||
      params.options[0];
    return selected
      ? { outcome: { outcome: "selected", optionId: selected.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  // 5) auto: 低风险白名单 auto-approve
  if (mode === "auto" && !strictWriteMode) {
    const lowRisk = new Set(["read", "search", "think", "fetch"]);
    if (lowRisk.has(params.toolCall.kind)) {
      const selected = params.options.find(o => o.kind === "allow_once") || params.options[0];
      if (selected) return { outcome: { outcome: "selected", optionId: selected.optionId } };
    }
  }

  // 6) ask / auto-高风险 / unknown → 走 InterventionService
  const req = this.buildApprovalRequest(params, { strictWriteMode });
  const response = await this.humanInterventionService.create(req);

  if (response.action === "cancel") return { outcome: { outcome: "cancelled" } };
  const decision = response.formData?.decision as string | undefined;
  if (!decision) return { outcome: { outcome: "cancelled" } };
  const option = params.options.find(o => o.kind === decision);
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } };
}
```

### 4.5 HumanInterventionService(多 channel 调度)

不再是单一本地 Modal:

```ts
export class HumanInterventionService extends EventEmitter {
  private pending = new Map<string, PendingEntry>();
  private deliveries: InterventionDelivery[] = [];   // 多个 channel
  private DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

  registerDelivery(d: InterventionDelivery) { this.deliveries.push(d); }

  async create(req: InterventionRequest): Promise<InterventionResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { /* timeout → cancel */ }, req.timeoutMs ?? this.DEFAULT_TIMEOUT_MS);
      this.pending.set(req.id, { req, resolve, timer });

      // 并行投递到所有 channel
      for (const d of this.deliveries) {
        d.deliver(req).catch(err => log.warn(`delivery ${d.name} failed`, err));
      }
    });
  }

  respond(payload: InterventionResponse, channel: string): { ok: boolean; reason?: string } {
    const entry = this.pending.get(payload.interventionId);
    if (!entry) return { ok: false, reason: "not_found" };
    if (payload.revision !== entry.req.revision) return { ok: false, reason: "revision_mismatch" };
    clearTimeout(entry.timer);
    this.pending.delete(payload.interventionId);

    // 通知所有 channel 状态变化(其他端置灰/关闭)
    for (const d of this.deliveries) {
      d.notifyResolved(payload, channel).catch(() => {});
    }
    entry.resolve(payload);
    return { ok: true };
  }

  cancelBySession(sessionId: string): void { /* 批量取消 */ }
}

interface InterventionDelivery {
  name: string;
  deliver(req: InterventionRequest): Promise<void>;
  notifyResolved(payload: InterventionResponse, resolvedBy: string): Promise<void>;
}
```

**两个 channel 实现**:

1. `LocalRendererDelivery`:通过 IPC `intervention:request` 推到 Electron 渲染进程的 InterventionModal
2. `NuwaxWebDelivery`:通过 HTTP POST 到 Nuwax Backend `/api/internal/agent-interventions/dispatch`,后端通过会话 SSE 推到 webview 内的 Web

`NuwaxWebDelivery` 需要 Nuwax Backend 配套 endpoint(见 §7 后端契约)。

### 4.6 渲染进程组件(本地兜底 UI)

无变化,与原方案一致:

| 文件 | 职责 |
|---|---|
| `InterventionRoot.tsx` | 顶层挂载,IPC 监听 + pending 队列 |
| `InterventionModal.tsx` | Ant Design Modal 容器 |
| `SchemaForm.tsx` | JSON Schema 子集 → 控件树 |
| `StepWizard.tsx` | 多步骤外壳 |
| `SessionModeSelector.tsx` | Segmented 三档选择器 |

**SchemaForm 控件覆盖**(全做):buttonGroup / Radio.Group / Checkbox.Group / Input / Input.TextArea / InputNumber / Switch / Steps wizard / 条件显示(`ui:visibleWhen`)。

**InterventionUpdated 处理**:本地 Modal 收到 `intervention:updated` 且 status≠pending → Modal 关闭并显示 "已由 Web/移动端处理"。

### 4.7 IPC 通道

| IPC | 方向 | Payload |
|---|---|---|
| `agent:setSessionMode` | renderer → main | `{ sessionId, modeId }` |
| `agent:getSessionModes` | renderer → main | `{ sessionId }` → `{ acpModes, localMode, effectiveMode }` |
| `agent:mode.updated` | main → renderer | `{ sessionId, modeId, source }` |
| `intervention:request` | main → renderer | `InterventionRequest` |
| `intervention:respond` | renderer → main | `InterventionResponse` → `{ ok, reason? }` |
| `intervention:cancel` | renderer → main | `{ interventionId }` |
| `intervention:updated` | main → renderer | `{ interventionId, status, resolvedBy }` |

### 4.8 SQLite

```sql
CREATE TABLE IF NOT EXISTS agent_session_modes (
  session_id TEXT PRIMARY KEY,
  local_mode TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`settings` 表插入 `intervention.defaultMode = "auto"`。

### 4.10 与 rcoder(兄弟 ACP 客户端)的设计共识

rcoder 是运行在端云电脑实例上的 **ACP Client 实现**(Rust),与本仓库 Electron 客户端是 ACP 协议同一侧、**同级**的两个客户端实现。两者使用同样的 ACP engines(`claude-code` / `nuwaxcode` / `codex`),面向不同的用户使用场景:本地桌面 vs 云端工作站。

**本文档不实施 rcoder 代码**,但 rcoder 团队应按本文档同等的设计原则在 Rust 中实现,以确保两个客户端的用户体验和协议行为一致。

**对 rcoder 团队的设计共识**(只关注 ACP 协议层语义对齐,不规定 Rust 实现细节):

| 维度 | 共识 |
|---|---|
| Mode 系统 | 客户端硬约定三档 `ask` / `auto` / `yolo`(§1.2);出厂默认 `auto`;mode 解析优先级与 §4.3 一致(ACP 优先 → 本地用户切换 → 全局默认 → 硬编码) |
| `handlePermissionRequest` 分流 | 三档行为与 §4.4 一致:ask 全弹审批;auto 按 ACP ToolKind 白名单 `{read,search,think,fetch}` 自动通过、其他走 UI;yolo 全自动 |
| 数据契约 | `InterventionRequest` / `InteractionUISchema` / `InterventionResponse` 字段定义与 §3.1–§3.3 严格一致(支持后续序列化对齐 / 跨端协作) |
| Action 集合 | `submit` / `cancel` / `skip` / `timeout` 四种(§3.3),`skip` 与 `cancel` 在协议映射上一致但语义不同 |
| Ask / Question 路径 | 不走 ACP,走 §3.7 描述的新 MCP 工具 + chat 下发,rcoder 客户端只负责渲染与回传 |
| ACP 协议遵循 | 严格按官方 spec 实现 `session/set_mode`、`current_mode_update`、`session/request_permission` 的 cancel 语义等 |
| UI 表达 | 控件类型覆盖与 §4.6 一致(buttonGroup / Radio / Checkbox / Input / TextArea / InputNumber / Switch / Steps wizard / `ui:visibleWhen`),按 rcoder 的 Rust UI 框架(如 egui / tauri webview 等)对应实现 |

**不需要 rcoder 与 Electron 客户端共享或对齐的部分**:

- 具体 UI 组件库选择(Electron 用 Ant Design,rcoder 自定)
- 持久化方案(Electron 用 SQLite,rcoder 自定)
- 客户端内部模块划分、文件路径、类型名
- 与 Nuwax Backend 的具体通信形式(只要语义对齐即可)

**协调机制**:

- 本文档作为两个客户端的设计参考基线
- 数据格式 `InterventionRequest` 的 source-of-truth = Electron `src/shared/types/intervention.ts`,rcoder 实施时复制字段定义到 Rust struct,保持一致
- 后续 schema 升级走 versioned `InteractionUISchema.version`(本期 `nuwaclaw.interaction.v1`),客户端按版本号决定渲染策略

### 4.9 实施步骤(仓库 A)

| Phase | 内容 |
|---|---|
| A1 | 类型 + ACP mode 接入(`acpMode.ts` / `intervention.ts` / `setMode` / `current_mode_update`) |
| A2 | `HumanInterventionService` + `handlePermissionRequest` 三档分流 |
| A3 | IPC + preload + SQLite(`agent_session_modes` 表) |
| A4 | 渲染组件 + 挂载 |
| A5 | `NuwaxWebDelivery` 接入(需后端 endpoint 就绪) |
| A6 | 端到端验证(任一可用 ACP 引擎走完整路径即可,引擎间协议层无差异) |

---

## 5. 仓库 B:Nuwax Web(`/Users/apple/workspace/nuwax`)

### 5.1 现状起点

- 技术栈:React + Ant Design 5 + CSS Modules
- Chat 页面入口:`src/pages/Chat/index.tsx`(三列布局,L1255–1268 渲染消息列表)
- 消息组件:`src/components/ChatView/index.tsx`(按 `role` 分发渲染)
- 类型:`src/types/interfaces/conversationInfo.ts` 定义 `MessageInfo`、`ConversationInfo`
- 枚举:`src/types/enums/agent.ts` 定义 `ConversationEventTypeEnum`(当前:`PROCESSING / MESSAGE / FINAL_RESULT / ERROR`)
- 模型:`src/models/conversationInfo.ts` 处理 SSE 事件、更新消息列表
- 工具调用展示参考:`src/components/ChatView/RunOver/index.tsx`(processingList + 状态)
- 无 intervention 字段、无 JSON Schema 表单库

### 5.2 关键文件清单

| 操作 | 路径 |
|---|---|
| 修改 | `src/types/interfaces/conversationInfo.ts` `MessageInfo` 增 `intervention?: InterventionMessageInfo` |
| 修改 | `src/types/enums/agent.ts` `ConversationEventTypeEnum` 新增 `INTERVENTION_REQUEST` / `INTERVENTION_UPDATE` |
| 修改 | `src/models/conversationInfo.ts` SSE handler 识别 intervention 事件并插入特殊消息 |
| 修改 | `src/pages/Chat/index.tsx` 消息列表渲染(L1255–1268 附近)增加对 intervention 消息的判定 |
| 修改 | `src/components/ChatView/index.tsx` 在 role 分发后,检测 `messageInfo.intervention` 优先渲染 InterventionCard |
| 新增 | `src/pages/Chat/components/AgentInterventionCard/index.tsx` |
| 新增 | `src/pages/Chat/components/AgentInterventionCard/SchemaForm.tsx` |
| 新增 | `src/pages/Chat/components/AgentInterventionCard/StepWizard.tsx` |
| 新增 | `src/services/agentIntervention.ts`(`respondAgentIntervention()` API) |
| 新增 | `src/types/interfaces/intervention.ts`(复制自 Electron `src/shared/types/intervention.ts`,字段严格一致) |

### 5.3 数据流

```
Electron Main → HTTP POST /api/internal/agent-interventions/dispatch → Nuwax Backend
                                                                            │
                                                                            ▼
                                                          会话 SSE: INTERVENTION_REQUEST
                                                                            │
                                                                            ▼
                                                                  webview 内 Nuwax Web
                                                                            │
            conversationInfo.ts handleChangeMessageList: 识别 eventType, 构造 MessageInfo {
                                                            id: intervention.id,
                                                            role: ASSISTANT,
                                                            intervention: <full payload>
                                                          } 插入消息列表
                                                                            │
                                                                            ▼
ChatView 渲染时检测 messageInfo.intervention → 渲染 AgentInterventionCard
                                                                            │
                              用户提交 → respondAgentIntervention(POST /api/agent-interventions/:id/respond)
                                                                            │
                                                                            ▼
                                                          后端校验 + 回调 Electron Main
                                                                            │
                                                                            ▼
                                            INTERVENTION_UPDATE SSE → 卡片 disable + 显示结果
```

### 5.4 AgentInterventionCard 渲染

- 默认 `presentation = "inline"`:卡片直接展开在消息流中
- `presentation = "wizard"`:卡片折叠,点击"展开"打开 Modal 内嵌 StepWizard
- 头部:严重度 Tag(info / warning / danger)+ 工具图标(基于 `approval.toolCall.kind`)+ title
- 详情区:可折叠展示 `rawInput`、`locations[]`(uri 高亮)
- 表单区:用 SchemaForm 渲染 `ui.schema + ui.uiSchema`
- 按钮区:`PermissionOption.name` 按 `kind` 着色(allow_always 主、allow_once 次、reject 危险)
- 状态:`pending` 可操作;`approved/rejected/answered` 禁用并显示处理人+渠道+时间;`expired/cancelled/superseded` 禁用+提示

### 5.5 SchemaForm 控件覆盖(与 Electron 一致)

参考 Electron §4.6 控件表。用 Ant Design 5 同名组件实现,**优先使用 Form.Item + Form 校验**而不是手写 state。

### 5.6 SSE 事件处理(`src/models/conversationInfo.ts`)

```ts
function handleChangeMessageList(event: SSEEvent, conversation: ConversationInfo) {
  switch (event.eventType) {
    // ... 现有 case
    case "INTERVENTION_REQUEST": {
      const req: InterventionRequest = event.data;
      const message: MessageInfo = {
        id: `intervention-${req.id}`,
        role: AssistantRoleEnum.ASSISTANT,
        messageType: MessageTypeEnum.ASSISTANT,
        type: MessageModeEnum.INTERVENTION,  // 新增枚举值
        intervention: { ...req, status: "pending" },
        status: MessageStatusEnum.complete,
      };
      conversation.messageList.push(message);
      break;
    }
    case "INTERVENTION_UPDATE": {
      const update = event.data;
      const msg = conversation.messageList.find(m => m.intervention?.id === update.interventionId);
      if (msg && msg.intervention) {
        msg.intervention.status = update.status;
        msg.intervention.resolvedBy = update.resolvedBy;
      }
      break;
    }
  }
}
```

### 5.7 响应 API(`src/services/agentIntervention.ts`)

```ts
export async function respondAgentIntervention(
  interventionId: string,
  payload: Omit<ChannelInterventionCallback, "interventionId" | "channel" | "receivedAt">
): Promise<{ ok: boolean }> {
  return request(`/api/agent-interventions/${interventionId}/respond`, {
    method: "POST",
    body: { ...payload, channel: "nuwax-web", receivedAt: Date.now() },
  });
}
```

### 5.8 实施步骤(仓库 B)

| Phase | 内容 |
|---|---|
| B1 | 类型 + 枚举扩展(`MessageInfo.intervention`、`MessageModeEnum.INTERVENTION`、`ConversationEventTypeEnum` 新事件) |
| B2 | conversationInfo model SSE 识别 + 消息列表插入/更新 |
| B3 | `AgentInterventionCard` + `SchemaForm` + `StepWizard` 三组件 |
| B4 | `respondAgentIntervention` API |
| B5 | `ChatView` 渲染分支,优先渲染 intervention 卡片 |
| B6 | 历史回放兼容:resolved/expired 卡片不可提交 |
| B7 | 端到端验证(配合 Electron + 后端) |

---

## 6. 仓库 C:Nuwax Mobile(`/Users/apple/workspace/nuwax-mobile`)

### 6.1 现状起点

- 技术栈:UniApp X(UTS / UVue),支持 H5 + 微信小程序 + App
- 会话页:`subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`
- 业务层:`subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts`(SSE 解析、消息列表更新)
- 类型:`types/interfaces/conversationInfo.uts`(`MessageInfo` + `MessageTypeEnum` + `MessageModeEnum` + `ConversationEventTypeEnum`)
- 现有 SSE 事件:`PROCESSING / MESSAGE / FINAL_RESULT / ERROR`
- 已有 question 初步支持:SSE `type=QUESTION` + `ext[]` → 候选选项快捷按钮(可参考但要重做)
- 现有控件:`drawer-popup`、`modal-popup`、`uni-popup`、`lime-button`、`lime-checkbox`、`radio-list-drawer`
- 无 JSON Schema 表单渲染能力

### 6.2 本期目标:M0 + M1 + M2(approval + 单选/多选/短文本)

| 阶段 | 范围 |
|---|---|
| **M0** | fallback:后端额外推普通 `MESSAGE` + webUrl,未识别 `INTERVENTION_REQUEST` 安全忽略 |
| **M1** | approval 卡片:`allow_once / allow_always / reject` + 可选 reason 短文本 |
| **M2** | question drawer:单选 / 多选 / 短文本 |

**M3+(独立表单页 / wizard / diff)** 不在本期范围,触发时显示"请打开 Web 处理"+ webUrl 跳转。

### 6.3 关键文件清单

| 操作 | 路径 |
|---|---|
| 修改 | `types/interfaces/conversationInfo.uts` `MessageInfo` 增 `intervention?: MobileInterventionInfo`(扁平字段,UTS 限制) |
| 修改 | `types/enums/agent.uts` `ConversationEventTypeEnum` 新增 `INTERVENTION_REQUEST` / `INTERVENTION_UPDATE`;`MessageModeEnum` 新增 `INTERVENTION` |
| 修改 | `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts` `handleChangeMessageList()` 识别新事件 |
| 修改 | `subpackages/pages/chat-conversation-component/chat-conversation-component.uvue` assistant message 分支增加 intervention 卡片渲染 |
| 新增 | `subpackages/components/mobile-intervention-card/mobile-intervention-card.uvue`(M1 主卡片) |
| 新增 | `subpackages/components/checkbox-list-drawer/checkbox-list-drawer.uvue`(M2 多选) |
| 新增 | `subpackages/components/text-input-drawer/text-input-drawer.uvue`(M2 短文本) |
| 复用 | `components/radio-list-drawer/radio-list-drawer.uvue`(M2 单选) |
| 新增 | `servers/agentIntervention.uts`(`respondAgentIntervention()` API) |

### 6.4 M0 fallback 约束

- 后端 SSE 对移动端同时推送:
  1. 标准 `INTERVENTION_REQUEST` 事件(移动端可能识别也可能忽略)
  2. 普通 `MESSAGE` 事件,text 内容含:`fallbackText`(描述需要确认的操作) + `webUrl`(跳转链接)
- 移动端必须**安全忽略未识别事件**(`AgentDetailService.uts` 的 switch default 不抛错、不中断)
- 用户点击 webUrl → 跳转 H5 Chat 页面或单独 intervention 页面完成响应

### 6.5 M1 approval 卡片(`mobile-intervention-card.uvue`)

- 渲染在消息气泡内,头部显示工具图标 + 标题 + severity 标签
- 摘要区:命令/路径/描述(从 `rawInput` + `locations[]` 派生,扁平字符串展示)
- 按钮区底部固定:`allow_once` / `allow_always` / `reject`(按 PermissionOption.kind 渲染)
- 拒绝时弹 `text-input-drawer` 输入 reason(可选)
- 提交调 `respondAgentIntervention` API
- 状态显示:`pending` / `approved` / `rejected` / `cancelled` / `expired` / `superseded`,非 pending 全部禁用

### 6.6 M2 question drawer

| schema 形态 | 组件 |
|---|---|
| `string + enum/oneOf` | `radio-list-drawer`(复用) |
| `array + items.enum + uniqueItems` | `checkbox-list-drawer`(新增) |
| `string + maxLength` | `text-input-drawer`(新增) |

**支持的 schema 子集**(M2 严格限制):

```json
{
  "type": "object",
  "properties": {
    "choice": { "type": "string", "oneOf": [...] },
    "items": { "type": "array", "uniqueItems": true, "items": { "type": "string", "enum": [...] } },
    "note": { "type": "string", "maxLength": 500 }
  }
}
```

复杂 schema(嵌套对象、数组对象、动态联动) → 显示"请打开 Web 处理" + fallback.webUrl 按钮。

### 6.7 SSE 事件处理(`AgentDetailService.uts`)

```typescript
// handleChangeMessageList 内
if (event.eventType == "INTERVENTION_REQUEST") {
  const req = event.data as MobileInterventionInfo;
  const message: MessageInfo = {
    id: `intervention-${req.id}`,
    role: AssistantRoleEnum.ASSISTANT,
    type: MessageModeEnum.INTERVENTION,
    intervention: req,
    // ...
  };
  this.messageList.push(message);
  return;
}
if (event.eventType == "INTERVENTION_UPDATE") {
  const update = event.data;
  const msg = this.messageList.find(m => m.intervention?.id == update.interventionId);
  if (msg != null && msg.intervention != null) {
    msg.intervention.status = update.status;
  }
  return;
}
// default: 安全忽略
```

### 6.8 实施步骤(仓库 C)

| Phase | 内容 |
|---|---|
| C0 | M0 fallback:类型扩展、事件忽略保护、`MESSAGE` fallback 兼容 |
| C1 | M1 approval 卡片:`mobile-intervention-card` + `respondAgentIntervention` API |
| C2 | M2 单选(复用 radio-list-drawer)+ 多选(新增 checkbox-list-drawer)+ 短文本(新增 text-input-drawer) |
| C3 | INTERVENTION_UPDATE 状态同步,非 pending 禁用 |
| C4 | 复杂 schema 降级 webUrl 跳转 |
| C5 | 端到端验证(H5 + 微信小程序 + App 三端各跑一遍) |

---

## 7. 后端协作契约(`nuwax/` 后端,不在本文档实施范围,但需对齐)

虽然本文档不实施后端,但接手 Agent 必须把这部分契约**告知后端团队**:

### 7.1 后端新增 endpoint

| Endpoint | 方向 | 说明 |
|---|---|---|
| `POST /api/internal/agent-interventions/dispatch` | Electron Main → 后端 | 接收 approval `InterventionRequest`,通过会话 SSE 分发到 Web/Mobile |
| `POST /api/agent-interventions/:interventionId/respond` | Web/Mobile → 后端 | 接收响应,**approval** 转发到 Electron Main `HumanInterventionService.respond()`;**ask** 转发到 MCP server tool_result |
| `POST /api/internal/agent-interventions/:interventionId/notify-resolved` | 后端 → Electron Main | 通知主进程已有响应(可选,如走 SSE 双向通道则不需要) |
| 会话 SSE 新增 eventType | 后端 → Web/Mobile/webview | `INTERVENTION_REQUEST`(approval + ask 两类共用) / `INTERVENTION_UPDATE`(详见 §3.4) |

### 7.2 后端职责

- Web/Mobile 响应校验:`revision + idempotencyKey + actor + expiry`
- 同一 intervention 只接受一次有效响应,后续重复 → 返回"已处理"toast
- 多端响应竞态:后端用 unique constraint 保证一致性,通过 `INTERVENTION_UPDATE` 同步状态到其他端
- **approval / ask 路由**:respond endpoint 根据 InterventionRequest.source 字段路由:`acp_permission` → 回 Electron;`mcp_ask` → 回 MCP server
- Mobile M0 fallback:后端推 `INTERVENTION_REQUEST` 时同步推一条 `MESSAGE`(text + webUrl)

### 7.3 新 Ask MCP server(独立交付,本文档不实施)

新 MCP server 由独立团队/Agent 实现,与本文档客户端交付**通过数据格式约束**对齐:

| 项 | 约定 |
|---|---|
| 工具名 | 待 MCP 团队最终命名(候选 `nuwax_ask_user` / `nuwaclaw_ask_user`) |
| 工具输入 schema | `InteractionUISchema`(§3.2)的 JSON 表达 |
| 工具行为 | 把请求转为 `InterventionRequest { kind: "question", source: "mcp_ask", ui: <input>, ... }`,通过 Nuwax Backend 会话 SSE 下发 |
| 工具输出 | 来自客户端 respond endpoint 的 `formData`,作为 tool result 返回给 Agent |
| 工具调用挂载 | 由 Nuwax Backend 在 Agent session 启动时注入 MCP server URL(参考 Electron 现有 `mcpServers` 注入机制) |

**对客户端实施 Agent 的提醒**:

- 实施 Web/Mobile 时,SSE 处理逻辑**不需要区分** approval / ask,统一按 `InterventionRequest` 处理即可,UI 渲染 / 响应 API 完全相同
- 实施 Electron 时,主进程**不要**为 ask 路径实现任何逻辑(它不经过 Electron 主进程);Electron 本地 Modal 也**不渲染** ask(ask 只在 webview 内的 Nuwax Web 渲染)

### 7.3 后端 engine adapter(可选)

后端 engine adapter(claude-code / nuwaxcode / codex)**推荐**在 ACP `session/new` 响应中返回 `modes: { currentModeId, availableModes }`,使用 `ask` / `auto` / `yolo` 三个 id 与客户端对齐。

如果后端不返回 `modes`,客户端 SessionModeSelector 仍会展示客户端内置三档,本地切换照样生效(只是不调 ACP `session/set_mode`)—— **客户端不被后端阻塞**。

---

## 8. 验收清单(三端联调)

### 8.1 Electron 客户端(仓库 A)

参考 4.9 + 以下:

1. 三档模式切换可见可用,持久化生效
2. ask 模式弹本地 Modal(`NuwaxWebDelivery` 暂未接入时)
3. auto 模式按 toolKind 分流
4. yolo 维持现状,strict-sandbox 仍 fail closed
5. session/cancel 时 pending modal 立即关闭,Agent 收到 cancelled
6. 表单控件全覆盖:approval 单选 / Radio / Checkbox / Input / TextArea / InputNumber / Switch / wizard

**Action 路径验证**:

7. 弹窗中点击主操作按钮 → `action = submit`,提交 formData,Agent 收到 `selected/optionId`
8. 弹窗中点击取消/关闭 → `action = cancel`,Agent 收到 `cancelled`(meta reason = manual)
9. 弹窗中点击"跳过"(若 schema 设置 `allowSkip = true`)→ `action = skip`,Agent 收到 `cancelled`(meta reason = skipped)
10. 超时无响应 → `action = timeout`,自动 cancel pending,Agent 收到 `cancelled`(meta reason = timeout)

### 8.2 Nuwax Web(仓库 B)

7. Chat 页面收到 SSE INTERVENTION_REQUEST → 渲染 AgentInterventionCard 在消息流中(approval / ask 两类统一处理)
8. approval 卡片点击按钮 → POST 响应 API → 收到 INTERVENTION_UPDATE → 卡片置 disabled + 显示处理人
9. **ask 路径**(由新 MCP 工具触发,SSE 同一通道下发):question 表单(单选 / 多选 / 文本 / 数字 / 布尔)正确渲染并能提交,响应作为 MCP tool_result 回到 Agent
10. wizard 多步骤正确分步校验
11. 历史回放:已 resolved 的 intervention 卡片不可重复提交
12. 同一会话多个 pending intervention 顺序显示
13. 客户端代码**不区分** approval / ask 的渲染逻辑,完全共用 SchemaForm / StepWizard

### 8.3 Nuwax Mobile(仓库 C)

14. M0:不修改代码也能看到 fallback MESSAGE + webUrl 链接,未知事件不报错
15. M1:approval 卡片可完成 approve once / always / reject(`source = acp_permission`)
16. M2:ask 来源(`source = mcp_ask`)的单选 / 多选 / 短文本 drawer 可提交,响应回到 MCP server tool_result
17. INTERVENTION_UPDATE 同步:Web 端处理后,移动端卡片置灰显示"已由 Web 端处理"
18. 复杂 schema:显示"请打开 Web 处理" + webUrl 按钮
19. H5 + 微信小程序 + App 三端均可用

### 8.4 跨端竞态

19. 多端同时打开同一会话,Web 先响应 → Electron Modal 自动关闭 + Mobile 卡片置灰
20. 移动端响应 → Web 卡片 + Electron Modal 同步状态
21. revision 校验:旧 revision 响应被后端拒绝并返回 superseded

---

## 9. 风险与注意事项

| 风险 | 影响范围 | 缓解 |
|---|---|---|
| ACP SDK 可能缺 `setSessionMode` 方法 | A | 用 `connection.connection.sendRequest("session/set_mode", ...)` 兜底 |
| `newSession` 响应类型未声明 `modes` | A | `(result as any).modes` 临时绕过 |
| engine `availableModes` 与 client 三档语义不同 | A | fail-safe 降级 `ask`(§4.3),UI 仍显示原始 modeId 文本告知用户 |
| Electron 与 rcoder 两个 client 设计漂移 | A + rcoder | 以本文档作为设计基线,定期对照(尤其 schema version、action 集合、mode 语义)|
| 后端 dispatch / respond endpoint 未就绪 | A/B/C | Electron 先发布纯本地 Modal 版本(`NuwaxWebDelivery` 作为可选 channel);Web/Mobile 端在后端就绪后再上 |
| 后端 hooks 未写好 | A | 与本期解耦,不阻塞 |
| UniApp X 类型严格 | C | `intervention` 字段用扁平结构,不要深嵌套 |
| 微信小程序 SSE 长连接易断 | C | 接 fallback 跳 H5 |
| 数据格式三端漂移 | A/B/C | **单一来源** = Electron `src/shared/types/intervention.ts`,Web/Mobile 复制时严格对齐 |
| revision 冲突 | A/B/C | 后端 unique constraint;前端校验失败显示 superseded |
| Mobile 暴露 `yolo` 误导 | C | 移动端**只展示模式状态、不提供切换 UI**(切换只在 Electron 完成)|
| `auto` 低风险白名单偏激进/保守 | A | 起步 `{read,search,think,fetch}`,根据反馈调整;**不允许**加入 execute/edit |

---

## 10. 提交前自查 checklist

### 仓库 A(Electron)

- [ ] §4.2 所有文件已修改/创建
- [ ] 三档分流逻辑与 §4.4 一致
- [ ] mode 解析优先级与 §4.3 一致
- [ ] IPC channel 名与 §4.7 一致
- [ ] SQLite 表 schema 与 §4.8 一致(`agent_session_modes`)
- [ ] `HumanInterventionService.deliveries` 支持多 channel 注册
- [ ] LocalRendererDelivery + NuwaxWebDelivery 两个实现就位(后端未就绪时 NuwaxWebDelivery 可注册为 noop stub)
- [ ] `InterventionRequest.engine` 仅枚举 ACP engines(`claude-code` / `nuwaxcode` / `codex`),UI / Service 不做引擎特化分支
- [ ] `InterventionResponse.action` 支持 `submit` / `cancel` / `skip` / `timeout` 四种,UI 区分按钮触发
- [ ] `skip` 按钮仅在 `uiSchema.allowSkip = true` 时渲染
- [ ] i18n 4 个 locale 文件同步
- [ ] 旧 `PermissionModal.tsx` 标 `@deprecated`,未删除
- [ ] 单测覆盖 §4.4 三档分流 + service 超时/cancel/revision
- [ ] 端到端 §8.1 验证通过

### 仓库 B(Nuwax Web)

- [ ] §5.2 所有文件已修改/创建
- [ ] `MessageInfo.intervention` 字段定义与 §3.1 一致
- [ ] `ConversationEventTypeEnum` 新增两个值
- [ ] `AgentInterventionCard` 支持 inline + wizard 两种 presentation
- [ ] SchemaForm 覆盖全部控件
- [ ] `respondAgentIntervention` API 接入
- [ ] 历史回放兼容
- [ ] 端到端 §8.2 验证通过

### 仓库 C(Mobile)

- [ ] §6.3 所有文件已修改/创建
- [ ] M0 fallback 保护已加(未知事件不抛错)
- [ ] `mobile-intervention-card` 完成 M1
- [ ] 三个 drawer 完成 M2(单/多/文本)
- [ ] INTERVENTION_UPDATE 状态同步生效
- [ ] 复杂 schema 降级 webUrl
- [ ] **不提供** mode 切换 UI(只展示状态,切换在 Electron)
- [ ] H5 + 小程序 + App 三端跑过
- [ ] 端到端 §8.3 验证通过

### 跨端联调

- [ ] §8.4 多端竞态场景通过
- [ ] 数据格式三端字段名严格一致
- [ ] 后端契约 §7 已与后端团队对齐

---

## 11. 交付次序建议

由于三端有依赖关系,建议按以下顺序推进:

1. **A1–A4**(Electron 类型/Service/UI 本地闭环)→ 可独立发布 Electron 版本
2. **后端契约对齐**(§7)→ 后端实现 dispatch / respond / SSE eventType
3. **A5**(Electron NuwaxWebDelivery 接入)+ **B1–B7**(Web)并行 → 联调
4. **C0–C5**(Mobile)→ 联调
5. **§8.4 多端竞态**最后整体验证(任一可用 ACP 引擎走完整路径)

---

*文档状态:Plan approved,等待实施。原始 plan 在 `/Users/apple/.claude/plans/hooks-agent-engine-wobbly-dream.md`。本文档优先级高于 plan,有冲突以本文档为准。*

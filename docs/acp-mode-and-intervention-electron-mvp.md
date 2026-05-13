# ACP 模式切换 + 权限审批/Ask 表单 —— Electron 客户端 MVP 实施方案

| 项 | 内容 |
|---|---|
| 状态 | Plan approved,待实施 |
| 适用仓库 | `crates/agent-electron-client/`(本仓库 Electron 客户端) |
| 关联文档 | [universal-agent-acp-hooks-human-intervention-v3.md](./universal-agent-acp-hooks-human-intervention-v3.md)(上层方案);[agent-intervention-channel-calling.md](./agent-intervention-channel-calling.md)(多端调用) |
| 目标读者 | 接手实施的 AI Agent / 工程师 |
| 创建日期 | 2026-05-13 |

---

## 0. 给接手 Agent 的交付说明

### 0.1 本文档的位置

- **上层方案(v3)**:`docs/universal-agent-acp-hooks-human-intervention-v3.md` 定义了全局架构、多端目标(Nuwax Web/Mobile/IM)与最终形态。
- **多端调用方案**:`docs/agent-intervention-channel-calling.md` 定义跨端渲染降级。
- **本文档**:**专门聚焦 Electron 客户端本仓库的 MVP 落地方案**。v3 的多端方案对本期是"参考与对齐目标",本期不实现 Web/Mobile/IM,只交付:
  1. ACP 原生 mode 切换(`ask` / `auto` / `yolo` 三档)
  2. ACP `session/request_permission` 真闭环(替换当前 auto-approve 伪闭环)
  3. 本地兜底 UI(Ant Design Modal)+ 跨端对齐的数据格式

### 0.2 实施前必读(按顺序)

| 步骤 | 文件 / 章节 | 目的 |
|---|---|---|
| 1 | 本文档 §1 - §3(背景、ACP 协议约束、客户端现状) | 理解为什么这么做 |
| 2 | `crates/agent-electron-client/src/main/services/engines/acp/acpEngine.ts:740-781`(initialize)、`:2399-2523`(handlePermissionRequest)、`:1700-1730`(respondPermission)、`:140-150`(pendingPermissions) | 理解 ACP 现状 |
| 3 | `crates/agent-electron-client/src/main/services/engines/acp/acpClient.ts` 的 `createAcpConnection` | 理解连接建立 |
| 4 | `crates/agent-electron-client/src/main/services/engines/unifiedAgent.ts` | 理解上层 agent 服务 |
| 5 | `crates/agent-electron-client/src/renderer/components/modals/PermissionModal.tsx`(legacy) | 理解将被替换的旧 UI |
| 6 | `crates/agent-electron-client/src/renderer/App.tsx` 与 `src/renderer/components/pages/SessionsPage.tsx`(webview 嵌入式架构) | 理解 UI 落点约束 |
| 7 | `crates/agent-electron-client/CLAUDE.md` | 项目工程约定(i18n / 测试 / 日志规则) |
| 8 | ACP 协议官网 https://agentclientprotocol.com/protocol/session-modes 与 /protocol/tool-calls | 协议权威定义 |

### 0.3 实施前需要的工具与权限

- Node.js / npm(项目本身要求)
- 能在本机运行 `npm run dev`(Electron dev 模式)
- 能跑 `npm test`(Vitest)
- 能修改 SQLite schema(本项目 DB 在 `~/.nuwaclaw/nuwaclaw.db`)
- ACP SDK 版本以仓库 `package.json` 为准,**不要升级 SDK**

### 0.4 不在本期范围

明确**不做**的事(避免范围蔓延):

1. **不做** Nuwax Web 的 `AgentInterventionCard` 实现(在 `/Users/apple/workspace/nuwax` 仓库,另一个 Agent 任务)
2. **不做** Nuwax Mobile 移动端实现(`/Users/apple/workspace/nuwax-mobile`)
3. **不做** IM 渠道(飞书/钉钉/企业微信等)
4. **不做** hooks 注入(后端 `nuwax-file-server` 负责)
5. **不做** Audit/历史回看的 SQLite 表(本期纯内存 pending,后续再扩)
6. **不做** MCP `nuwaclaw_ask_user` 工具的服务端注入(question 来源协议层先打通)
7. **不动** 现有 `permissionManager` 沙箱本地审批路径(它服务于命令/文件本地拦截,与 ACP 路径无关,保留)

---

## 1. 背景与目标

### 1.1 改造起因

- 旧方案曾计划在 Electron 客户端层注入跨引擎 hooks 配置,**已废弃**。
- **新方向**:hooks 完全由后端 `nuwax-file-server` 在项目初始化时按 engine 写入(claude-code → `.claude/settings.json`、codex/nuwaxcode → 各自配置文件)。Electron 客户端不再管 hooks。
- Electron 客户端职责**重新聚焦**到:模式选择 + 权限审批/Ask 表单 UI。

### 1.2 核心交付物 = "放开模式选择"

当前 `acpEngine.ts:2483-2487` 的 `handlePermissionRequest` auto-select 逻辑(`allow_always > allow_once > options[0]`)等同于**唯一且隐藏的 yolo 模式实现** —— 用户没有任何切换入口,`session/request_permission` 永远不弹窗,nuwaclaw 当前就是靠这段代码"通过设置为 allow 模拟 yolo"。

本期改造把这个隐藏行为**显式化**为三档用户可选:

| modeId | 客户端 `handlePermissionRequest` 行为 |
|---|---|
| `ask` | 所有 ACP `session/request_permission` 全部弹窗等待用户响应 |
| `auto` | `toolCall.kind` ∈ `{read, search, think, fetch}` 自动 `allow_once`;`{edit, delete, move, execute, other}` 走 UI |
| `yolo` | 维持现有 `allow_always > allow_once > options[0]` 自动选择(保留 strict-sandbox guard) |

未知 mode → fail-safe 降级 `ask`。

### 1.3 出厂默认 mode = `auto`

既不破坏写文件等高频流程(读类操作 auto-approve),又让高风险操作引入审批弹窗,让用户感知"放开模式选择"的能力。

### 1.4 三端架构关系(本期 Electron 在其中的位置)

```
                  ┌─────────────────────────────────────────┐
                  │  Electron Main Process (本仓库)            │
                  │  - AcpEngine 接 claude-code/nuwaxcode/...   │
                  │  - HumanInterventionService(本期新增)    │
                  │  - 当前 Mode 状态、IPC 调度                  │
                  └────┬────────────────────┬───────────────┘
                       │                     │
       ┌───────────────┘                     └─────────────┐
       ▼                                                    ▼
┌──────────────────┐                          ┌────────────────────────┐
│ Electron Renderer │ ← 兜底 UI(Ant Design   │ Nuwax Web (主路径,后续) │
│ InterventionModal │   Modal,本期实现)       │ AgentInterventionCard   │
│ SessionModeSelector│                         │ (在 webview 内运行)      │
└──────────────────┘                          └────────────────────────┘
                                                        │
                                                        │  (后续阶段:
                                                        ▼   Nuwax Backend
                                              ┌──────────────────────┐   SSE 多端分发)
                                              │ Mobile / IM(本期不做) │
                                              └──────────────────────┘
```

**Electron 客户端在多端方案中的定位**:它既是 ACP 主控,又是一个 UI 端(本地 Modal 作为兜底)。Nuwax Web/Mobile/IM 由后端 `HumanInterventionService` 统一调度,Electron 不感知其他渠道。

---

## 2. ACP 协议约束(实现依据)

来源:https://agentclientprotocol.com/

### 2.1 ACP 原生 mode 机制(关键)

**ACP 协议本身就支持 mode**,不需要约定自定义 `_meta` 字段:

- `SessionMode { id, name, description }`
- `SessionModeState { currentModeId, availableModes[] }`
- `session/new` 响应可携带 `modes: SessionModeState | null`
- `session/set_mode { sessionId, modeId }`(Client → Agent)
- `session/update` 的 `current_mode_update { currentModeId }`(Agent → Client,Agent 主动切换)
- 典型语义:`ask` / `architect` / `code` —— 本方案用 `ask` / `auto` / `yolo`

### 2.2 审批闭环时序

```
Agent: session/update(tool_call, status=pending)
Agent: session/request_permission(sessionId, toolCall, options[])
Client: 渲染 UI / 自动决策 → 返回 { outcome: "selected", optionId } | { outcome: "cancelled" }
Agent: session/update(tool_call_update, status=in_progress) → 执行 → completed/failed
```

### 2.3 协议层强约束(MUST)

- session/cancel 时,Client **必须**对所有 pending `session/request_permission` 回 `cancelled` + **必须**把未完成 tool call 标记 `cancelled`
- Agent **必须**用 `cancelled` 作为 stopReason 回应原始 prompt
- 客户端自动决策有协议背书:`Clients MAY automatically allow or reject permission requests according to the user settings`(yolo / auto 自动选项合规)

### 2.4 UI 渲染信息来源

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
- 二者**独立、互不替代**。客户端**不能假设** "ask 模式 = Agent 必然每次发 permission"(Agent 可能预过滤);客户端可以在 Agent yolo 时强制本地弹窗。

### 2.6 协议没有 `question` ToolKind

- ACP ToolKind 枚举只有:`read / edit / delete / move / search / execute / think / fetch / other`
- 当前 `acpEngine.ts:2408` 对 `kind === "question"` 的处理是 **nuwaxcode 私有扩展**,不是 ACP 标准
- 通用 ask/question 应走 MCP 工具 `nuwaclaw_ask_user`(本期不实现,数据格式预留)

---

## 3. 客户端现状(待改造的起点)

- **本地无消息流容器**:`SessionsPage.tsx` 用 `<webview>` 嵌入远端 Nuwax Chat,本地渲染进程不渲染 ACP 消息。因此 UI 落点只能是 **全局 Modal**,不能"插入消息流卡片"。
- **PermissionModal 是孤立组件**:`src/renderer/components/modals/PermissionModal.tsx` 不被任何组件 import 挂载,已是"半完工"状态。本期标记 legacy,新建 InterventionModal 替换。
- **ACP initialize 当前只传**:`{ protocolVersion, clientCapabilities: { terminal: true } }`(`acpEngine.ts:740`),未读取 `modes` 字段。
- **handlePermissionRequest 当前行为**:question 直接 cancelled、strict-sandbox 越界 cancelled,其他自动 `allow_always > allow_once > options[0]` —— 即隐式 yolo。
- **pendingPermissions Map + respondPermission()** 已存在(`acpEngine.ts:145`、`:1723`),但未被 handlePermissionRequest 使用,本期接入。

---

## 4. 目标方案

### 4.1 ACP 模式管理(原生 set_mode + 客户端硬约定 id)

**协议层修改**(`crates/agent-electron-client/src/main/services/engines/acp/acpEngine.ts`):

```ts
// initialize: 保持现状,不动

// newSession: 从响应读取 modes(后端可选返回)
const newSessionResult = await connection.newSession({ cwd, mcpServers, _meta });
const sessionModes: SessionModeState | null = (newSessionResult as any).modes ?? null;
session.currentModeId = sessionModes?.currentModeId ?? null;
session.availableModes = sessionModes?.availableModes ?? null;

// 新增 setMode: 走 ACP 标准
async setMode(sessionId: string, modeId: string): Promise<void> {
  const session = /* 查找 */;
  if (this.acpConnection && session.availableModes) {
    // 后端支持 → 调 ACP 协议
    await this.acpConnection.setSessionMode({
      sessionId: session.acpSessionId,
      modeId
    });
  }
  // 同步本地 mode(无论 ACP 是否支持)
  session.localMode = modeId;
  await persistSessionMode(sessionId, modeId);  // SQLite 持久化
  this.emit("mode.updated", { sessionId, modeId, source: session.availableModes ? "acp" : "local" });
}

// handleSessionUpdate: 新增 current_mode_update 分支
case "current_mode_update":
  session.currentModeId = update.currentModeId;
  this.emit("mode.updated", { sessionId, modeId: update.currentModeId, source: "acp" });
  break;
```

**mode 解析优先级**(`handlePermissionRequest` 内使用):

```
session.currentModeId (ACP session/set_mode/通知设置过, 后端权威)
  └─ 缺失则 → session.localMode (用户在客户端 UI 切换并持久化)
       └─ 缺失则 → settings.intervention.defaultMode (全局默认)
            └─ 缺失则 → 硬编码 "auto"
```

**SessionModeSelector 始终可用**:

- 后端返回 `availableModes` → 选择器展示后端声明的标签/描述,切换调 ACP `session/set_mode` 推到后端
- 后端没返回 `availableModes` → 选择器展示客户端内置三档(`ask`/`auto`/`yolo`),切换只写本地 mode,**不调** ACP set_mode
- 二者都允许 UI 切换 → 核心交付物**不被后端进度阻塞**

### 4.2 统一数据格式(跨端对齐)

**新增** `crates/agent-electron-client/src/shared/types/intervention.ts`:

```ts
export type InterventionKind = "approval" | "question";
export type InterventionStatus = "pending" | "answered" | "approved" | "rejected" | "cancelled" | "expired";

export interface InterventionRequest {
  id: string;                                            // 客户端生成 UUID
  revision: number;                                      // 起始 1,后续 reissue 递增
  kind: InterventionKind;
  status: InterventionStatus;
  sessionId: string;
  engine: "claude-code" | "nuwaxcode" | "codex";
  source: "acp_permission" | "mcp_ask";
  title: string;
  description?: string;
  severity: "info" | "warning" | "danger";

  approval?: {
    acpInternalId?: string;                              // 内部映射键(ACP 无 permissionId)
    toolCall: {
      toolCallId: string;
      name?: string;
      kind: string;                                      // ACP ToolKind
      rawInput?: unknown;
      locations?: Array<{ uri: string; name?: string; size?: number }>;
    };
    options: Array<{
      optionId: string;                                  // 来自 ACP PermissionOption.optionId
      kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
      label: string;                                     // 来自 ACP PermissionOption.name
    }>;
  };

  ui: InteractionUISchema;
  timeoutMs: number;
  createdAt: number;
}

export interface InteractionUISchema {
  version: "nuwaclaw.interaction.v1";
  presentation: "modal" | "inline" | "wizard";
  title: string;
  description?: string;
  schema: JsonSchemaObject;                              // JSON Schema 子集
  uiSchema?: Record<string, unknown>;
  steps?: Array<{ id: string; title: string; description?: string; fields: string[] }>;
  submitLabel?: string;
  cancelLabel?: string;
  fallback?: { text: string; webUrl?: string };
}

export interface InterventionResponse {
  interventionId: string;
  revision: number;
  action: "submit" | "cancel";
  formData?: Record<string, unknown>;                    // approval 时形如 { decision: "allow_once" }
  receivedAt: number;
}
```

**新增** `crates/agent-electron-client/src/shared/types/acpMode.ts`:

```ts
export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionMode[];
}

export const CLIENT_BUILTIN_MODES: SessionMode[] = [
  { id: "ask", name: "Ask", description: "每次工具调用前请求确认" },
  { id: "auto", name: "Auto", description: "低风险操作自动通过,高风险弹窗确认" },
  { id: "yolo", name: "Yolo", description: "全自动通过(仅在受信环境使用)" },
];
```

**approval schema 自动生成规则**(主进程内 `buildApprovalRequest()`):

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

### 4.3 主进程:HumanInterventionService + handlePermissionRequest 改造

**新增** `crates/agent-electron-client/src/main/services/engines/acp/humanInterventionService.ts`:

```ts
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

interface PendingEntry {
  req: InterventionRequest;
  resolve: (resp: InterventionResponse) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class HumanInterventionService extends EventEmitter {
  private pending = new Map<string, PendingEntry>();
  private DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

  async create(req: Omit<InterventionRequest, "id" | "revision" | "status" | "createdAt"> & { id?: string }): Promise<InterventionResponse> {
    const id = req.id ?? randomUUID();
    const fullReq: InterventionRequest = {
      ...req,
      id,
      revision: 1,
      status: "pending",
      createdAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.emit("update", { interventionId: id, status: "expired" });
        resolve({ interventionId: id, revision: 1, action: "cancel", receivedAt: Date.now() });
      }, req.timeoutMs ?? this.DEFAULT_TIMEOUT_MS);

      this.pending.set(id, { req: fullReq, resolve, reject, timer });
      this.emit("request", fullReq);  // → IPC 推送渲染进程
    });
  }

  respond(payload: InterventionResponse): { ok: boolean; reason?: string } {
    const entry = this.pending.get(payload.interventionId);
    if (!entry) return { ok: false, reason: "not_found" };
    if (payload.revision !== entry.req.revision) return { ok: false, reason: "revision_mismatch" };
    clearTimeout(entry.timer);
    this.pending.delete(payload.interventionId);
    this.emit("update", {
      interventionId: payload.interventionId,
      status: payload.action === "submit" ? "answered" : "cancelled"
    });
    entry.resolve(payload);
    return { ok: true };
  }

  cancelBySession(sessionId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.req.sessionId === sessionId) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        this.emit("update", { interventionId: id, status: "cancelled" });
        entry.resolve({ interventionId: id, revision: entry.req.revision, action: "cancel", receivedAt: Date.now() });
      }
    }
  }

  cancelByInterventionId(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    this.emit("update", { interventionId: id, status: "cancelled" });
    entry.resolve({ interventionId: id, revision: entry.req.revision, action: "cancel", receivedAt: Date.now() });
  }
}
```

**改造** `acpEngine.ts:2399 handlePermissionRequest`:

```ts
private async handlePermissionRequest(params: AcpPermissionRequest): Promise<AcpPermissionResponse> {
  const acpSessionId = params.sessionId;
  const session = this.sessions.get(acpSessionId);
  if (!session) return { outcome: { outcome: "cancelled" } };

  // 1) legacy: strict-sandbox 越界 fail closed (保留现状)
  const strictCheck = evaluateStrictWritePermission(params, { /* 现状参数 */ });
  if (strictCheck.blocked) return { outcome: { outcome: "cancelled" } };
  const strictWriteMode = this.isStrictSandboxActiveForNuwaxcode() && strictCheck.isWriteRequest;

  // 2) nuwaxcode 私有 question kind 兼容(不是 ACP 标准)
  if (params.toolCall.kind === "question") return { outcome: { outcome: "cancelled" } };

  // 3) 解析当前 mode
  const mode = this.resolveSessionMode(session);  // 走 4.1 节优先级链
  log.info(`${this.logTag} permission request mode=${mode}, toolKind=${params.toolCall.kind}`);

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

  // 6) ask / auto-高风险 / unknown mode → 走 InterventionService
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

session destroy 时(`acpEngine.ts:783-810 destroy()`)调用 `humanInterventionService.cancelBySession(sessionId)`,与现有 `pendingPermissions` 清理逻辑并存。

### 4.4 IPC 通道

| IPC channel | 方向 | Payload |
|---|---|---|
| `agent:setSessionMode` | renderer → main | `{ sessionId, modeId }` |
| `agent:getSessionModes` | renderer → main | `{ sessionId }` → `{ acpModes: SessionModeState \| null, localMode: string \| null, effectiveMode: string }` |
| `agent:mode.updated` | main → renderer | `{ sessionId, modeId, source: "acp" \| "local" }` |
| `intervention:request` | main → renderer | `InterventionRequest` |
| `intervention:respond` | renderer → main | `InterventionResponse` → `{ ok, reason? }` |
| `intervention:cancel` | renderer → main | `{ interventionId }` |
| `intervention:updated` | main → renderer | `{ interventionId, status: InterventionStatus }` |

preload 暴露(`src/main/preload.ts`):

```ts
window.electronAPI.agent.setSessionMode(sessionId, modeId)
window.electronAPI.agent.getSessionModes(sessionId)
window.electronAPI.agent.onModeUpdated(callback)
window.electronAPI.intervention.onRequest(callback)
window.electronAPI.intervention.respond(payload)
window.electronAPI.intervention.cancel(interventionId)
window.electronAPI.intervention.onUpdated(callback)
```

### 4.5 渲染进程 UI

**新增组件**(都放在 `src/renderer/components/intervention/`):

| 文件 | 职责 |
|---|---|
| `InterventionRoot.tsx` | 顶层挂载,监听 IPC `intervention:request` 维护 pending 队列(并发多个排队);挂在 `App.tsx` 根。 |
| `InterventionModal.tsx` | 单条 intervention 的 Ant Design `<Modal>` 容器,根据 `presentation` 决定布局(modal/wizard)。 |
| `SchemaForm.tsx` | JSON Schema 子集 → 控件树。 |
| `StepWizard.tsx` | `presentation="wizard"` 多步骤外壳,内部用 SchemaForm 渲染每步。 |
| `SessionModeSelector.tsx` | 模式选择器,挂在 SessionsPage 顶部。 |

**SchemaForm 控件覆盖**(全做,对齐"都要做"要求):

| 控件 | JSON Schema 表达 | Ant Design 实现 |
|---|---|---|
| approval 单选(主用) | `decision: oneOf` + `ui:widget=buttonGroup` | `Space` + `Button` 横排,按 `option.kind` 着色 |
| 单选 | `string + enum/oneOf` | `Radio.Group` |
| 多选 | `array + uniqueItems + items.enum` | `Checkbox.Group` |
| 短文本 | `string + maxLength` | `Input` |
| 长文本 | `string + ui:widget=textarea` | `Input.TextArea` |
| 数字 | `number / integer` | `InputNumber` |
| 布尔 | `boolean` | `Switch` |
| 条件显示 | `ui:visibleWhen: { fieldName: value \| [values] }` | 渲染层判断 |
| 多步骤 | top-level `steps[]` | `StepWizard` + Ant `Steps` 条 |

**自研约束**:< 400 行,不引入 `@rjsf/*` 或其他 JSON Schema 库,避免依赖膨胀。

**SessionModeSelector**:

- Ant Design `Segmented`,展示 `ask` / `auto` / `yolo` 三档
- hover 显示 description(从 ACP `availableModes` 读取,或 `CLIENT_BUILTIN_MODES` 兜底)
- 切换调 `window.electronAPI.agent.setSessionMode`,本地 state 立即反映

### 4.6 持久化与设置

**新增 SQLite 表** `agent_session_modes`:

```sql
CREATE TABLE IF NOT EXISTS agent_session_modes (
  session_id TEXT PRIMARY KEY,
  local_mode TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

迁移文件位置参考现有 DB migration 风格(查 `src/main/services/` 或 `src/main/db/` 下既有 migration 写法,本期沿用)。

**全局设置**:`settings` 表新增 key `intervention.defaultMode` = `"auto"`(D6 决定)。

### 4.7 Nuwax Web 接入点(本期预留,不实现)

`HumanInterventionService` 设计时预留 `deliverTo(channel)` 抽象,后续阶段实现:

- 主进程通过 SSE/WebSocket 推 `InterventionRequest` 到 Nuwax 后端 → 后端通过会话 SSE 投递 webview 内 Nuwax Web → web 端响应回 Nuwax 后端 → 后端回调主进程 `respondIntervention(payload)` API
- Electron 本地 Modal 与 Nuwax Web 二者**只能一个生效**,任一端响应后另一端通过 `intervention:updated` 关闭/置灰

本期 `HumanInterventionService.create()` 只走本地 Modal 单一 channel,但代码结构要为后续扩展留位置(单 channel 等价于"有一个名为 local 的 channel")。

---

## 5. 关键文件清单

| 操作 | 路径 |
|---|---|
| 修改 | `crates/agent-electron-client/src/main/services/engines/acp/acpEngine.ts` (`newSession`:740 / 增加 `setMode` / `handleSessionUpdate` 增 `current_mode_update` 分支 / `handlePermissionRequest`:2399 重写 / `destroy`:783 加 `cancelBySession`) |
| 修改 | `crates/agent-electron-client/src/main/services/engines/unifiedAgent.ts` (暴露 `setMode` 入口、转发 `mode.updated` 事件) |
| 修改 | `crates/agent-electron-client/src/main/ipc/*` (新增 mode / intervention IPC handler;参考现有 IPC 模块的风格 register) |
| 修改 | `crates/agent-electron-client/src/main/preload.ts` (暴露 `agent.setSessionMode` 等 7 个新 API) |
| 修改 | `crates/agent-electron-client/src/renderer/App.tsx` (在 `ConfigProvider` 内挂载 `<InterventionRoot />`) |
| 修改 | `crates/agent-electron-client/src/renderer/components/pages/SessionsPage.tsx` (顶部挂载 `<SessionModeSelector />`) |
| 新增 | `crates/agent-electron-client/src/main/services/engines/acp/humanInterventionService.ts` |
| 新增 | `crates/agent-electron-client/src/main/db/sessionModes.ts` (SQLite 持久化 helper) |
| 新增 | `crates/agent-electron-client/src/shared/types/acpMode.ts` |
| 新增 | `crates/agent-electron-client/src/shared/types/intervention.ts` |
| 新增 | `crates/agent-electron-client/src/renderer/components/intervention/InterventionRoot.tsx` |
| 新增 | `crates/agent-electron-client/src/renderer/components/intervention/InterventionModal.tsx` |
| 新增 | `crates/agent-electron-client/src/renderer/components/intervention/SchemaForm.tsx` |
| 新增 | `crates/agent-electron-client/src/renderer/components/intervention/StepWizard.tsx` |
| 新增 | `crates/agent-electron-client/src/renderer/components/intervention/SessionModeSelector.tsx` |
| 处置 | `crates/agent-electron-client/src/renderer/components/modals/PermissionModal.tsx` 添加 `@deprecated` JSDoc,**不删除**(沙箱本地审批路径如还在用可保留,但 ACP 路径不再走此组件) |
| 新增 i18n | `src/shared/locales/{en-US,zh-CN,zh-HK,zh-TW}.json` 添加 mode 名称、按钮文案、severity 等 key;**严格按 CLAUDE.md i18n 规则**(4 个 locale 文件 + I18N_KEYS 常量 + `t()` 调用三者同步) |

---

## 6. 实施步骤

按以下顺序推进,每步完成后跑相关单测,确认无 regression 再进下一步。

### Phase 1 — 协议层 + 类型(独立可验证)

1. 新增 `acpMode.ts` + `intervention.ts` 类型
2. `acpEngine.ts` 加 `session.currentModeId / availableModes / localMode` 字段
3. `newSession` 读取响应里的 `modes` 字段
4. 新增 `setMode(sessionId, modeId)` 方法
5. `handleSessionUpdate` 增加 `current_mode_update` 分支
6. **单测**:mock ACP connection,验证:
   - `session/new` 响应里的 `modes` 被正确解析到 session 状态
   - `setMode` 调用 ACP `setSessionMode` 并更新本地状态
   - `current_mode_update` 通知触发 `mode.updated` 事件

### Phase 2 — HumanInterventionService + handlePermissionRequest 改造

1. 新建 `humanInterventionService.ts`(纯内存,EventEmitter)
2. 改造 `handlePermissionRequest`:三档分流逻辑(参考 §4.3)
3. `acpEngine.destroy()` 增加 `humanInterventionService.cancelBySession(sessionId)` 调用
4. 新建 `buildApprovalRequest` helper(把 ACP PermissionOption[] 转成 `decision: oneOf` schema)
5. **单测**:
   - yolo 模式维持原 `allow_always > allow_once > options[0]` 行为
   - auto 模式:`toolCall.kind=read` → auto-approve;`toolCall.kind=edit` → 走 service
   - ask 模式:全走 service,resolve 时正确返回 ACP outcome
   - 超时 → service 自动 cancel,handlePermissionRequest 返回 `{ outcome: "cancelled" }`
   - session destroy 时所有 pending 被 cancel
   - revision 校验:`respond` 传错 revision 被拒绝

### Phase 3 — IPC + Preload + SQLite

1. 注册 mode / intervention IPC handler(参考现有 IPC 模块风格)
2. preload 暴露 7 个新 API
3. SQLite migration:新增 `agent_session_modes` 表;`settings` 表插入 `intervention.defaultMode = "auto"`
4. `resolveSessionMode(session)` helper 实现完整优先级链
5. **单测**:
   - IPC handler 收到 `intervention:respond` → 转发到 service.respond
   - `resolveSessionMode` 在四档优先级下正确返回
   - SQLite 持久化与读取

### Phase 4 — 渲染进程组件

1. `SchemaForm.tsx`(最重要,先做完整控件覆盖)
2. `StepWizard.tsx`(简单 Steps 外壳)
3. `InterventionModal.tsx`(Ant Design Modal,按 presentation 路由到 SchemaForm 或 StepWizard)
4. `InterventionRoot.tsx`(IPC 监听 + pending 队列管理)
5. `SessionModeSelector.tsx`(Segmented 三档切换 + hover 描述)
6. 挂载点:
   - `App.tsx` 在 `ConfigProvider` 内挂 `<InterventionRoot />`
   - `SessionsPage.tsx` 顶部挂 `<SessionModeSelector />`
7. i18n key 新增到 4 个 locale 文件 + `I18N_KEYS` 常量

### Phase 5 — 端到端验证(见 §7 验收清单)

### Phase 6 — 后续(本期外,留作 follow-up issue)

- 接 Nuwax Web `AgentInterventionCard`:`HumanInterventionService` 增加 `deliverTo("nuwax-web")` channel
- MCP `nuwaclaw_ask_user` 工具注入与 question 闭环
- Mobile / IM 多渠道分发(在 Nuwax 后端实现,Electron 不感知)

---

## 7. 验收清单

### 7.1 功能验收(端到端)

1. **三档模式切换可见可用**:
   - 启动应用 → SessionsPage 顶部可见 SessionModeSelector
   - 默认显示 `auto`(出厂默认)
   - 点击切换到 `ask` → IPC `agent:setSessionMode` 被调用 → 主进程持久化到 SQLite
   - 重启应用 → mode 保持上次选择(session 级 + 全局默认两层都验证)

2. **ask 模式弹窗闭环**:
   - 选 `ask` → 让 claude-code 写一个文件 → InterventionModal 弹出
   - Modal 展示 toolCall.title 标题、kind 图标、locations 路径、按钮文案来自 `PermissionOption.name`
   - 点"始终允许" → Modal 关闭 → Agent 收到 `selected/allow_always` → 文件被写入
   - 点"拒绝" → Modal 关闭 → Agent 收到 `cancelled` → 操作未执行,session 正常继续

3. **auto 模式分流**:
   - 选 `auto` → 让 agent 读文件(`toolCall.kind=read`)→ 不弹窗,直接通过
   - 让 agent 写文件(`toolCall.kind=edit`)→ InterventionModal 弹出
   - 让 agent 执行命令(`toolCall.kind=execute`)→ InterventionModal 弹出

4. **yolo 模式无破坏**:
   - 选 `yolo` → 所有工具调用都不弹窗,行为与改造前完全一致
   - strict-sandbox 模式下,写入越界仍然 fail closed

5. **取消语义遵循 ACP**:
   - 弹窗 pending 时,用户取消 session(session/cancel)→ Modal 立即关闭并显示"已取消"或直接消失
   - Agent 收到 `cancelled` outcome
   - 没有任何 pending 残留在 service 内存中(`humanInterventionService.pending.size === 0`)

6. **表单控件覆盖**(通过 mock `InterventionRequest` 触发):
   - 单选 (Radio.Group) ✓
   - 多选 (Checkbox.Group) ✓
   - 短文本 (Input) ✓
   - 长文本 (Input.TextArea) ✓
   - 数字 (InputNumber) ✓
   - 布尔 (Switch) ✓
   - 多步骤 wizard (Steps + 分步校验) ✓

### 7.2 单测覆盖

至少包含:

- `handlePermissionRequest.test.ts`:yolo / auto / ask 三档分流(每档至少 3 case)
- `humanInterventionService.test.ts`:create / respond / cancelBySession / cancelByInterventionId / timeout / revision 校验
- `resolveSessionMode.test.ts`:四档优先级
- `acpEngine.mode.test.ts`:`newSession` 解析 modes、`setMode` 调用 ACP、`current_mode_update` 事件
- `schemaForm.test.tsx`:每个控件 render + 提交 formData 正确

### 7.3 不能破坏的现有行为

- 现有 `permissionManager` 沙箱本地审批路径(命令/文件/网络拦截)不受影响
- `acpEngine.respondPermission` 旧 IPC 保留为 legacy adapter(如果其他地方还在用,内部转换成 InterventionResponse 走新链路)
- 现有所有 Vitest 测试通过

### 7.4 工程规范

按 `crates/agent-electron-client/CLAUDE.md`:

- 中文输出(注释、文档、解释)
- 日志走 electron-log,**仅英文**
- UI 文本通过 `t()` 走 i18n,4 个 locale 文件 + `I18N_KEYS` 同步
- 测试用 Vitest,新增测试覆盖率不下降
- 不动 git config、不跳过 hooks、不强推

---

## 8. 风险与注意事项

| 风险 | 缓解 |
|---|---|
| ACP SDK 版本可能没有 `setSessionMode` 方法 | 先 grep SDK 类型,若缺失则用 `connection.connection.sendRequest("session/set_mode", ...)` 直发(JSON-RPC 兜底) |
| `newSession` 响应类型可能没声明 `modes` 字段 | 用 `(result as any).modes` 临时绕过,后续 SDK 升级再清掉 |
| 后端 nuwax-file-server 还没把 hooks 写好 | 客户端 mode 切换不依赖后端 hooks,可独立验证(yolo 路径完全本地) |
| Nuwax Web AgentInterventionCard 还没实现 | 本期不依赖,本地 Modal 自给自足。`deliverTo("nuwax-web")` 是 stub |
| SQLite migration 在已有用户库上运行 | 用 `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE`,不动现有表 |
| 三档切换 UI 暴露的 `yolo` 可能误导用户 | UI 加 warning 提示,后续可加二次确认或权限位 |
| `auto` 的低风险白名单覆盖不全 | 先按 `{read, search, think, fetch}` 起步,根据反馈调整;**不允许**把 `execute` / `edit` 加进白名单 |
| nuwaxcode 私有 `question` kind 短期保留 cancelled | 在代码加 TODO 注释,待 MCP `nuwaclaw_ask_user` 实现后改造 |

---

## 9. 验收前自查

提交 PR 前,接手 Agent 请逐项确认:

- [ ] 7 个新组件文件已创建,挂载点正确
- [ ] 5 个修改文件 diff 清晰,未引入无关变更
- [ ] 三档分流逻辑代码与本文档 §4.3 一致
- [ ] mode 解析优先级链与 §4.1 一致
- [ ] IPC channel 名称与 §4.4 一致
- [ ] SQLite 表 schema 与 §4.6 一致
- [ ] i18n key 4 个 locale 同步,`I18N_KEYS` 常量更新
- [ ] 旧 `PermissionModal.tsx` 加 `@deprecated`,**未删除**
- [ ] `permissionManager` 沙箱本地路径未被破坏
- [ ] 所有单测通过,新增测试覆盖 §7.2 列表
- [ ] 端到端 7.1 的 6 个场景 dev 模式验证通过
- [ ] 日志使用英文,UI 文案使用 `t()`
- [ ] 无新增 npm 依赖(不引入 `@rjsf/*`)

---

## 10. 联系与协作

- 本期实施完成后,通知后端团队:
  - 各 engine adapter(claude-code / nuwaxcode / codex)按 ACP 协议在 `session/new` 响应中返回 `modes`(可选)
  - 模式 id 建议对齐 `ask` / `auto` / `yolo`(若后端用其他 id,客户端会 fail-safe 降级 `ask`)
- 通知 Nuwax Web 团队:数据格式 `InterventionRequest` + `InteractionUISchema` 已在本仓库 `src/shared/types/intervention.ts` 定义,可作为后续 SSE 推送格式的基线
- v3 文档中 mermaid 总览图保留作为最终目标参考,本期 Electron 只交付左半边

---

*文档状态:Plan approved,等待实施。如方案需要调整,请回到原始 plan 文件 `/Users/apple/.claude/plans/hooks-agent-engine-wobbly-dream.md` 讨论,本文档随之同步更新。*

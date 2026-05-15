# ACP Permission 与 Ask/Question 联动验收计划

更新时间：2026-05-15（v2 — SSE 格式对齐 v3 方案后修订）

## 目标

验证 NuwaClaw 集成 `nuwax-codex-acp v0.15.1` 后，ACP 权限审批与 ask/question MCP 两条人机交互链路可以在本地开发环境闭环，并确认关联前端 `nuwax` 与 `nuwax-mobile` 的联动行为。

本计划只覆盖验收，不替代以下设计文档：

- `docs/acp-permission-request-handler-adaptation.md`
- `docs/acp-permission-approval-cross-end-v1.md`
- `docs/mcp-ask-question-acp-toolcall-v1.md`
- `docs/permission-request-handler-design.md`

## 验收范围

### 覆盖仓库

| 仓库 | 路径 | 建议分支 | 用途 |
| --- | --- | --- | --- |
| NuwaClaw | `/Users/apple/workspace/nuwaclaw` | `feature/electron-client-0.12` | Electron host、ACP engine、computer server、permission resolve |
| Web | `/Users/apple/workspace/nuwax` | `codex/acp-mode-intervention-ui` | PC 端审批卡片、permission resolve 请求 |
| Mobile | `/Users/apple/workspace/nuwax-mobile` | `codex/acp-mode-intervention-mobile-approval` | H5/移动端 SSE 接收、审批 UI 与回调 |
| ask/question MCP | `/Users/apple/workspace/nuwax-ask-question-mcp` | 当前开发分支 | MCP tool 问用户问题与 `/respond` 侧车 |

### 覆盖链路

1. ACP permission：agent 触发敏感工具调用，NuwaClaw 发出 `acpRequestPermission`，Web/Mobile 展示审批，用户选择后回调 `/computer/notify-resolved`，agent 继续或取消。
2. ask/question MCP：agent 调用 `nuwax_ask_user` 或 `nuwaclaw_ask_user`，Web/Mobile 渲染表单问题，用户回答后回调 MCP sidecar `/respond`，agent 收到答案继续执行。
3. 本地开发服务：优先使用本地 NuwaClaw、Web、Mobile H5 与本地 MCP sidecar；远端测试环境只作为登录、会话或后端代理的临时依赖。

## 本地服务拓扑

```text
NuwaClaw electron-dev
  ├─ computer server: http://127.0.0.1:60006
  │   ├─ SSE:  GET  /computer/progress/:session_id
  │   └─ 回调: POST /computer/notify-resolved（同时支持 v3 格式与 RCoder 格式）
  ├─ gateway/chat2response: 以启动日志为准
  └─ nuwax-codex-acp: prepare 下载集成，不依赖 CODEX_ACP_BIN

Backend（测试环境 testagent.xspaceagi.com）
  ├─ SSE 转发:  NuwaClaw SSE → Web/Mobile 客户端
  ├─ Web 审批回调:  POST /api/agent-interventions/{id}/respond → NuwaClaw /computer/notify-resolved（v3 格式）
  └─ Mobile 审批回调: POST /api/computer/notify-resolved → NuwaClaw /computer/notify-resolved（v3 格式或 RCoder 格式）

nuwax Web dev
  └─ 通过测试 backend 接收会话 SSE，提交 /api/agent-interventions/{id}/respond（v3 格式）

nuwax-mobile H5 dev
  └─ 通过测试 backend 接收会话 SSE，提交 /api/computer/notify-resolved（v3 格式）

nuwax-ask-question-mcp
  ├─ MCP stdio: 由 NuwaClaw 作为 MCP server 启动
  └─ response sidecar: http://127.0.0.1:63334/respond
```

## SSE 数据格式（v3 方案）

NuwaClaw ACP permission SSE payload 使用 **v3 `AcpPermissionInterventionRequest`** 格式（`acpEngine.ts`）：

```json
{
  "sessionId": "<acp-session-uuid>",
  "acpSessionId": "<acp-session-uuid>",
  "messageType": "acpRequestPermission",
  "subType": "session/request_permission",
  "data": {
    "id": "itv_<uuid>",
    "revision": 1,
    "kind": "approval",
    "status": "pending",
    "sessionId": "<app-session-id>",
    "source": "acp_permission",
    "engine": "codex",
    "protocol": "acp",
    "callbackTarget": { "kind": "electron", "targetId": "<device-id>" },
    "schemaRef": "https://...schema.json",
    "acp": {
      "method": "session/request_permission",
      "request": {
        "sessionId": "<acp-session-uuid>",
        "toolCall": {
          "toolCallId": "<tool-call-id>",
          "kind": "bash",
          "title": "bash",
          "rawInput": { "command": "..." }
        },
        "options": [
          { "optionId": "always_allow:terminal", "name": "始终允许", "kind": "allow_always" },
          { "optionId": "allow", "name": "允许本次", "kind": "allow_once" }
        ]
      }
    },
    "timeoutMs": 120000,
    "createdAt": 1747...
  },
  "timestamp": "2026-05-15T..."
}
```

关键字段说明：

- `messageType`: 固定为 `"acpRequestPermission"`
- `subType`: 固定为 `"session/request_permission"`
- `data.id`: NuwaClaw 生成的 opaque intervention ID，格式 `itv_<uuid>`
- `data.acp.request`: ACP 官方 `RequestPermissionRequest`，camelCase
- `data.revision`: 初始为 1，后续可能递增
- `data.callbackTarget`: 标识回调目标（`electron` 或 `rcoder`）

## 回调格式

NuwaClaw `/computer/notify-resolved` **同时接受两种格式**，自动检测：

### v3 格式（Web/Mobile 推荐）

```json
{
  "interventionId": "itv_<uuid>",
  "revision": 1,
  "source": "acp_permission",
  "protocol": "acp",
  "action": "submit",
  "acpResponse": {
    "outcome": { "outcome": "selected", "optionId": "allow" }
  },
  "resolvedBy": { "kind": "web", "userId": "..." },
  "resolvedAt": 1747...
}
```

### RCoder 格式（兼容旧客户端）

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": { "Selected": { "option_id": "allow" } }
    },
    "session_id": "<acp-session-uuid>",
    "tool_call_id": "<tool-call-id>",
    "save_rule": false
  }
}
```

检测逻辑：请求体含 `permission_resolve_request` 字段 → RCoder 格式，否则 → v3 格式。

## 前端回调路径

| 前端 | 回调 API | 请求格式 | Backend → NuwaClaw |
| --- | --- | --- | --- |
| Web | `POST /api/agent-interventions/{id}/respond` | v3 格式 | v3 格式 |
| Mobile | `POST /api/computer/notify-resolved` | v3 格式（v3 SSE 来源）或 RCoder 格式（RCoder SSE 来源） | 透传原格式 |

> **注意**：两端均不直接调用 NuwaClaw `/computer/notify-resolved`，通过 Backend 路由。Backend 路由正确性是验收的隐含前置条件。

## 前置条件

### NuwaClaw

- 不使用 `CODEX_ACP_BIN=/Users/apple/workspace/codex-acp/...` 做常规验收。
- 常规验收必须走 prepare 下载集成的 `nuwax-codex-acp v0.15.1`。
- 模型配置必须通过环境变量下发：
  - `CODEX_API_KEY`
  - `CODEX_MODEL`
  - `CODEX_BASE_URL`
- 日志中不应再出现：
  - `Cannot GET /v1/responses`
  - `Authentication required`
  - 因模型名未覆盖导致的错误路由

### Web

`/Users/apple/workspace/nuwax/config/config.development.ts` 当前默认指向测试环境：

```ts
'process.env.BASE_URL': 'https://testagent.xspaceagi.com'
```

本地联调时需要确认 `/api/agent-interventions/{id}/respond` 能到达本机 NuwaClaw computer server。可选方式：

1. 使用测试 backend，确认它能把 `/api/agent-interventions/{id}/respond` 转换并转发到 `http://127.0.0.1:60006/computer/notify-resolved`（v3 格式）。
2. 使用本地 backend/bridge，直接转发到 NuwaClaw。
3. 仅做 UI 验收时，可以用录制的 `acpRequestPermission` SSE payload 走 mock，但不能作为端到端通过依据。

### Mobile

`/Users/apple/workspace/nuwax-mobile/constants/config.uts` 当前开发环境默认指向测试环境：

```ts
API_BASE_URL = "https://testagent.xspaceagi.com";
```

本地 H5 联调时需要同样确认 `/api/computer/notify-resolved` 能到达本机 NuwaClaw。若用真机或模拟器，不能使用设备内的 `127.0.0.1` 指向 Mac，需要使用 Mac 局域网 IP 或后端代理。

Mobile 内部通过 `normalizeAcpPermissionProgressMessage` 同时支持 v3 和 RCoder 两种 SSE 格式，并自动将 v3 格式回调用于 v3 来源的数据（`buildNotifyResolvedRequest`）。

## 启动步骤

### 1. 启动 NuwaClaw

```bash
cd /Users/apple/workspace/nuwaclaw
git switch feature/electron-client-0.12
make electron-dev
```

观察日志：

```bash
cd /Users/apple/workspace/nuwaclaw
tail -f logs/electron-dev.log | rg --line-buffered \
  "session/request_permission|Permission pending|Pending created|acpRequestPermission|request_permission|notify-resolved|rcoder_callback|ERR_PERMISSION|session_cancel|Denying question|nuwax-codex-acp|CODEX_"
```

### 2. 启动 Web 本地开发服务

```bash
cd /Users/apple/workspace/nuwax
git switch codex/acp-mode-intervention-ui
pnpm install
pnpm dev
```

启动后以控制台输出的地址为准，通常是 Umi/Max dev server。

重点检查：

- `src/models/conversationInfo.ts` 是否识别 `messageType === 'acpRequestPermission' && subType === 'session/request_permission'`。
- `src/components/AcpPermissionCard/index.tsx` 是否渲染审批卡片。
- `src/models/conversationInfo.ts` 是否通过 `apiAgentInterventionRespond` 提交 v3 格式回调（`POST /api/agent-interventions/{id}/respond`）。
- `src/services/agentConfig.ts` 的 `apiAgentInterventionRespond` 是否到达 Backend 并最终路由到 NuwaClaw。

### 3. 启动 Mobile H5 本地开发服务

`nuwax-mobile` 当前没有标准 `dev` script，建议使用 HBuilderX 运行到 H5 浏览器。

```bash
cd /Users/apple/workspace/nuwax-mobile
git switch codex/acp-mode-intervention-mobile-approval
```

重点检查：

- `utils/chatDataAdapter.uts` 的 `isRenderableSSEChunk` 收到 `messageType=acpRequestPermission` 时不作为普通聊天文本渲染。
- `utils/acpPermission.uts` 的 `normalizeAcpPermissionProgressMessage` 同时接受 `subType: "session/request_permission"` 和 `"request_permission"`，并自动将 v3 格式数据转换为内部 RCoder 模型。
- `components/acp-permission-card/acp-permission-card.uvue` 渲染审批卡片。
- `layers/AgentDetailService.uts` 的 `respondAcpPermission` 通过 `buildNotifyResolvedRequest` 提交回调：v3 来源数据使用 v3 格式，RCoder 来源数据使用 RCoder 格式。
- `servers/conversation.uts` 的 `apiResolveAcpPermission` 提交 `/api/computer/notify-resolved` 到 Backend。

### 4. 配置 ask/question MCP

构建 MCP：

```bash
cd /Users/apple/workspace/nuwax-ask-question-mcp
npm install
npm run build
```

NuwaClaw MCP 配置建议使用 build 后的 stdio server，并设置 sidecar 端口：

```json
{
  "ask-question": {
    "source": "custom",
    "enabled": true,
    "command": "node",
    "args": ["/Users/apple/workspace/nuwax-ask-question-mcp/dist/index.js"],
    "env": {
      "NUWAX_ASK_MCP_PORT": "63334",
      "NUWAX_ASK_MCP_SECRET": "change-me"
    }
  }
}
```

MCP sidecar 预期监听：

```text
POST http://127.0.0.1:63334/respond
X-Nuwax-Internal-Secret: change-me
```

## 验收用例

### A1. NuwaClaw host-only ACP permission 闭环

目的：先排除 Web/Mobile，确认 Electron host 的 permission pending 与 resolve 可用。

步骤：

1. 在 NuwaClaw 中创建使用 `codex-acp` 的会话。
2. 确认 agent mode 为需要审批的模式，不使用 yolo。
3. 发送提示词：

```text
请在当前工作区创建 approval-test.txt，并写入当前时间戳。
```

4. 日志应出现 ACP `session/request_permission` 或 `acpRequestPermission`。
5. 使用 SSE 直接观察：

```bash
curl -N http://127.0.0.1:60006/computer/progress/<session_id>
```

6. 使用 v3 协议回调允许：

```bash
curl -X POST http://127.0.0.1:60006/computer/notify-resolved \
  -H 'Content-Type: application/json' \
  -d '{
    "interventionId": "<data.id>",
    "revision": 1,
    "source": "acp_permission",
    "protocol": "acp",
    "action": "submit",
    "acpResponse": {
      "outcome": { "outcome": "selected", "optionId": "<allow-option-id>" }
    },
    "resolvedBy": { "kind": "web" },
    "resolvedAt": 0
  }'
```

> 也可使用 RCoder 格式回调（向后兼容），参见本文档"回调格式"章节。

通过标准：

- SSE payload 包含 `messageType: "acpRequestPermission"`，`subType: "session/request_permission"`。
- `data` 为 v3 格式 `AcpPermissionInterventionRequest`：`data.id`（`itv_` 前缀）、`data.acp.request.sessionId`、`data.acp.request.toolCall.toolCallId` 非空。
- 回调后 pending 被 resolve。
- agent 继续执行并完成文件创建。
- 日志没有重复 pending、找不到 pending、session id 错配。

### A2. ACP permission 拒绝/取消

步骤：

1. 重复 A1 触发 permission。
2. 回调取消（v3 格式）：

```json
{
  "interventionId": "<data.id>",
  "revision": 1,
  "source": "acp_permission",
  "protocol": "acp",
  "action": "cancel",
  "acpResponse": {
    "outcome": { "outcome": "cancelled" }
  },
  "resolvedBy": { "kind": "web" },
  "resolvedAt": 0
}
```

通过标准：

- agent 不执行被拒绝的工具调用。
- UI 状态进入已取消或失败态。
- NuwaClaw 不残留 pending intervention。

### A3. yolo 模式自动放行

步骤：

1. 将会话切到 yolo 或等价自动执行模式。
2. 触发同样的写文件请求。

通过标准：

- NuwaClaw 自动选择允许选项。
- 不发出需要用户处理的 `acpRequestPermission`。
- agent 正常完成任务。

### A4. ACP question 类型不走 permission 审批

步骤：

1. 触发可能产生 `toolCall.kind === "question"` 的 ACP request。

通过标准：

- NuwaClaw 不把 question 当成 permission 审批。
- 若日志出现 `Denying question-type request`，应确认这是 permission handler 的保护行为。
- ask/question MCP 链路仍按独立 tool_call 处理。

### B1. Web 本地审批卡片

步骤：

1. 启动 NuwaClaw 与 `nuwax` 本地 dev。
2. 在 Web 本地页面打开同一会话。
3. 触发写文件、执行命令或其他会产生 ACP permission 的操作。
4. 在浏览器 DevTools Network 中观察 SSE 与 `/api/agent-interventions/{id}/respond`。

通过标准：

- Web 收到 `acpRequestPermission`（`subType: "session/request_permission"`）后不作为普通 assistant 文本展示。
- 页面出现 `AcpPermissionCard`。
- 卡片展示 tool title、tool_call_id、raw_input、可选项。
- 点击允许后提交 v3 格式回调（通过 `apiAgentInterventionRespond`）：

```json
{
  "interventionId": "itv_xxx",
  "revision": 1,
  "source": "acp_permission",
  "protocol": "acp",
  "callbackTarget": { "kind": "electron", "targetId": "..." },
  "action": "submit",
  "acpResponse": {
    "outcome": { "outcome": "selected", "optionId": "..." }
  }
}
```

- Backend 将该请求路由到 NuwaClaw `/computer/notify-resolved`（v3 格式），agent 继续。
- Web 卡片进入 submitted 状态，不允许重复点击造成重复 resolve。

### B2. Web save_rule

步骤：

1. 触发带 `save_rule` 建议的 permission。
2. 勾选保存规则并允许。

通过标准：

- Web 请求中 `save_rule: true`。
- NuwaClaw 收到该字段。
- 不影响本次审批 resolve。

### C1. Mobile H5 接收 ACP permission

步骤：

1. 启动 NuwaClaw。
2. 用 HBuilderX 启动 `nuwax-mobile` H5。
3. H5 打开同一会话。
4. 触发 ACP permission。

通过标准：

- Mobile H5 控制台能看到 `acpRequestPermission` 原始事件。
- 该事件不进入普通文本消息。
- 如果 Mobile 已完成 UI 适配，应展示审批卡片或弹层。
- 如果 Mobile 尚未完成 UI 适配，应记录为缺口：收到事件但无法审批。

### C2. Mobile H5 提交审批结果

步骤：

1. 在 Mobile 审批 UI 点击允许或拒绝。
2. 观察 Network 请求。

通过标准：

- 请求路径为 `POST /api/computer/notify-resolved`（到 Backend），Backend 路由到 NuwaClaw。
- v3 SSE 来源的数据，请求体为 v3 格式（含 `interventionId`、`revision`、`acpResponse`）；RCoder SSE 来源的数据，请求体为 RCoder 格式（含 `permission_resolve_request`）。Mobile 的 `buildNotifyResolvedRequest` 自动选择。
- agent 根据 Mobile 的选择继续或取消。
- Web 与 Mobile 同时打开时，不产生重复提交或状态倒退。

### D1. ask/question MCP Web 闭环

目的：确认 ask/question 不是 ACP permission，而是 MCP tool_call 问答。

提示词：

```text
请调用 nuwax_ask_user 询问我 approval-test.txt 要写入什么标题，等待我的回答后再创建文件。
```

通过标准：

- NuwaClaw 不发出 `acpRequestPermission`。
- Web 收到普通 tool_call，raw input 包含：

```json
{
  "schemaVersion": "nuwaclaw.mcp_ask.v1",
  "ui": {
    "version": "nuwaclaw.interaction.v1"
  }
}
```

- Web 渲染问题表单。
- 用户提交后，后端调用 MCP sidecar：

```text
POST http://127.0.0.1:63334/respond
```

- MCP tool 返回用户答案给 agent。
- agent 使用答案继续任务。

### D2. ask/question MCP Mobile 闭环

步骤同 D1，但在 Mobile H5 上回答问题。

通过标准：

- Mobile 能识别 ask/question tool_call。
- Mobile 表单提交到 MCP sidecar 或后端代理。
- agent 收到 Mobile 回答并继续执行。

### E1. Web 与 Mobile 同时在线

步骤：

1. Web 和 Mobile H5 同时打开同一会话。
2. 触发 ACP permission。
3. 在 Web 点击允许。
4. 观察 Mobile 状态。

通过标准：

- 两端都能看到同一个 pending permission。
- 首个有效 resolve 生效。
- 另一个端不应继续显示可提交的过期 pending。
- 如果第二端重复提交，服务端应返回明确错误或幂等结果，不能导致 agent 状态异常。

### F1. 工作空间路径验收

目的：确认之前的重复 workspace path 问题没有回归。

步骤：

1. 创建或选择明确的 workspace。
2. 让 agent 执行：

```text
请告诉我当前工作目录，并列出当前目录的前 5 个文件。
```

通过标准：

- 工作目录是用户选择的 workspace。
- 路径中不出现重复片段，例如 `computer-project-workspace/.../computer-project-workspace/...`。
- 文件创建、读取、预览都落在同一 workspace 下。

### G1. codex-acp v0.15.1 正常集成

步骤：

1. 清理本地手动覆盖的 `CODEX_ACP_BIN`。
2. 运行 `make electron-dev`。
3. 检查启动日志和依赖路径。

通过标准：

- 使用资源目录中 prepare 下载的 `nuwax-codex-acp`。
- 日志中能看到正确的 `CODEX_API_KEY`、`CODEX_MODEL`、`CODEX_BASE_URL` 注入行为。
- 不再访问错误的 `/v1/responses` 路径。
- `glm-5` 或当前默认模型能真实完成请求。

## 验收记录模板

| 用例 | 结果 | 证据 | 问题链接/备注 |
| --- | --- | --- | --- |
| A1 host-only allow | 未执行 | 日志、SSE payload、文件路径 |  |
| A2 host-only cancel | 未执行 | 日志、UI 状态 |  |
| A3 yolo auto allow | 未执行 | 日志、文件路径 |  |
| A4 question guard | 未执行 | 日志 |  |
| B1 Web allow | 未执行 | DevTools、NuwaClaw 日志 |  |
| B2 Web save_rule | 未执行 | Request payload |  |
| C1 Mobile receive | 未执行 | H5 console |  |
| C2 Mobile resolve | 未执行 | Network、NuwaClaw 日志 |  |
| D1 Web ask/question | 未执行 | tool_call payload、MCP response |  |
| D2 Mobile ask/question | 未执行 | H5 UI、MCP response |  |
| E1 multi-end race | 未执行 | 两端录屏/日志 |  |
| F1 workspace path | 未执行 | pwd、文件列表 |  |
| G1 v0.15.1 integration | 未执行 | 启动日志 |  |

## 缺陷判定

以下情况必须阻断通过：

- ACP permission 已触发，但 NuwaClaw 没有 pending 或无法 resolve。
- Web/Mobile 提交的 `session_id` 或 `tool_call_id` 与 NuwaClaw pending 不一致。
- ask/question MCP 被错误路由成 ACP permission。
- yolo 模式仍弹用户审批。
- 用户拒绝后工具仍被执行。
- 工作空间路径重复或工具执行目录错误。
- 常规验收依赖本地 `CODEX_ACP_BIN` 手动覆盖。

以下情况可以作为非阻断缺陷记录，但需要明确后续任务：

- Web/Mobile 多端状态同步没有实时刷新，但服务端能正确拒绝重复 resolve。
- `Model metadata for glm-5 not found` 仅为 metadata fallback 警告，且模型请求实际成功。
- Backend SSE 转发未做格式转换（当前 NuwaClaw 已直接 emit v3 格式，若 Backend 仍期望 RCoder 输入则需适配）。

## 验收完成标准

1. A1、A2、A3、F1、G1 必须通过，证明 NuwaClaw host 与 `nuwax-codex-acp v0.15.1` 核心链路可用。
2. B1 必须通过，证明 Web 端 ACP 审批可以端到端闭环。
3. D1 必须通过，证明 ask/question MCP 与 ACP permission 没有混线。
4. C1/C2、D2 Mobile 已完成审批 UI 实现（`acp-permission-card.uvue`），C1/C2 应作为正式验收项。若 Mobile 分支尚未合并或 Backend 路由不通，则降级为阶段验收。
5. 验收结果、日志片段、关键 payload 和未完成项必须记录到本文件的验收记录表或对应 issue/PR。
6. 验收前必须确认 Backend 能正确路由 `/api/agent-interventions/{id}/respond`（Web）和 `/api/computer/notify-resolved`（Mobile）到本地 NuwaClaw。

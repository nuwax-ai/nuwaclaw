# Permission Request Handler 适配计划

## 背景

RCoder 的设计文档 `../docs/permission-request-handler-design.md` 定义了一套新的 ACP 权限请求交互协议：

- Agent 配置通过 `agent_config.agent_server.agent_mode` 控制权限模式，默认 `yolo`，可选 `ask`。
- ASK 模式下，通过 SSE 推送 `acpRequestPermission` 事件。
- 用户选择后，通过 `POST /computer/notify-resolved` 回传 `permission_resolve_request`。
- 取消会话时，所有 pending permission 必须显式 resolve 为 `Cancelled`。
- `option_id` 由 ACP Agent 生成，NuwaClaw/RCoder 均应当视为不透明字符串。

NuwaClaw 现状已经具备部分基础能力：

- `agent_mode` 类型已存在于 `computerTypes.ts`。
- `resolveEffectiveMode()` 已支持默认 `yolo`。
- ACP client 已暴露 `requestPermission` handler。
- `acpEngine.ts` 已有 YOLO 自动选择和 ASK pending promise 逻辑。
- `abortSession()` 已会取消当前 ACP session 的 pending permission。

主要缺口不是能力缺失，而是 NuwaClaw 当前内部 intervention 协议与 RCoder 设计文档的新 HTTP/SSE contract 不一致。

## 目标

让 NuwaClaw 的 ACP permission request 链路兼容 RCoder 新协议：

1. `ask` 模式下向 RCoder/SSE 客户端推送文档要求的 `request_permission_request` 结构。
2. `/computer/notify-resolved` 接收文档要求的 `permission_resolve_request` 结构。
3. pending permission 可以通过 `(session_id, tool_call_id)` 定位并 resolve。
4. 会话 cancel 时所有 pending permission 都返回 ACP `Cancelled`。
5. 保留现有 intervention 回调格式的兼容入口，降低现有 UI/调用方被一次性打断的风险。

## 非目标

- 不在 NuwaClaw 内实现 RCoder Rust 侧完整 RuleStore。
- 不把 `option_id` 解析成固定语义。
- 不改 ACP SDK 协议本身。
- 不改 codex-acp/nuwax-codex-acp 二进制下载逻辑。

## 关键差异

### 当前 NuwaClaw 回调格式

当前 `/computer/notify-resolved` 期待：

```json
{
  "interventionId": "itv_xxx",
  "revision": 1,
  "source": "acp_permission",
  "protocol": "acp",
  "action": "resolve",
  "acpResponse": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow_once"
    }
  }
}
```

### RCoder 目标回调格式

RCoder 文档要求：

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": {
        "Selected": {
          "option_id": "always_allow:terminal"
        }
      }
    },
    "session_id": "session_789",
    "tool_call_id": "tool_001",
    "save_rule": true
  },
  "user_id": "user_123",
  "project_id": "proj_456",
  "pod_id": "...",
  "tenant_id": "...",
  "space_id": "...",
  "isolation_type": "tenant"
}
```

### 当前 SSE 数据格式

当前 ASK 模式推送的是 NuwaClaw intervention envelope：

```json
{
  "id": "itv_xxx",
  "revision": 1,
  "kind": "approval",
  "sessionId": "...",
  "source": "acp_permission",
  "protocol": "acp",
  "acp": {
    "method": "session/request_permission",
    "request": {}
  }
}
```

### RCoder 目标 SSE 数据格式

RCoder 文档要求：

```json
{
  "request_permission_request": {
    "session_id": "session_789",
    "tool_call": {
      "tool_call_id": "tool_call_001",
      "kind": "bash",
      "status": "pending",
      "title": "bash",
      "content": [],
      "raw_input": {
        "command": "cargo build"
      },
      "_meta": {}
    },
    "options": [
      {
        "option_id": "always_allow:terminal",
        "name": "始终允许",
        "kind": "allow_always",
        "_meta": {}
      }
    ],
    "_meta": {}
  },
  "tool_call_id": "tool_001",
  "save_rule": {
    "suggested_pattern": "^cargo\\s+build",
    "rule_type": "allow",
    "tool_name": "terminal"
  }
}
```

## 代码落点

预计改动集中在这些文件：

- `crates/agent-electron-client/src/shared/types/intervention.ts`
- `crates/agent-electron-client/src/main/services/intervention/approvalInterventionService.ts`
- `crates/agent-electron-client/src/main/services/intervention/buildAcpPermissionInterventionRequest.ts`
- `crates/agent-electron-client/src/main/services/intervention/interventionHttpHandlers.ts`
- `crates/agent-electron-client/src/main/services/engines/acp/acpEngine.ts`
- `crates/agent-electron-client/src/main/services/computerServer.ts`

可能新增：

- `crates/agent-electron-client/src/main/services/intervention/rcoderPermissionProtocol.ts`
- `crates/agent-electron-client/src/main/services/intervention/rcoderPermissionProtocol.test.ts`

## 实施步骤

### 1. 增加 RCoder 协议类型与映射函数

新增独立 mapper，隔离 snake_case/Pascal-case 与当前 ACP camelCase 类型的差异。

核心函数：

```ts
toRcoderPermissionRequest(input): RcoderPermissionSsePayload
fromRcoderPermissionResolveRequest(body): PermissionResolveCommand
toAcpPermissionResponse(command): AcpPermissionResponse
```

映射规则：

- `toolCallId` -> `tool_call_id`
- `rawInput` -> `raw_input`
- `optionId` -> `option_id`
- ACP `{ outcome: "selected", optionId }` <-> RCoder `{ Selected: { option_id } }`
- ACP `{ outcome: "cancelled" }` <-> RCoder `{ Cancelled: {} }`

`option_id` 只校验是否存在于当前 pending request 的 options 中，不解析语义。

### 2. pending permission 支持双索引

当前 pending 主要通过 `interventionId` resolve。需要增加 `(acpSessionId, toolCallId)` 索引：

```ts
pendingByInterventionId: Map<string, PendingApproval>
pendingByAcpPermissionKey: Map<string, string>
```

key 格式建议：

```ts
`${acpSessionId}:${toolCallId}`
```

新增方法：

```ts
resolveFromRcoderPermissionRequest(payload): NotifyResolvedResponse
```

行为：

- 用 `permission_resolve_request.session_id` + `tool_call_id` 找 pending。
- 验证 option 是否属于 pending options。
- resolve ACP promise。
- 清理两个索引。
- `save_rule` 在 NuwaClaw 侧只接受和记录，不作为本地规则持久化依据。

### 3. ASK 模式 SSE 改为 RCoder contract

在 `acpEngine.handlePermissionRequest()` 的 ASK 分支中：

- 继续创建 pending approval。
- 但对外 `computer:progress` 的 `data` 改为 RCoder 文档的 `request_permission_request` payload。
- `messageType` 保持 `acpRequestPermission`。
- `subType` 从当前 `session/request_permission` 调整为 `request_permission`。

建议保留当前 intervention envelope 到 `_meta.nuwaclaw_intervention`，用于调试和灰度兼容：

```json
{
  "request_permission_request": {},
  "tool_call_id": "...",
  "save_rule": {},
  "_meta": {
    "nuwaclaw_intervention_id": "itv_xxx"
  }
}
```

### 4. `/computer/notify-resolved` 接收新旧两种 body

`computerServer.ts` 当前只接收旧 `NotifyResolvedRequest`。

调整策略：

- 如果 body 存在 `permission_resolve_request`，走 RCoder 新协议。
- 否则保持旧 intervention 协议。

路由 engine 时优先使用 `project_id`：

```ts
const acpEngine =
  body.project_id
    ? agentService.getEngineForProject(body.project_id)
    : agentService.getAcpEngine();
```

如果 project engine 不存在，再 fallback 到 `getAcpEngine()`。

响应建议统一成现有 HTTP 成功 envelope，但错误码对齐 RCoder：

- `ERR_VALIDATION`
- `ERR_SESSION_NOT_FOUND`
- `ERR_PERMISSION_NOT_FOUND`
- `ERR_PERMISSION_RESOLVE_FAILED`
- `ERR_PERMISSION_EXPIRED`

### 5. 认证策略确认并兼容

当前 `/computer/notify-resolved` 要求 `X-Nuwax-Internal-Secret`。

RCoder 文档没有声明该 header。建议处理方式：

- 短期：新旧协议都继续支持 internal secret。
- 若 RCoder 当前无法发送 header，则只对 `permission_resolve_request` 增加一个受控兼容路径。
- 最安全的兼容路径是要求请求来自本地 gateway/lanproxy 已认证通道，而不是完全裸放公网入口。

这一点实施前需要确认 RCoder 是否能带 `X-Nuwax-Internal-Secret`。

### 6. Cancel 行为补齐测试

现有 `abortSession()` 已调用：

```ts
approvalInterventionService.cancelByAcpSession(sessionId)
```

需要验证并补齐：

- cancel 时 pending promise resolve 为 ACP `cancelled`。
- pending map 与新增 `(session_id, tool_call_id)` 索引都会清理。
- 多个 pending permission 同 session 时全部取消。
- timeout 时同样清理双索引。

### 7. YOLO 行为确认

现有 YOLO 逻辑基本符合 RCoder 文档：

1. 优先 `allow_always`
2. 其次 `allow_once`
3. 再选第一个 option

需要补一条日志：

- 如果 fallback 到第一个非 allow option，打印 warning，便于排查 agent 给出的异常 options。

### 8. 文档留存

实现后更新：

- `docs/codex-acp-gateway.md` 或新增 `docs/acp-permission-requests.md`

文档内容：

- `agent_mode` 语义
- RCoder SSE payload 示例
- `/computer/notify-resolved` payload 示例
- `option_id` 不透明规则
- cancel/timeout 行为
- 与旧 intervention 回调格式的兼容说明

## 测试计划

### 单元测试

新增或扩展：

- `rcoderPermissionProtocol.test.ts`
  - ACP -> RCoder SSE snake_case 映射
  - RCoder Selected -> ACP selected 映射
  - RCoder Cancelled -> ACP cancelled 映射
  - 缺失字段返回 `ERR_VALIDATION`

- `approvalInterventionService.test.ts`
  - 通过 `(session_id, tool_call_id)` resolve pending
  - invalid option_id 被拒绝
  - timeout 清理双索引
  - cancelByAcpSession 清理双索引并 resolve cancelled

### 集成验证

用 `make electron-dev` 启动后验证：

1. `agent_mode=yolo`
   - 发起需要权限的 ACP tool call。
   - 不出现 ASK SSE。
   - 自动选择 allow option。

2. `agent_mode=ask`
   - 发起需要权限的 ACP tool call。
   - SSE 出现 `messageType=acpRequestPermission`，`subType=request_permission`。
   - `data.request_permission_request` 符合 RCoder 文档。

3. 回调允许
   - POST `/computer/notify-resolved`，body 使用 `Selected.option_id`。
   - ACP permission promise 被 resolve。
   - agent 继续执行。

4. 回调取消
   - POST `/computer/notify-resolved`，body 使用 `Cancelled`。
   - ACP permission promise 被 cancel。
   - agent 不执行对应 tool。

5. 会话取消
   - ASK pending 时调用 `/computer/agent/session/cancel`。
   - 所有 pending permission resolve 为 cancelled。
   - 不残留 pending map。

## 风险与注意点

- `session_id` 在 RCoder 文档里指 ACP session id，不是 NuwaClaw app session id；实现时必须明确使用 `acpSessionId`。
- `tool_call_id` 必须从 ACP request 原样使用，不要用 NuwaClaw 生成的 intervention id 替代。
- `subType` 如果从 `session/request_permission` 改为 `request_permission`，前端旧逻辑若依赖旧值需要一起改。
- 如果 `/computer/notify-resolved` 放宽认证，需要确认 lanproxy/gateway 层是否已经完成可信校验。
- `save_rule` 在当前 NuwaClaw 方案里建议只透传/记录，不本地持久化，否则会和 RCoder RuleStore 产生双写语义。

## 建议执行顺序

1. 先做 mapper 和类型测试。
2. 再改 `approvalInterventionService` 的双索引和 resolve 入口。
3. 再改 `acpEngine` ASK SSE 输出。
4. 再改 `computerServer` HTTP 入参兼容。
5. 最后跑单测和 `make electron-dev` 手工验证。

## 需要确认的问题

1. RCoder 调 `/computer/notify-resolved` 时能否携带 `X-Nuwax-Internal-Secret`？
2. RCoder 期望 `sub_type` 必须是 `request_permission`，还是可以兼容当前 `session/request_permission`？
3. `save_rule` 最终由 RCoder 存储，还是 NuwaClaw 也需要本地持久化一份？

# ACP Permission Approval 跨端实施方案 v1

| 项 | 内容 |
|---|---|
| 状态 | **v1 草案** |
| 版本 | v1(2026-05-13) |
| 关联主文档 | [`acp-mode-and-intervention-cross-end-v3.md`](./acp-mode-and-intervention-cross-end-v3.md) |
| UI schema | [`interaction-ui-schema-v1.md`](./interaction-ui-schema-v1.md) |
| ACP schema | <https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json> |
| 覆盖范围 | Electron Nuwaclaw、rcoder、Nuwax Web、Nuwax Mobile、Backend |

---

## 1. 结论

ACP permission approval 严格使用官方 `schema/schema.json` 中的 `RequestPermissionRequest` / `RequestPermissionResponse`。nuwaclaw 与 rcoder 只做 ACP Client Host、pending 路由和 callback resolve,不把 ACP permission 转换成 Nuwax UI schema。

核心链路:

- Agent -> Host:`session/request_permission(RequestPermissionRequest)`。
- Host -> Web/Mobile:`/computer/progress/{session_id}` 推 `messageType="acpRequestPermission"`。
- Web/Mobile:把 ACP official request 适配成内部数据驱动 UI。
- Web/Mobile -> Backend:`/respond` 携带 ACP official response。
- Backend -> Host:`POST /computer/notify-resolved { interventionId, acpResponse }`。
- Host:校验并 resolve ACP pending,把 `RequestPermissionResponse` 返回给 Agent。

不新增 `POST /dispatch`;`callbackTarget` 只作为路由元数据,不进入 ACP 官方 request。

---

## 2. 边界与职责

| 层 | 职责 |
|---|---|
| Electron Nuwaclaw ACP Host | 接收 ACP permission、挂起 pending、派发官方 `RequestPermissionRequest`、接收官方 `RequestPermissionResponse` 并 resolve |
| rcoder ACP Host | 同 Electron,实现语言是 Rust |
| Nuwax Web | 接收 `acpRequestPermission`,把 ACP request 适配成数据驱动 UI,提交 ACP response |
| Nuwax Mobile | 复用同一 ACP permission payload,适配成移动端数据驱动 UI |
| Backend | 接收 `/respond`,校验 session/project/revision/callbackTarget,回调对应 Host |

Host 禁止事项:

- 不生成 `InteractionUISchema`。
- 不把 `PermissionOption.name` 改名为 `label`。
- 不把 `ToolCallUpdate` 改成自定义 `toolCallView`。
- 不把 `optionId` 改成 `kind`。
- 不依赖 ACP `_meta` 的业务语义。

---

## 3. ACP 官方 Permission 类型

以下 TypeScript 只是从官方 `schema.json` 对应定义整理出的阅读摘录。实现必须引用/生成官方 schema 类型或按官方 schema 校验。

```ts
type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

interface PermissionOption {
  optionId: string;
  kind: PermissionOptionKind;
  name: string;
  _meta?: Record<string, unknown> | null;
}

interface ToolCallUpdate {
  toolCallId: string;
  title?: string | null;
  kind?: ToolKind | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: Array<{ path: string; line?: number | null }> | null;
  content?: unknown[] | null;
  status?: "pending" | "in_progress" | "completed" | "failed" | null;
}

interface RequestPermissionRequest {
  sessionId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  _meta?: Record<string, unknown> | null;
}

type RequestPermissionOutcome =
  | {
      outcome: "selected";
      optionId: string;
      _meta?: Record<string, unknown> | null;
    }
  | { outcome: "cancelled" };

interface RequestPermissionResponse {
  outcome: RequestPermissionOutcome;
  _meta?: Record<string, unknown> | null;
}
```

约束:

- `PermissionOption.name` 是给用户看的 label。
- `PermissionOption.optionId` 是唯一决策值。
- `toolCall` 是 `ToolCallUpdate`,字段可能缺省;Web/Mobile 负责渲染 fallback。
- 选 `reject_once/reject_always` 也返回 ACP `selected optionId`,不是 `cancelled`。
- `cancel/skip/timeout/session cancel` 才返回 ACP `cancelled`。

---

## 4. Progress Envelope

公开 request 是进度流中的 interaction envelope,不是 UI schema。不要放 internal secret。Approval payload 必须保留 ACP 官方 request。

```ts
type AgentEngineId = "claude-code" | "nuwaxcode" | "codex";

interface AcpPermissionInterventionRequest {
  id: string;
  revision: number;
  kind: "approval";
  status: "pending";
  sessionId: string;
  source: "acp_permission";
  engine: AgentEngineId;
  protocol: "acp";
  callbackTarget: {
    kind: "electron" | "rcoder";
    targetId: string;
  };
  schemaRef: "https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json";
  acp: {
    method: "session/request_permission";
    request: RequestPermissionRequest;
  };
  timeoutMs?: number;
  createdAt: number;
}

interface AcpRequestPermissionProgressMessage extends UnifiedSessionMessage {
  messageType: "acpRequestPermission";
  subType: "session/request_permission";
  data: AcpPermissionInterventionRequest;
}
```

构造规则:

```ts
function buildAcpPermissionInterventionRequest(args: {
  engine: AgentEngineId;
  appSessionId: string;
  acpRequest: RequestPermissionRequest;
  now?: number;
  timeoutMs?: number;
}): AcpPermissionInterventionRequest {
  return {
    id: createOpaqueInterventionId("acp"),
    revision: 1,
    kind: "approval",
    status: "pending",
    sessionId: args.appSessionId,
    source: "acp_permission",
    engine: args.engine,
    protocol: "acp",
    callbackTarget: buildCurrentHostCallbackTarget(),
    schemaRef: "https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json",
    acp: {
      method: "session/request_permission",
      request: args.acpRequest,
    },
    timeoutMs: args.timeoutMs,
    createdAt: args.now ?? Date.now(),
  };
}
```

投递规则:

1. Host 收到 ACP `session/request_permission`。
2. Host 生成 `AcpPermissionInterventionRequest`。
3. Host 保存 `pendingPermissions[interventionId] = { acpRequest, resolve, timer }`。
4. Host 通过 `/computer/progress/{session_id}` 推送 `messageType="acpRequestPermission"`。
5. Web/Mobile 读取 `data.acp.request`,按 ACP 官方 schema 渲染 approval。

---

## 5. Web/Mobile UI 适配

ACP permission -> 数据驱动 UI 的转换只在 Nuwax Web / Nuwax Mobile 渲染会话交互组件时做。

`InteractionUISchema` 的唯一权威定义见 [`interaction-ui-schema-v1.md`](./interaction-ui-schema-v1.md)。本节只定义 ACP permission 到该 UI schema 的适配规则。

```ts
function adaptAcpPermissionToInteractionUi(
  request: RequestPermissionRequest,
): InteractionUISchema {
  return {
    version: "nuwaclaw.interaction.v1",
    presentation: "inline",
    title: request.toolCall.title?.trim() || fallbackToolTitle(request.toolCall.kind),
    description: buildToolCallDescription(request.toolCall),
    schema: {
      type: "object",
      required: ["decision"],
      properties: {
        decision: {
          type: "string",
          oneOf: request.options.map((option) => ({
            const: option.optionId,
            title: option.name,
          })),
        },
        reason: { type: "string", maxLength: 500 },
      },
    },
    uiSchema: {
      decision: {
        "ui:widget": "approvalOptions",
        "ui:optionKinds": Object.fromEntries(
          request.options.map((option) => [option.optionId, option.kind]),
        ),
      },
      reason: {
        "ui:widget": "textarea",
        "ui:visibleWhen": {
          decisionKind: ["reject_once", "reject_always"],
        },
      },
    },
  };
}
```

适配规则:

- `decision.oneOf[].const` 必须是 ACP `PermissionOption.optionId`。
- 按钮文案来自 ACP `PermissionOption.name`。
- 按钮样式可由 ACP `PermissionOption.kind` 派生。
- reject reason 只用于 Nuwax UI/审计,不得写入 ACP `_meta.reason`。
- `request.toolCall.rawInput/content/locations` 的展示、折叠、脱敏和 fallback 是 Web/Mobile UI 责任。

---

## 6. 用户响应与 ACP Response

```ts
type InterventionAction = "submit" | "cancel" | "skip" | "timeout";

interface AcpPermissionInterventionResponse {
  interventionId: string;
  revision: number;
  source: "acp_permission";
  protocol: "acp";
  action: InterventionAction;
  acpResponse: RequestPermissionResponse;
  uiAudit?: { reason?: string };
  receivedAt: number;
}
```

构造规则:

```ts
function buildAcpPermissionResponseFromUi(args: {
  request: RequestPermissionRequest;
  action: InterventionAction;
  decision?: string;
}): RequestPermissionResponse {
  if (args.action !== "submit") {
    return { outcome: { outcome: "cancelled" } };
  }

  const option = args.request.options.find((item) => item.optionId === args.decision);
  if (!option) {
    return { outcome: { outcome: "cancelled" } };
  }

  return { outcome: { outcome: "selected", optionId: option.optionId } };
}
```

Web/Mobile 规则:

1. 用户选择任意 ACP option 时,`acpResponse = { outcome: { outcome: "selected", optionId } }`。
2. `optionId` 必须来自当前 `RequestPermissionRequest.options`。
3. 用户取消、跳过、超时,统一构造 `acpResponse = { outcome: { outcome: "cancelled" } }`。
4. `uiAudit.reason` 只用于产品审计,不写入 ACP `_meta`。
5. Web/Mobile 可以携带 progress message 中的 `callbackTarget` 回传 Backend,但不得直接调用 Host callback。
6. Web/Mobile 不知道 `internalSecret`、Host 地址。

---

## 7. Backend `/respond`

Backend `/respond` 处理:

1. 校验用户有权限操作该 intervention 所属 session/project。
2. 校验 `interventionId` 存在、`revision` 匹配、状态仍为 `pending`。
3. 对 selected response 的 `acpResponse.outcome.optionId` 做白名单校验:必须存在于保存的 `request.acp.request.options`。
4. 校验 `callbackTarget` 是该 session/project 当前允许的 Host target;`callbackTarget` 只是路由 hint,不是用户可随意指定的信任凭据。
5. 在事务内写入 terminal 状态、`resolvedBy`、`resolvedAt`、`acpResponse`。
6. first-writer-wins:并发响应只有第一个生效,后续响应返回 `superseded` 或当前 terminal 状态。
7. 使用校验后的 `callbackTarget` 调用对应 Host 的 `/computer/notify-resolved`。
8. 向所有在线 Web/Mobile 发送 resolved update,禁用卡片并显示处理人。

---

## 8. `/computer/notify-resolved`

Backend -> Host callback:

```http
POST /computer/notify-resolved
Content-Type: application/json
X-Nuwax-Device-Id: <deviceId>
X-Nuwax-Internal-Secret: <secret>
```

`interventionId` 放 body,不放 path。

```ts
interface NotifyResolvedRequest {
  interventionId: string;
  revision: number;
  source: "acp_permission";
  protocol: "acp";
  action: InterventionAction;
  acpResponse: RequestPermissionResponse;
  resolvedBy: {
    kind: "web" | "mobile";
    userId?: string;
    clientId?: string;
  };
  resolvedAt: number;
}

type NotifyResolvedHostStatus =
  | "resolved"
  | "already_resolved"
  | "superseded"
  | "gone";

type NotifyResolvedErrorCode =
  | "unauthorized"
  | "forbidden_target"
  | "not_found"
  | "revision_mismatch"
  | "invalid_acp_response"
  | "already_resolved_conflict"
  | "internal_error";

interface NotifyResolvedResponse {
  ok: boolean;
  hostStatus?: NotifyResolvedHostStatus;
  error?: {
    code: NotifyResolvedErrorCode;
    message: string;
  };
}
```

HTTP status:

| 状态码 | 场景 |
|---|---|
| `200` | resolved 或 already_resolved |
| `202` | Host 已接受但异步 resolve,通常不需要;能同步 resolve 时优先 `200` |
| `400` | body 非法、source/protocol 非 approval、ACP response 非法 |
| `401` | internal secret 校验失败 |
| `403` | deviceId/target 与当前 Host 不匹配 |
| `404` | 找不到 pending 且无法确认已处理 |
| `409` | revision mismatch 或同 intervention 已被不同 response resolve |
| `410` | pending 已超时/取消/gone |
| `500` | Host 内部错误 |

Host 处理:

1. 校验 `X-Nuwax-Device-Id` 与 `X-Nuwax-Internal-Secret`;rcoder 校验等价 target identity 与 secret。
2. 查找本地 `pendingPermissions.get(interventionId)`。
3. 校验 `revision` 与 pending request 一致。
4. 如果 `acpResponse.outcome.outcome === "selected"`,校验 `optionId` 属于原始 ACP `RequestPermissionRequest.options`。
5. 调用 pending resolver,把 `RequestPermissionResponse` 返回给 ACP connection。
6. 删除 pending entry,停止 timeout timer,标记 terminal。
7. 返回 callback ack。

---

## 9. Host 落地状态机

`pendingPermissions` 需要从当前 legacy 形态扩展为 intervention 维度:

```ts
interface PendingAcpPermission {
  interventionId: string;
  revision: number;
  acpSessionId: string;
  appSessionId: string;
  request: RequestPermissionRequest;
  options: PermissionOption[];
  status: "pending" | "resolved" | "cancelled" | "expired";
  resolvedResponse?: RequestPermissionResponse;
  resolve: (response: RequestPermissionResponse) => void;
  timer?: NodeJS.Timeout;
  createdAt: number;
}

private pendingPermissions = new Map<string, PendingAcpPermission>();
```

`handlePermissionRequest()` ask 模式主流程:

```ts
private async handlePermissionRequest(
  acpRequest: RequestPermissionRequest,
): Promise<RequestPermissionResponse> {
  const effectiveMode = this.getEffectiveMode(acpRequest.sessionId);

  if (effectiveMode === "yolo") {
    return this.buildYoloPermissionResponse(acpRequest);
  }

  const intervention = buildAcpPermissionInterventionRequest({
    engine: this.engineName,
    appSessionId: this.toAppSessionId(acpRequest.sessionId),
    acpRequest,
    timeoutMs: DEFAULT_PERMISSION_TIMEOUT_MS,
  });

  return await new Promise<RequestPermissionResponse>((resolve) => {
    const timer = setTimeout(() => {
      this.resolvePendingPermission(intervention.id, {
        outcome: { outcome: "cancelled" },
      }, "timeout");
    }, intervention.timeoutMs);

    this.pendingPermissions.set(intervention.id, {
      interventionId: intervention.id,
      revision: intervention.revision,
      acpSessionId: acpRequest.sessionId,
      appSessionId: intervention.sessionId,
      request: acpRequest,
      options: acpRequest.options,
      status: "pending",
      resolve,
      timer,
      createdAt: Date.now(),
    });

    this.emit("computer:progress", {
      sessionId: intervention.sessionId,
      acpSessionId: acpRequest.sessionId,
      messageType: "acpRequestPermission",
      subType: "session/request_permission",
      data: intervention,
      timestamp: new Date().toISOString(),
    } satisfies AcpRequestPermissionProgressMessage);
  });
}
```

`isValidAcpPermissionResponse()` 只做 ACP 官方 response 校验:

```ts
function isValidAcpPermissionResponse(
  response: RequestPermissionResponse,
  options: PermissionOption[],
): boolean {
  if (response.outcome.outcome === "cancelled") return true;
  if (response.outcome.outcome !== "selected") return false;
  return options.some((option) => option.optionId === response.outcome.optionId);
}
```

幂等规则:

- 同一个 `interventionId + revision` 的相同 callback 返回 `already_resolved`。
- 已 resolved 但收到不同 `acpResponse`,返回 conflict,不得二次 resolve ACP pending。
- Host pending 已不存在时,返回 `already_resolved` 或 `gone`;Backend 不得重新打开用户卡片。
- Host 侧 permission timeout 先发生时,Host 自行 resolve ACP `cancelled`,并通知 Backend/Web/Mobile 卡片失效。

---

## 10. deviceId 与 internalSecret

`deviceId` 只用于标识客户端实例,不能作为 secret。

Electron 首次启动生成 `intervention.internalSecret`,存 SQLite settings:

- 32 字节随机值。
- base64url 编码。
- 不打印完整值。

注册/心跳上报:

```json
{
  "deviceId": "...",
  "interventionInternalSecret": "..."
}
```

后端回调 header:

- `X-Nuwax-Device-Id: <deviceId>`
- `X-Nuwax-Internal-Secret: <secret>`

Electron 校验 secret。deviceId 只用于路由和日志。

---

## 11. 自动策略

`yolo` 自动选择:

```ts
const selected =
  options.find(o => o.kind === "allow_always") ||
  options.find(o => o.kind === "allow_once") ||
  options[0];
```

如果 fallback 选到非 allow option,必须记录 warning/telemetry。

strict guard:

- blocked:直接 ACP `cancelled`。
- strict write request:即使 `yolo` 也进入 approval UI。

---

## 12. 验收

- `acpRequestPermission.data.acp.request` 保留官方 `RequestPermissionRequest`。
- Host 不生成 `InteractionUISchema`。
- Web/Mobile 负责把 ACP request 适配成数据驱动 UI。
- Web/Mobile 生成官方 `RequestPermissionResponse`。
- reject option 以 ACP `selected optionId` 返回。
- cancel/skip/timeout/session cancel 以 ACP `cancelled` 返回。
- `/computer/notify-resolved` 根据 body 中的 `interventionId + revision` 找到 pending 并 resolve。
- selected `optionId` 不属于原始 request options 时拒绝 callback,不 resolve pending。
- callback 重试幂等,不得二次 resolve 同一 ACP pending。
- `internalSecret` 校验失败返回 `401`;`deviceId` 不能当 secret。

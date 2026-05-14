# ACP Permission Request Handler 适配说明

更新时间：2026-05-14

本文记录 NuwaClaw 对 RCoder permission request handler 协议的落地方式。原始 RCoder 设计稿见 `docs/permission-request-handler-design.md`。

## 支持范围

NuwaClaw 当前支持两种 ACP permission 模式：

- `agent_config.agent_server.agent_mode = "yolo"`：自动选择权限选项。
- `agent_config.agent_server.agent_mode = "ask"`：通过 SSE 推送权限请求，等待 `/computer/notify-resolved` 回调。

`agent_mode` 缺失时默认 `yolo`。

## YOLO 行为

YOLO 模式按以下优先级选择 ACP Agent 提供的 option：

1. `allow_always`
2. `allow_once`
3. 第一个 option

如果最终 fallback 到非 allow option，NuwaClaw 会记录 warning。严格沙盒写入保护命中时会降级为一次性允许，避免扩大授权范围。

## ASK SSE

ASK 模式下，NuwaClaw 推送：

- `messageType`: `acpRequestPermission`
- `subType`: `request_permission`
- `data`: RCoder `request_permission_request` payload

示例：

```json
{
  "sessionId": "session_789",
  "acpSessionId": "session_789",
  "messageType": "acpRequestPermission",
  "subType": "request_permission",
  "data": {
    "request_permission_request": {
      "session_id": "session_789",
      "tool_call": {
        "tool_call_id": "tool_001",
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
          "option_id": "allow",
          "name": "允许本次",
          "kind": "allow_once",
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
    },
    "_meta": {
      "nuwaclaw_intervention_id": "itv_xxx",
      "nuwaclaw_revision": 1
    }
  },
  "timestamp": "2026-05-14T13:30:00.000Z"
}
```

`option_id` 由 ACP Agent 生成，NuwaClaw 不解析语义，只校验它是否属于当前 pending request 的 options。

## notify-resolved 回调

`POST /computer/notify-resolved` 支持 RCoder 新协议：

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": {
        "Selected": {
          "option_id": "allow"
        }
      }
    },
    "session_id": "session_789",
    "tool_call_id": "tool_001",
    "save_rule": true
  },
  "user_id": "user_123",
  "project_id": "project_456"
}
```

取消示例：

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": {
        "Cancelled": {}
      }
    },
    "session_id": "session_789",
    "tool_call_id": "tool_001"
  },
  "project_id": "project_456"
}
```

NuwaClaw 使用 `(session_id, tool_call_id)` 定位 pending permission。这里的 `session_id` 是 ACP session id，不是额外生成的 intervention id。

响应使用 rcoder `HttpResult<T>`：

```json
{
  "code": "0000",
  "message": "success",
  "success": true,
  "tid": null,
  "data": {
    "ok": true,
    "hostStatus": "resolved"
  }
}
```

错误码对齐 RCoder：

- `ERR_VALIDATION`
- `ERR_SESSION_NOT_FOUND`
- `ERR_PERMISSION_NOT_FOUND`
- `ERR_PERMISSION_RESOLVE_FAILED`
- `ERR_PERMISSION_EXPIRED`
- `ERR_CONTAINER_ERROR`

## 兼容策略

`/computer/notify-resolved` 仍兼容旧 NuwaClaw intervention body：

```json
{
  "interventionId": "itv_xxx",
  "revision": 1,
  "source": "acp_permission",
  "protocol": "acp",
  "action": "submit",
  "acpResponse": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow"
    }
  }
}
```

旧协议仍返回原始 `{ ok, hostStatus, error }`，避免打断旧 UI 或测试调用方。

## 认证策略

旧 intervention 协议继续要求 `X-Nuwax-Internal-Secret`。

RCoder 新协议支持两种路径：

- 如果请求携带 `X-Nuwax-Internal-Secret`，NuwaClaw 会校验它。
- 如果请求未携带该 header，NuwaClaw 暂时接受 RCoder `permission_resolve_request`，并记录 warning。

这是为了兼容当前 RCoder 设计稿没有声明 internal secret 的情况。RCoder 支持该 header 后，应切回强制校验。

## Cancel 行为

当会话取消时，NuwaClaw 会把该 ACP session 下所有 pending permission resolve 为：

```json
{
  "outcome": {
    "outcome": "cancelled"
  }
}
```

同时清理 intervention id 索引和 `(session_id, tool_call_id)` 索引，避免后续 callback 命中已过期 permission。

## 测试

已覆盖：

- ACP permission request 到 RCoder SSE payload 的映射。
- RCoder `Selected` 到 ACP selected response 的映射。
- RCoder `Cancelled` 到 ACP cancelled response 的映射。
- 缺失字段校验。
- 通过 `(session_id, tool_call_id)` resolve pending。
- 非法 `option_id` 拒绝。
- cancel/timeout 清理 pending 与双索引。

运行命令：

```bash
cd crates/agent-electron-client
npm run test:run -- src/main/services/intervention/rcoderPermissionProtocol.test.ts src/main/services/intervention/approvalInterventionService.test.ts
npm run build:main:dev
```

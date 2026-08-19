# ACP Permission 与 MCP Ask/Question 提测验收计划

更新时间：2026-05-27

## 目标

验证两条人机交互链路在本地开发环境可提测：

1. ACP permission：`ask` 模式下工具调用暂停，前端展示审批卡片，用户选择后经 RCoder `permission_resolve_request` 回执，Agent 继续或拒绝。
2. MCP Ask/question：Agent 调用 `nuwax_ask_question`，前端从标准 `tool_call` 事件渲染表单，用户答案作为下一条普通聊天消息回流。

权限审批字段格式以 `docs/design/permission-request-handler-design.md` 为唯一来源；MCP Ask 字段格式以 `docs/design/mcp-ask-question-acp-toolcall-v1.md` 为唯一来源。

## 覆盖仓库

| 仓库      | 路径                                            | 覆盖内容                                                           |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| NuwaClaw  | `/Users/apple/workspace/nuwaclaw`               | ACP engine、ask/yolo 模式、RCoder SSE、`/computer/notify-resolved` |
| Nuwax Web | `/Users/apple/workspace/nuwax`                  | Ask/Yolo 切换、审批卡片、MCP Ask 表单、回执/回复消息               |
| Backend   | `/Users/apple/workspace/agent-platform`         | `agent_mode` 透传、snake_case permission event 转发、审批回执转发  |
| MCP Ask   | `/Users/apple/workspace/nuwax-ask-question-mcp` | `nuwax_ask_question` stdio 工具、schema 校验、停止当前轮提示       |

## 服务拓扑

```text
Nuwax Web
  ├─ Chat 请求: agent_config.agent_server.agent_mode = "yolo" | "ask"
  ├─ ACP permission 回执: POST /api/agent-interventions/{id}/respond
  └─ MCP Ask 响应: 普通聊天消息

Backend
  ├─ chat → NuwaClaw /computer/chat
  ├─ progress → Web SSE
  └─ /api/agent-interventions/{id}/respond → NuwaClaw /computer/notify-resolved

NuwaClaw
  ├─ /computer/progress/{session_id}
  ├─ /computer/notify-resolved
  └─ ACP engine request_permission handler

nuwax-ask-question-mcp
  └─ MCP stdio tool: nuwax_ask_question
```

## ACP Permission 数据契约

### Chat 请求

```json
{
  "agent_config": {
    "agent_server": {
      "agent_mode": "ask"
    }
  }
}
```

`agent_mode` 只允许：

| 值     | 语义                                  |
| ------ | ------------------------------------- |
| `yolo` | 默认，自动选择 allow option           |
| `ask`  | 创建 pending permission，等待用户审批 |

未知值必须 fail-safe 到 `ask`。

### SSE 权限请求

```json
{
  "session_id": "ses_xxx",
  "message_type": "acpRequestPermission",
  "sub_type": "request_permission",
  "data": {
    "request_permission_request": {
      "session_id": "ses_xxx",
      "tool_call": {
        "tool_call_id": "call_xxx",
        "kind": "execute",
        "status": "pending",
        "title": "bash",
        "content": [],
        "raw_input": {},
        "_meta": {}
      },
      "options": [
        {
          "option_id": "once",
          "name": "Allow once",
          "kind": "allow_once",
          "_meta": {}
        },
        {
          "option_id": "always",
          "name": "Always allow",
          "kind": "allow_always",
          "_meta": {}
        },
        {
          "option_id": "reject",
          "name": "Reject",
          "kind": "reject_once",
          "_meta": {}
        }
      ],
      "_meta": {}
    },
    "tool_call_id": "call_xxx"
  },
  "timestamp": "2026-05-26T07:47:46.175Z"
}
```

### 审批回执

允许或拒绝都使用 `Selected.option_id` 原样回传：

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": {
        "Selected": {
          "option_id": "once"
        }
      }
    },
    "session_id": "ses_xxx",
    "tool_call_id": "call_xxx",
    "save_rule": false
  },
  "conversation_id": 43
}
```

只有会话取消或 pending 清理使用：

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": {
        "Cancelled": {}
      }
    },
    "session_id": "ses_xxx",
    "tool_call_id": "call_xxx"
  }
}
```

## MCP Ask 数据契约

MCP Ask 下发只使用标准 tool call：

```json
{
  "messageType": "agentSessionUpdate",
  "subType": "tool_call",
  "data": {
    "sessionUpdate": "tool_call",
    "toolCallId": "tc_xxx",
    "rawInput": {
      "toolName": "nuwax_ask_question",
      "schemaVersion": "nuwaclaw.mcp_ask.v1",
      "requestId": "ask_123",
      "revision": 1,
      "sessionId": "ses_xxx",
      "title": "请选择继续方式",
      "ui": {
        "version": "nuwaclaw.interaction.v1",
        "presentation": "inline",
        "title": "请选择继续方式",
        "schema": {
          "type": "object",
          "properties": {
            "choice": {
              "type": "string",
              "enum": ["continue", "stop"]
            }
          },
          "required": ["choice"]
        }
      }
    }
  }
}
```

MCP Ask 不调用 `/computer/notify-resolved`，也不需要 HTTP sidecar 或 MCP-side pending store。工具返回只用于提示 Agent 停止当前轮；用户响应由 Nuwax Web 格式化为普通聊天消息。

## 验收用例

### A1. Ask 模式允许本次

1. 打开 Nuwax Web 会话。
2. 切换输入框底部模式为 `Ask`。
3. 发送：

```text
权限审批现场测试：请执行命令 touch acp-permission-live-20260526.txt。不要执行其它操作。
```

预期：

- 日志包含 `agent_mode: "ask"`。
- 日志包含 `session/request_permission` 与 `Permission pending (ask mode)`。
- Web 出现 `ACP 权限审批` 卡片。
- 点击 `Allow once` 后日志包含 `reason=rcoder_callback outcome=selected`。
- 工具完成，文件创建。

### A2. Ask 模式拒绝本次

1. 切换为 `Ask`。
2. 触发创建一个新文件。
3. 点击 `Reject`。

预期：

- Network payload 使用 `Selected.option_id`，值为 reject option。
- 不使用 `Cancelled`。
- 权限卡片不提供额外的“取消”按钮，也不使用 Esc 生成 `Cancelled`。
- 文件不创建。

### A3. Session cancel

1. 卡片 pending 时停止会话。

预期：

- 对同 session 的 pending permission resolve `Cancelled`。
- pending store 清理。
- Agent 不继续执行该工具调用。

### A4. Yolo 自动放行

1. 切换为 `YOLO`。
2. 发送写文件请求。

预期：

- 不出现审批卡片。
- 日志包含 `Permission auto-approved (yolo)`。
- 文件直接创建。

### B1. MCP Ask 表单

1. 配置 `nuwax-ask-question-mcp`：

```json
{
  "ask-question": {
    "source": "custom",
    "enabled": true,
    "command": "node",
    "args": ["/Users/apple/workspace/nuwax-ask-question-mcp/dist/index.js"],
    "env": {}
  }
}
```

2. 让 Agent 调用 `nuwax_ask_question`。

预期：

- 不出现 `acpRequestPermission`。
- Web 根据 `rawInput.ui` 渲染 `McpAskQuestionCard`。
- 用户提交后，产生普通聊天消息，内容使用 `label：value` 格式，不发送 JSON 代码块。
- 下一轮 Agent 读取答案继续。

## 自动化回归

### NuwaClaw

```bash
cd /Users/apple/workspace/nuwaclaw/crates/agent-electron-client
npm run test:run -- \
  src/shared/types/acpMode.test.ts \
  src/main/services/intervention/rcoderPermissionProtocol.test.ts \
  src/main/services/intervention/approvalInterventionService.test.ts \
  src/main/services/engines/acp/opencodeAcpSpawnConfig.test.ts
```

### Nuwax Web

```bash
cd /Users/apple/workspace/nuwax
pnpm vitest run \
  src/components/business-component/AgentIntervention/components/McpAskQuestionCard/index.test.tsx \
  src/components/business-component/AgentIntervention/components/AcpPermissionCard/useAcpPermissionShortcuts.test.tsx \
  src/components/business-component/AgentIntervention/utils/parseMcpAskSchema.test.ts \
  src/components/business-component/AgentIntervention/utils/mcpAskResumeMessage.test.ts \
  src/components/business-component/AgentIntervention/utils/applyAcpPermissionSseEvent.test.ts \
  src/components/business-component/AgentIntervention/utils/applyMcpAskToolCallSseEvent.test.ts \
  src/components/business-component/AgentIntervention/utils/mcpAskHydrateMessage.test.ts \
  src/components/business-component/AgentIntervention/hooks/useActiveInterventionQueue.test.ts \
  src/models/conversationInfoMessageList.test.ts
```

### MCP Ask

```bash
cd /Users/apple/workspace/nuwax-ask-question-mcp
npm run typecheck
npm run build
```

### Backend

```bash
cd /Users/apple/workspace/agent-platform
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home mvn -pl \
  app-platform-modules/app-platform-agent/app-platform-agent-core-infra \
  -Dtest=SandboxAgentClientTest test

JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home mvn -pl \
  app-platform-modules/app-platform-agent/app-platform-agent-core-adapter,\
  app-platform-modules/app-platform-agent/app-platform-agent-core-application,\
  app-platform-modules/app-platform-agent/app-platform-agent-core-infra,\
  app-platform-modules/app-platform-agent/app-platform-agent-core-ui \
  -am -DskipTests compile
```

## 本地证据

### 2026-05-26 浏览器联调

已在 `http://localhost:3000/home/chat/43/21` 验证：

- 发送 Ask 请求后 Web 展示 `ACP 权限审批 / bash / execute` 卡片。
- 点击 `Allow once` 后 NuwaClaw 日志出现 `reason=rcoder_callback outcome=selected`。
- 工具调用完成并创建：

```text
/Users/apple/Downloads/test-electron-client/computer-project-workspace/1/43/acp-permission-live-20260526.txt
```

### 2026-05-27 自动化验证

自动化验证补充：

- Nuwax Web 相关 9 个测试文件、25 个测试通过，覆盖 ACP permission snake_case 事件、权限卡片快捷键不生成 `Cancelled`、MCP Ask 表单渲染与提交 payload、MCP Ask tool_call 识别、历史消息 hydrate、active queue、MCP Ask 普通消息 `label：value` 格式，以及取消/跳过/超时普通消息。
- NuwaClaw 权限审批相关 4 个测试文件、14 个测试通过，覆盖 `agent_mode`、RCoder payload/回执映射、pending resolve、OpenCode ask/yolo 配置。
- Backend `SandboxAgentClientTest` 3 个测试通过，覆盖 `message_type/sub_type` 严格文档字段、旧 `messageType/subType` 兼容、非权限 `tool_call` 不误判。
- Backend 相关 62 个 Maven reactor 模块在 Java 17 下 `-DskipTests compile` 通过，覆盖 agent adapter/application/infra/ui 及依赖模块。
- `nuwax-ask-question-mcp` `npm run typecheck` 与 `npm run build` 通过；clean build 后 `dist` 只包含 `index.*` 与 `types.*`。
- `nuwax-ask-question-mcp` README 已说明无 HTTP sidecar / MCP-side pending store，并补充普通聊天恢复消息的 `label：value` 规则、enumNames/数组/布尔/空值/取消/跳过/超时示例。

提测后手动验收项：

- MCP Ask 表单真实渲染截图。
- 用户提交后生成的普通聊天消息截图，消息内容应为 `label：value` 格式且不包含 JSON 代码块。

说明：当前本地 in-app browser 登录页输入受 virtual clipboard 能力限制，无法在本轮补截图；MCP Ask 表单渲染与提交 payload 已由组件级测试覆盖，截图作为提测后的人工验收证据补充。

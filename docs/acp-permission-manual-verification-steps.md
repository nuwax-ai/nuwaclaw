# ACP Permission / MCP Ask 手动验收步骤

更新时间：2026-05-26

本文档记录本地可复现的提测验收步骤。权限审批字段格式以 `docs/permission-request-handler-design.md` 为唯一来源；MCP Ask 字段格式见 `docs/mcp-ask-question-acp-toolcall-v1.md`。

## 1. 启动服务

### NuwaClaw

```bash
cd /Users/apple/workspace/nuwaclaw/crates/agent-electron-client
npm run dev
```

确认 computer server 已监听：

```bash
lsof -nP -iTCP:60006 -sTCP:LISTEN
```

观察日志：

```bash
tail -f /Users/apple/.nuwaclaw/logs/main.$(date +%F).log | rg --line-buffered \
  "agent_mode|request_permission|acpRequestPermission|Permission pending|notify-resolved|rcoder_callback|Permission auto-approved|Denying question"
```

### Nuwax Web

```bash
cd /Users/apple/workspace/nuwax
pnpm dev
```

浏览器打开：

```text
http://localhost:3000/home/chat/<conversationId>/<agentId>
```

## 2. Ask 模式权限审批

### 前置

1. 登录 Nuwax Web。
2. 打开一个绑定本机 NuwaClaw sandbox 的会话。
3. 在输入框底部的模式选择器中选择 `Ask`。

### 触发

发送：

```text
权限审批现场测试：请执行命令 touch acp-permission-live-20260526.txt。不要执行其它操作。
```

### 预期 UI

页面应出现 `AcpPermissionCard`：

- 标题：`ACP 权限审批`
- 工具：`bash`
- kind：`execute`
- 选项：`Allow once`、`Always allow`、`Reject`、`取消`

### 预期日志

NuwaClaw 日志应包含：

```text
"agent_mode": "ask"
method="session/request_permission"
Permission pending (ask mode)
messageType":"acpRequestPermission"
subType":"request_permission"
```

SSE payload 的业务字段必须是 RCoder snake_case：

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
  }
}
```

### 允许本次

点击 `Allow once`。

预期：

- Backend 调用 `/api/agent-interventions/{id}/respond`。
- NuwaClaw 收到 `/computer/notify-resolved`。
- 日志出现 `reason=rcoder_callback outcome=selected`。
- 工具调用完成。
- 工作区出现目标文件。

工作区验证：

```bash
find /Users/apple/Downloads/test-electron-client/computer-project-workspace/1/43 \
  -maxdepth 1 -name 'acp-permission-live-20260526.txt' -ls
```

### 拒绝本次

重新触发一次不同文件名，点击 `Reject`。

预期回执不是 `Cancelled`，而是原样透传 reject option：

```json
{
  "permission_resolve_request": {
    "request_permission_response": {
      "outcome": {
        "Selected": {
          "option_id": "reject"
        }
      }
    },
    "session_id": "ses_xxx",
    "tool_call_id": "call_xxx",
    "save_rule": false
  }
}
```

目标文件不应创建。

### 会话取消

权限卡片 pending 时停止会话。

预期：

- NuwaClaw 对同 session 的 pending permission 回复 `Cancelled`。
- pending 被清理。
- 不应只删除内存记录而不 resolve responder。

## 3. Yolo 模式

在输入框底部选择 `YOLO` 后发送写文件请求。

预期：

- 不出现审批卡片。
- 日志出现 `Permission auto-approved (yolo)`。
- 文件直接创建。

## 4. MCP Ask / Question

### 构建 MCP stdio 工具

```bash
cd /Users/apple/workspace/nuwax-ask-question-mcp
npm install
npm run build
```

### MCP 配置示例

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

### 触发

让 Agent 调用 `nuwax_ask_question`，输入必须包含：

```json
{
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
```

### 预期

- 不出现 `acpRequestPermission`。
- 不调用 `/computer/notify-resolved`。
- 不启动 HTTP 服务，不保留 MCP-side pending，不调用 `/respond`。
- 前端从 `agentSessionUpdate/tool_call` 的 `rawInput.ui` 渲染表单。
- MCP 工具结果只提示 Agent 停止当前轮。
- 用户提交后，Web 发送普通聊天消息，下一轮 Agent 读取答案继续。
- 普通聊天消息使用 `label：value` 格式，不发送 JSON 代码块。

## 5. 回归测试

### NuwaClaw

```bash
cd /Users/apple/workspace/nuwaclaw/crates/agent-electron-client
npm run test:run -- \
  src/shared/types/acpMode.test.ts \
  src/main/services/intervention/rcoderPermissionProtocol.test.ts \
  src/main/services/intervention/approvalInterventionService.test.ts \
  src/main/services/engines/acp/opencodeAcpSpawnConfig.test.ts
```

`acpEngine.test.ts` 依赖完整 Electron 安装；如果本地 Electron 包缺少 `dist/Electron.app`，需先修复依赖环境再运行。

### Nuwax Web

```bash
cd /Users/apple/workspace/nuwax
pnpm vitest run \
  src/components/business-component/AgentIntervention/utils/parseMcpAskSchema.test.ts \
  src/components/business-component/AgentIntervention/utils/mcpAskResumeMessage.test.ts \
  src/components/business-component/AgentIntervention/utils/applyAcpPermissionSseEvent.test.ts \
  src/components/business-component/AgentIntervention/utils/applyMcpAskToolCallSseEvent.test.ts \
  src/components/business-component/AgentIntervention/utils/mcpAskHydrateMessage.test.ts \
  src/components/business-component/AgentIntervention/hooks/useActiveInterventionQueue.test.ts \
  src/models/conversationInfoMessageList.test.ts
```

### MCP Ask Server

```bash
cd /Users/apple/workspace/nuwax-ask-question-mcp
npm run typecheck
npm run build
```

## 6. 提测记录模板

| 项                            | 结果 | 证据                                          |
| ----------------------------- | ---- | --------------------------------------------- |
| Ask 模式弹审批                |      | 页面截图 + `Permission pending` 日志          |
| Allow once 继续执行           |      | `rcoder_callback outcome=selected` + 文件创建 |
| Reject 原样回传 option_id     |      | Network payload + 文件未创建                  |
| Session cancel 回 `Cancelled` |      | cancel 日志 + pending 清理                    |
| Yolo 自动放行                 |      | `Permission auto-approved` + 无审批卡片       |
| MCP Ask 表单渲染              |      | `agentSessionUpdate/tool_call` + 表单截图     |
| MCP Ask 下一轮消息回流        |      | `label：value` 用户消息内容 + Agent 后续响应  |

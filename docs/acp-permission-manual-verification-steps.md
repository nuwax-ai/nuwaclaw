# ACP Permission 手动验收调试步骤

> 实际可操作的调试手册，基于 NuwaClaw Electron 客户端的真实 UI 结构编写。
> NuwaClaw 的会话界面是嵌入式 webview（加载 nuwax Web 应用），不是原生 Electron 组件。

## 关键背景

- **NuwaClaw UI**：Dashboard / Sessions / MCP / Settings / Dependencies 等标签页
- **会话界面**：点击 Sessions → Open 后打开 `<webview>` 嵌入 nuwax Web，聊天在此进行
- **ACP mode**：由 Backend chat 请求的 `agent_config.agent_server.agent_mode` 驱动，Electron 无 UI 控件切换
- **默认 mode**：`"yolo"`（自动放行所有工具调用），要测 permission pending 需切到 `"ask"`
- **Admin API**：已新增 `/admin/acp-mode` 端点，可运行时切换 mode，无需重启

---

## 前置准备

### Terminal 1 — 启动 NuwaClaw

```bash
cd /Users/apple/workspace/nuwaclaw
git switch feature/electron-client-0.12
make electron-dev
```

等待 Electron 窗口出现。首次启动走 Setup Wizard（依赖安装 → 配置端口/工作区 → 登录）。

### Terminal 2 — 观察日志

```bash
cd /Users/apple/workspace/nuwaclaw
tail -f logs/electron-dev.log | rg --line-buffered \
  "Permission pending|Permission auto-approved|Permission resolved|acpRequestPermission|notify-resolved|ERR_PERMISSION|Denying question|itv_|resolvePermission|acp-mode"
```

### Terminal 3 — 手动 curl（调试用）

后续所有 curl 命令都在此终端执行。

### 确认 NuwaClaw 已就绪

```bash
curl http://127.0.0.1:60006/health
# 预期: {"status":"ok"}
```

---

## A1. Ask 模式 — Permission Pending + 手动回调允许

### 步骤 1：创建会话

1. NuwaClaw UI → Sessions 标签
2. 点击「New Session」或列表中的「Open」按钮
3. webview 加载 nuwax Web 聊天界面
4. 输入任意消息建立会话（如「你好」），等待 agent 响应完成

### 步骤 2：找到 session_id

在 Terminal 2 日志中找到 `acpSessionId`：

```
[AcpEngine:codex] 📨 chat() request received ... session_id: <UUID>
```

或从 admin API 查询：

```bash
curl http://127.0.0.1:60006/admin/acp-mode
# 返回: {"code":"0000","data":{"<acpSessionId>":"yolo (default)"}}
```

记录 `acpSessionId`（UUID 格式）。

### 步骤 3：切换到 ask 模式

```bash
# 替换 <acpSessionId> 为步骤 2 获取的值
curl -X POST http://127.0.0.1:60006/admin/acp-mode \
  -H 'Content-Type: application/json' \
  -d '{"acpSessionId":"<acpSessionId>","mode":"ask"}'
# 预期: {"code":"0000","message":"ACP mode set to \"ask\"",...}

# 验证
curl http://127.0.0.1:60006/admin/acp-mode
# 预期: {"code":"0000","data":{"<acpSessionId>":"ask"}}
```

### 步骤 4：开启 SSE 监听

```bash
# 替换 <acpSessionId> 为实际值
curl -N http://127.0.0.1:60006/computer/progress/<acpSessionId>
```

### 步骤 5：触发 permission

回到 NuwaClaw webview，在聊天输入框发送：

```
请在当前工作区创建 approval-test.txt，并写入当前时间戳。
```

### 步骤 6：观察 SSE

Terminal 3 的 SSE 输出应出现：

```
event: session/request_permission
data: {"sessionId":"...","messageType":"acpRequestPermission","subType":"session/request_permission","data":{"id":"itv_xxx","revision":1,...,"acp":{"request":{"toolCall":{"toolCallId":"...","kind":"bash","title":"bash","rawInput":{"command":"..."}},"options":[{"optionId":"always_allow:terminal","name":"始终允许","kind":"allow_always"},{"optionId":"allow","name":"允许本次","kind":"allow_once"}]}}}}
```

**检查点**：
- ✅ `messageType` = `"acpRequestPermission"`
- ✅ `subType` = `"session/request_permission"`
- ✅ `data.id` 以 `"itv_"` 开头
- ✅ `data.acp.request.toolCall.toolCallId` 非空
- ✅ `data.acp.request.options` 含至少 2 个选项

Terminal 2 日志应出现：
```
[AcpEngine:codex] 📋 Permission pending (ask mode): id=itv_xxx tool=bash
```

### 步骤 7：手动回调允许

从 SSE data 中提取 `data.id`（interventionId）和一个 allow 选项的 `optionId`：

```bash
# 替换实际值
curl -X POST http://127.0.0.1:60006/computer/notify-resolved \
  -H 'Content-Type: application/json' \
  -d '{
    "interventionId": "<itv_xxx>",
    "revision": 1,
    "source": "acp_permission",
    "protocol": "acp",
    "action": "submit",
    "acpResponse": {
      "outcome": { "outcome": "selected", "optionId": "<allow 的 optionId>" }
    },
    "resolvedBy": { "kind": "web" },
    "resolvedAt": 0
  }'
```

**预期响应**：

```json
{"ok":true,"hostStatus":"resolved"}
```

Terminal 2 日志应出现 resolve 成功。
Agent 继续执行，workspace 下出现 `approval-test.txt`。

**A1 ✅ 通过标准**：SSE 格式正确 + 回调 `{"ok":true}` + agent 继续 + 文件已创建

---

## A2. Ask 模式 — Permission Pending + 手动回调取消

### 步骤 1-6

同 A1：创建新会话（或新消息），切 ask，触发写文件，等待 SSE。

> 注意：如果复用同一会话，mode 仍是 ask，无需再次切换。

### 步骤 7：回调取消

```bash
curl -X POST http://127.0.0.1:60006/computer/notify-resolved \
  -H 'Content-Type: application/json' \
  -d '{
    "interventionId": "<itv_xxx>",
    "revision": 1,
    "source": "acp_permission",
    "protocol": "acp",
    "action": "cancel",
    "acpResponse": {
      "outcome": { "outcome": "cancelled" }
    },
    "resolvedBy": { "kind": "web" },
    "resolvedAt": 0
  }'
```

**预期响应**：`{"ok":true,"hostStatus":"resolved"}`

### 步骤 8：验证

- Agent 不执行该工具调用
- Workspace 下**不出现**新文件
- 日志无残留 pending

### 步骤 9：幂等性验证

再次发送同一 resolve：

```bash
# 同步骤 7 的 curl
```

**预期**：`{"ok":false,"error":{"code":"ERR_PERMISSION_NOT_FOUND",...}}`

**A2 ✅ 通过标准**：取消生效 + agent 不执行 + 无残留 + 重复 resolve 被拒绝

---

## A3. Yolo 模式 — 自动放行

### 步骤 1：切回 yolo

```bash
curl -X POST http://127.0.0.1:60006/admin/acp-mode \
  -H 'Content-Type: application/json' \
  -d '{"acpSessionId":"<acpSessionId>","mode":"yolo"}'
```

### 步骤 2：触发写文件

在 webview 中发送：

```
请在当前工作区创建 yolo-test.txt，写入 hello。
```

### 验证

- Terminal 2 日志出现 `Permission auto-approved (yolo): tool=bash`
- **不出现** `acpRequestPermission` SSE 事件
- Agent 直接创建文件，无暂停

**A3 ✅ 通过标准**：自动放行 + 无 SSE permission + 文件已创建

---

## A4. Question 类型保护

此用例在 ask/question MCP 调用时自动触发。当 agent 调用 `nuwax_ask_user` 时：
- ACP engine 收到 `kind === "question"` 的 permission request
- `handlePermissionRequest` 直接 deny（返回 cancelled）
- 日志出现 `Denying question-type request`
- Agent 通过 `agentSessionUpdate` tool_call 正常流转（不走 permission pending）

观察方式：

```bash
tail -f logs/electron-dev.log | rg "Denying question"
```

**A4 ✅ 通过标准**：question 被 deny + 不创建 pending + tool_call 正常桥接

---

## B1. Web 审批卡片（需 nuwax Web 本地 dev + Backend）

### 前置

- NuwaClaw 已启动并运行会话
- 测试环境 `testagent.xspaceagi.com` 可达
- Backend 能将 `/api/agent-interventions/{id}/respond` 路由到 NuwaClaw

### 步骤 1：启动 Web dev

```bash
cd /Users/apple/workspace/nuwax
git switch codex/acp-mode-intervention-ui
pnpm install && pnpm dev
```

### 步骤 2：确认 NuwaClaw 在 ask 模式

```bash
curl http://127.0.0.1:60006/admin/acp-mode
# 应看到 "ask"
```

### 步骤 3：打开同一会话

在浏览器访问 Web dev server，打开与 NuwaClaw webview 相同的会话。

### 步骤 4：触发 permission

在 Web 或 NuwaClaw webview 中发送写文件请求。

### 步骤 5：观察 Web

- DevTools → Network → EventStream（SSE）：`event: session/request_permission`
- 页面出现 `AcpPermissionCard` 卡片
- 卡片展示 tool title、toolCallId、rawInput、选项按钮

### 步骤 6：点击允许

- 点击「允许本次」
- DevTools → Network → XHR：`POST /api/agent-interventions/{id}/respond`
- 请求体为 v3 格式（`interventionId` + `acpResponse`）
- 卡片变灰（submitted 状态）
- Agent 继续执行

**B1 ✅ 通过标准**：卡片渲染 + v3 回调格式 + agent 继续 + 防重复

---

## C1/C2. Mobile H5（需 HBuilderX + Backend）

### 前置

- NuwaClaw 已启动，ask 模式
- `nuwax-mobile` 分支 `codex/acp-mode-intervention-mobile-approval`
- HBuilderX 运行 H5

### C1 验证接收

1. H5 打开同一会话
2. 触发 permission（在 NuwaClaw 端发写文件请求）
3. H5 DevTools Console：看到 `normalizeAcpPermissionProgressMessage` 日志
4. H5 页面出现审批卡片
5. 不出现普通文本渲染 permission 数据

### C2 验证回调

1. 在 H5 卡片点击「允许」
2. DevTools → Network：`POST /api/computer/notify-resolved`
3. 请求体为 v3 格式（因为 SSE 来源是 v3）
4. Agent 继续

**C1/C2 ✅ 通过标准**：事件接收 + 卡片渲染 + v3 回调 + agent 继续

---

## D1. Ask/Question MCP 闭环（需 MCP server 配置）

### 步骤 1：构建 MCP

```bash
cd /Users/apple/workspace/nuwax-ask-question-mcp
npm install && npm run build
```

### 步骤 2：配置 NuwaClaw MCP

NuwaClaw Settings → MCP 添加：

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

### 步骤 3：发送提示词

```
请调用 nuwax_ask_user 询问我 approval-test.txt 要写入什么标题，等待我的回答后再创建文件。
```

### 验证隔离

- NuwaClaw **不发出** `acpRequestPermission` SSE
- 日志**可能出现** `Denying question-type request`（保护行为，正常）
- Web 收到 `agentSessionUpdate` tool_call（非 permission），rawInput 含 `schemaVersion: "nuwaclaw.mcp_ask.v1"`
- 用户回答后 → Backend → MCP sidecar `POST http://127.0.0.1:63334/respond`
- Agent 收到答案继续

**D1 ✅ 通过标准**：不走 permission + tool_call 正常 + MCP 闭环

---

## E1. Web + Mobile 同时在线

1. Web 和 Mobile H5 同时打开同一会话
2. 切 ask，触发 permission
3. 两端都看到卡片
4. 在 Web 点允许 → agent 继续
5. Mobile 卡片应变为不可提交（或重复提交返回 `already_resolved`）

**E1 ✅ 通过标准**：两端都看到 pending + 首个 resolve 生效 + 另一端不重复

---

## F1. 工作空间路径

```
请告诉我当前工作目录，并列出当前目录的前 5 个文件。
```

- 工作目录 = 用户 workspace（非 `/tmp/nuwaclaw-run-*`）
- 路径无重复片段

**F1 ✅ 通过标准**：路径正确 + 无重复

---

## G1. codex-acp v0.15.1 集成

```bash
unset CODEX_ACP_BIN
make electron-dev
```

```bash
tail -f logs/electron-dev.log | rg "nuwax-codex-acp|prepare|/v1/responses|CODEX_"
```

- `prepare` 下载 `nuwax-codex-acp` 成功
- API Key 注入正确
- **不出现** `Cannot GET /v1/responses`

**G1 ✅ 通过标准**：prepare 成功 + API 配置正确 + 无错误路由

---

## 调试速查

### 查看 ACP 模式

```bash
curl http://127.0.0.1:60006/admin/acp-mode
```

### 切换到 ask（所有会话）

```bash
curl -X POST http://127.0.0.1:60006/admin/acp-mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"ask"}'
```

### 切换到 yolo（所有会话）

```bash
curl -X POST http://127.0.0.1:60006/admin/acp-mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"yolo"}'
```

### 查看 SSE 事件流

```bash
curl -N http://127.0.0.1:60006/computer/progress/<acpSessionId>
```

### 健康检查

```bash
curl http://127.0.0.1:60006/health
```

---

## 结果记录

| 用例 | 结果 | 证据 | 问题 |
|------|------|------|------|
| A1 ask allow | | SSE payload + curl 响应 + 文件 | |
| A2 ask cancel | | curl 响应 + 无文件 + 幂等 | |
| A3 yolo auto | | 日志 auto-approved + 文件 | |
| A4 question guard | | 日志 Denying question | |
| B1 Web allow | | DevTools 截图 + Network | |
| C1 Mobile receive | | H5 console + 截图 | |
| C2 Mobile resolve | | Network payload | |
| D1 ask/question MCP | | tool_call + MCP response | |
| E1 multi-end race | | 两端截图 | |
| F1 workspace path | | agent 回复 | |
| G1 v0.15.1 integration | | 启动日志 | |

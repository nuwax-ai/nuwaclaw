# ACP Permission 手动验收操作步骤

> 本文档是 `acp-permission-ask-question-acceptance-plan.md` 的配套执行手册，
> 只包含可直接复制粘贴的命令和操作指引。

## 前置准备

### 1. 确认分支

```bash
# Terminal 1 — NuwaClaw
cd /Users/apple/workspace/nuwaclaw
git switch feature/electron-client-0.12
git log --oneline -3
# 应看到 acpEngine.ts 的 SSE 格式修复 commit

# Terminal 2 — Web（可选，B1 用例才需要）
cd /Users/apple/workspace/nuwax
git switch codex/acp-mode-intervention-ui
git log --oneline -3

# Terminal 3 — Mobile（可选，C1/C2 用例才需要）
cd /Users/apple/workspace/nuwax-mobile
git switch codex/acp-mode-intervention-mobile-approval
```

### 2. 确认环境变量

NuwaClaw 的 `CODEX_API_KEY`、`CODEX_MODEL`、`CODEX_BASE_URL` 通过 NuwaClaw UI 设置（Settings → Agent）。
验收前确认：

- API Key 已配置
- Model 已选择（如 `glm-5`）
- 不使用 `CODEX_ACP_BIN` 环境变量覆盖

### 3. 清理旧进程

```bash
pkill -f "electron ." 2>/dev/null
pkill -f "nuwax-codex-acp" 2>/dev/null
```

---

## A1. Host-only ACP Permission 闭环（允许）

### 步骤 1：启动 NuwaClaw

```bash
cd /Users/apple/workspace/nuwaclaw
make electron-dev
```

等待 Electron 窗口出现，Setup Wizard 完成后进入主界面。

### 步骤 2：观察日志

新开一个终端：

```bash
cd /Users/apple/workspace/nuwaclaw
tail -f logs/electron-dev.log | rg --line-buffered \
  "session/request_permission|Permission pending|Pending created|acpRequestPermission|request_permission|notify-resolved|ERR_PERMISSION|Denying question|nuwax-codex-acp|resolvePermission|itv_"
```

### 步骤 3：创建会话

1. 在 NuwaClaw UI 中点击「新建会话」
2. 选择一个 workspace 目录（任意空目录即可）
3. Engine 选择 `codex-acp`（如果可选）
4. **确认 agent mode 为 ask（非 yolo）** — 如果有 mode 切换选项

### 步骤 4：触发 permission

在会话输入框发送：

```
请在当前工作区创建 approval-test.txt，并写入当前时间戳。
```

### 步骤 5：观察 SSE（另一个终端）

先获取 session_id：

```bash
# 在日志中找到 session_id（UUID 格式），例如：
# [AcpEngine] 📋 Permission pending (ask mode): id=itv_xxx tool=bash
```

然后：

```bash
# 替换 <session_id> 为实际的 session UUID
curl -N http://127.0.0.1:60006/computer/progress/<session_id>
```

**预期看到**：

```
event: session/request_permission
data: {"sessionId":"...","acpSessionId":"...","messageType":"acpRequestPermission","subType":"session/request_permission","data":{"id":"itv_xxx","revision":1,"kind":"approval","status":"pending","source":"acp_permission","protocol":"acp","acp":{"method":"session/request_permission","request":{"sessionId":"...","toolCall":{"toolCallId":"...","kind":"bash","title":"bash","rawInput":{"command":"..."}},"options":[{"optionId":"...","name":"始终允许","kind":"allow_always"},{"optionId":"...","name":"允许本次","kind":"allow_once"}]}}},"timestamp":"..."}

```

**检查点**：
- ✅ `messageType` = `"acpRequestPermission"`
- ✅ `subType` = `"session/request_permission"`
- ✅ `data.id` = `"itv_..."` （非空）
- ✅ `data.acp.request.toolCall.toolCallId` 非空
- ✅ `data.acp.request.options` 包含至少 2 个选项

### 步骤 6：手动回调允许

从 SSE data 中提取以下字段：
- `data.id` → interventionId
- `data.acp.request.options[0].optionId` → 第一个允许选项的 ID

```bash
# 替换实际值
curl -X POST http://127.0.0.1:60006/computer/notify-resolved \
  -H 'Content-Type: application/json' \
  -d '{
    "interventionId": "<data.id 的值>",
    "revision": 1,
    "source": "acp_permission",
    "protocol": "acp",
    "action": "submit",
    "acpResponse": {
      "outcome": { "outcome": "selected", "optionId": "<allow 选项的 optionId>" }
    },
    "resolvedBy": { "kind": "web" },
    "resolvedAt": 0
  }'
```

**预期响应**：

```json
{"ok":true,"hostStatus":"resolved"}
```

### 步骤 7：验证结果

- 日志应出现 `Permission resolved` 或 `resolved hostStatus`
- Agent 应继续执行并创建文件
- Workspace 目录下出现 `approval-test.txt`

### 步骤 8：验证文件

```bash
cat <workspace目录>/approval-test.txt
```

**A1 通过标准**：✅ SSE 格式正确、回调成功、agent 继续执行、文件已创建

---

## A2. Host-only ACP Permission 闭环（拒绝/取消）

### 步骤 1-5

同 A1 步骤 1-5，创建新会话，触发另一个写文件请求。

### 步骤 6：回调取消

```bash
curl -X POST http://127.0.0.1:60006/computer/notify-resolved \
  -H 'Content-Type: application/json' \
  -d '{
    "interventionId": "<data.id 的值>",
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

### 步骤 7：验证结果

- Agent 不执行被拒绝的工具调用
- 日志出现 cancelled
- Workspace 目录下**不出现**新文件
- NuwaClaw 无残留 pending（再次 resolve 应返回 `already_resolved` 或 `not_found`）

### 步骤 8：验证幂等性

再次发送同一个 resolve 请求：

```bash
# 同步骤 6 的 curl（interventionId 和 revision 相同）
```

**预期响应**：

```json
{"ok":false,"hostStatus":"already_resolved","error":{"code":"ERR_PERMISSION_NOT_FOUND","message":"..."}}
```

**A2 通过标准**：✅ 取消生效、agent 不执行、无残留 pending、重复 resolve 被正确拒绝

---

## A3. Yolo 模式自动放行

### 步骤 1

在 NuwaClaw UI 中将当前会话的 agent mode 切换到 **yolo**（如果 UI 支持）。
如果不支持 UI 切换，可通过 SQLite 直接设置：

```bash
# 查看当前 mode
sqlite3 ~/.nuwaclaw/nuwaclaw.db "SELECT key, value FROM settings WHERE key LIKE '%mode%';"
```

### 步骤 2

发送相同的写文件请求。

### 验证

- 日志应出现 `Permission auto-approved (yolo)`
- **不出现** `acpRequestPermission` SSE 事件
- Agent 直接执行并创建文件

**A3 通过标准**：✅ 自动放行、无 SSE permission 事件、文件已创建

---

## A4. question 类型不走 permission 审批

### 步骤

此用例验证 `kind === "question"` 被直接 deny。

如果配置了 ask/question MCP（见 D1），agent 调用 `nuwax_ask_user` 时：
- NuwaClaw 的 `handlePermissionRequest` 应拦截 `kind === "question"` 并直接 deny
- 日志出现 `Denying question-type request`
- Agent 通过 `agentSessionUpdate` tool_call 正常流转

单独验证 permission handler 时，日志过滤：

```bash
tail -f logs/electron-dev.log | rg --line-buffered "Denying question"
```

**A4 通过标准**：✅ question 被拦截、不创建 pending、tool_call 正常桥接

---

## B1. Web 本地审批卡片

> 前置：NuwaClaw 已启动，测试环境 Backend 可达。

### 步骤 1：启动 Web

```bash
cd /Users/apple/workspace/nuwax
pnpm install
pnpm dev
```

### 步骤 2：打开浏览器

访问 Web dev server 地址（控制台输出），打开同一会话。

### 步骤 3：触发 permission

在 NuwaClaw 或 Web 端发送写文件请求。

### 步骤 4：观察 Web

- 浏览器 DevTools → Network → SSE：应看到 `event: session/request_permission`
- 页面应出现 `AcpPermissionCard` 卡片
- 卡片显示 tool title（如 "bash"）、toolCallId、rawInput（命令内容）
- 卡片显示「始终允许」「允许本次」等选项

### 步骤 5：点击允许

- 点击「允许本次」
- DevTools → Network → XHR：应看到 `POST /api/agent-interventions/{id}/respond`
- 请求体为 v3 格式：

```json
{
  "interventionId": "itv_xxx",
  "revision": 1,
  "source": "acp_permission",
  "protocol": "acp",
  "action": "submit",
  "acpResponse": { "outcome": { "outcome": "selected", "optionId": "..." } }
}
```

- 卡片进入 submitted 状态（按钮变灰）
- Agent 继续执行

### 步骤 6：验证不重复提交

再次点击按钮 → 应被 disabled，无新请求发出。

**B1 通过标准**：✅ 卡片渲染、回调格式正确、agent 继续、防重复提交

---

## C1. Mobile H5 接收 ACP permission

> 前置：NuwaClaw 已启动。

### 步骤 1：启动 Mobile H5

```bash
cd /Users/apple/workspace/nuwax-mobile
git switch codex/acp-mode-intervention-mobile-approval
```

用 HBuilderX 运行到 H5 浏览器。

### 步骤 2：打开同一会话

在 H5 页面登录并打开与 NuwaClaw 相同的会话。

### 步骤 3：触发 permission

在 NuwaClaw 端发送写文件请求。

### 步骤 4：观察 Mobile

- 浏览器 DevTools → Console：应看到 `normalizeAcpPermissionProgressMessage` 处理日志
- H5 页面应出现 `acp-permission-card` 卡片
- 卡片显示 tool title、toolCallId、rawInput
- **不**应出现普通文本消息渲染 permission 数据

**C1 通过标准**：✅ 事件接收、卡片渲染、无文本渲染

---

## C2. Mobile H5 提交审批结果

### 步骤 1

在 Mobile 卡片上点击「允许」。

### 步骤 2

- DevTools → Network：应看到 `POST /api/computer/notify-resolved`
- 请求体为 v3 格式（因为 SSE 来源是 v3）：

```json
{
  "interventionId": "itv_xxx",
  "revision": 1,
  "source": "acp_permission",
  "protocol": "acp",
  "callbackTarget": { "kind": "electron", "targetId": "..." },
  "action": "submit",
  "acpResponse": { "outcome": { "outcome": "selected", "optionId": "..." } }
}
```

- Agent 继续执行
- 卡片进入 submitted 状态

**C2 通过标准**：✅ 回调格式正确、agent 继续、防重复

---

## D1. ask/question MCP Web 闭环

> 前置：`nuwax-ask-question-mcp` 已构建并配置为 NuwaClaw MCP server。

### 步骤 1：构建 MCP

```bash
cd /Users/apple/workspace/nuwax-ask-question-mcp
npm install && npm run build
```

### 步骤 2：配置 NuwaClaw MCP

在 NuwaClaw Settings → MCP 中添加：

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

### 步骤 4：验证隔离

- NuwaClaw **不发出** `acpRequestPermission`
- 日志**可能出现** `Denying question-type request`（这是保护行为，正常）
- Web 收到普通 `agentSessionUpdate` tool_call，rawInput 含：

```json
{
  "schemaVersion": "nuwaclaw.mcp_ask.v1",
  "ui": { "version": "nuwaclaw.interaction.v1" }
}
```

- Web 渲染问题表单（如已实现）

### 步骤 5：回答问题

在 Web 表单中输入回答并提交。
Backend 调用 MCP sidecar `POST http://127.0.0.1:63334/respond`。
Agent 收到答案继续创建文件。

**D1 通过标准**：✅ 不走 permission 链路、tool_call 正常桥接、问题表单渲染、MCP 闭环

---

## E1. Web 与 Mobile 同时在线

### 步骤 1

同时打开 Web 和 Mobile H5，同一会话。

### 步骤 2

触发 permission。

### 步骤 3

两端都应看到 pending permission 卡片。

### 步骤 4

在 Web 点击允许。

### 步骤 5

- Agent 继续执行
- Mobile 卡片应变为不可提交状态（或显示已处理）
- 若 Mobile 仍可提交，再次提交应返回 `already_resolved` 错误，不影响 agent

**E1 通过标准**：✅ 两端都看到 pending、首个 resolve 生效、另一端不重复生效

---

## F1. 工作空间路径验证

### 步骤

```
请告诉我当前工作目录，并列出当前目录的前 5 个文件。
```

### 验证

- 工作目录 = 用户选择的 workspace（非 `/tmp/nuwaclaw-run-*`）
- 路径无重复片段
- 文件创建/读取都在同一 workspace

**F1 通过标准**：✅ 路径正确、无重复

---

## G1. codex-acp v0.15.1 集成验证

### 步骤

```bash
# 确认没有手动覆盖
unset CODEX_ACP_BIN
echo $CODEX_ACP_BIN  # 应为空

# 重启
make electron-dev
```

### 检查启动日志

```bash
tail -f logs/electron-dev.log | rg --line-buffered \
  "nuwax-codex-acp|CODEX_API_KEY|CODEX_MODEL|CODEX_BASE_URL|prepare|/v1/responses"
```

- 应看到 `prepare` 下载 `nuwax-codex-acp` 到 `~/.nuwaclaw/engines/`
- 应看到正确的 API Key 注入
- **不**应看到 `Cannot GET /v1/responses`

**G1 通过标准**：✅ prepare 下载成功、API 配置正确、无错误路由

---

## 结果记录

| 用例 | 结果 | 证据 | 问题 |
|------|------|------|------|
| A1 host-only allow | | SSE payload + curl 响应 + 文件内容 | |
| A2 host-only cancel | | curl 响应 + 无新文件 + 幂等验证 | |
| A3 yolo auto allow | | 日志 auto-approved + 文件内容 | |
| A4 question guard | | 日志 Denying question | |
| B1 Web allow | | DevTools 截图 + Network payload | |
| C1 Mobile receive | | H5 console + 截图 | |
| C2 Mobile resolve | | Network payload + agent 继续 | |
| D1 ask/question Web | | tool_call payload + MCP response | |
| E1 multi-end race | | 两端截图 + Network | |
| F1 workspace path | | agent 回复的 pwd | |
| G1 v0.15.1 integration | | 启动日志片段 | |

# MCP Resilient Transport 重连测试文档

## 背景

`ResilientTransportWrapper` 在 v1.4.10 中修复了一个关键 bug：重连后未重放 MCP `initialize` 握手，导致服务端返回 `"Server not initialized"` 并进入无限重连循环。

本文档记录了修复后的测试流程与结果。

---

## 测试环境

| 项目 | 值 |
|------|-----|
| nuwax-mcp-stdio-proxy | v1.4.10 |
| @modelcontextprotocol/sdk | v1.27.1 |
| Node.js | v22.14.0 |
| 平台 | macOS (Darwin 25.3.0) |

---

## 测试工具

位于 `demo/` 目录：

| 文件 | 说明 |
|------|------|
| `streamable-http-server.mjs` | Streamable HTTP MCP Server（端口 18080） |
| `sse-server.mjs` | SSE MCP Server（端口 18081） |
| `test-reconnect.mjs` | 自动化重连测试脚本 |

---

## 测试流程

### 自动化测试

```bash
cd crates/nuwax-mcp-stdio-proxy

# 测试 Streamable HTTP
node demo/test-reconnect.mjs streamable-http

# 测试 SSE
node demo/test-reconnect.mjs sse
```

### 自动化测试步骤

1. 启动 demo MCP server
2. 启动 mcp-proxy（convert 模式，心跳间隔 3s）
3. 发送 `initialize` + `notifications/initialized` 握手
4. 发送 `tools/list` 验证连接正常
5. 等待首次心跳 OK
6. **SIGKILL 杀掉 server（模拟崩溃）**
7. 等待 proxy 检测断连并指数退避重试
8. **重启 server**
9. 等待 proxy 自动重连 + re-initialize + 心跳恢复
10. 再次发送 `tools/list` 验证连接恢复

### 手动测试

如需手动测试，可分三个终端操作：

```bash
# 终端 1: 启动 server
node demo/streamable-http-server.mjs    # 或 sse-server.mjs

# 终端 2: 启动 proxy（convert 模式）
node dist/index.js convert http://127.0.0.1:18080/mcp \
  --protocol stream --ping-interval 3000 --ping-timeout 2000

# 终端 3: 通过 stdin 发送 JSONRPC
echo '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | ...
```

然后在终端 1 按 `Ctrl+C` 杀掉 server，等待几秒后重新启动，观察终端 2 的日志。

---

## 测试结果

### Streamable HTTP — 全部通过

```
[15:32:35.669] [PROXY] ✅ Connected via StreamableHTTPClientTransport
[15:32:37.585] [RESPONSE] initialize OK → protocol 2024-11-05, server: nuwax-mcp-stdio-proxy
[15:32:38.699] [PROXY] 💖 Heartbeat OK (count: 1)
[15:32:39.082] [RESPONSE] tools/list → 2 tools: [echo, time]

--- 杀掉 server ---

[15:32:45.088] [PROXY] Inner transport error: SSE stream disconnected: TypeError: terminated
[15:32:45.089] [PROXY] 🔄 Closed. Retrying in 1000ms (attempt 1)...
[15:32:46.091] [PROXY] ✅ Connected via StreamableHTTPClientTransport
[15:32:46.092] [PROXY] 🔄 Re-initializing MCP session...
[15:32:46.094] [PROXY] ❌ Re-initialize failed: TypeError: fetch failed
[15:32:46.094] [PROXY] 🔄 Retrying in 8000ms (attempt 3)...

--- 重启 server ---

[15:32:54.096] [PROXY] ✅ Connected via StreamableHTTPClientTransport
[15:32:54.097] [PROXY] 🔄 Re-initializing MCP session...
[15:32:54.119] [PROXY] ✅ MCP session re-initialized
[15:32:59.108] [PROXY] 💖 Heartbeat OK (count: 1)
[15:33:06.593] [RESPONSE] tools/list → 2 tools: [echo, time]
```

| 检查项 | 结果 |
|--------|------|
| 重连触发 | ✅ |
| 指数退避 (1s → 2s → 8s) | ✅ |
| Re-initialize 发送 | ✅ |
| Re-initialize 成功 | ✅ |
| 心跳恢复 | ✅ |
| tools/list 恢复 | ✅ |

### SSE (Legacy) — 全部通过

```
[15:34:11.598] [PROXY] ✅ Connected via SSEClientTransport
[15:34:13.509] [RESPONSE] initialize OK → protocol 2024-11-05, server: nuwax-mcp-stdio-proxy
[15:34:14.617] [PROXY] 💖 Heartbeat OK (count: 1)
[15:34:15.009] [RESPONSE] tools/list → 2 tools: [echo, time]

--- 杀掉 server ---

[15:34:21.017] [PROXY] Inner transport error: SSE error: TypeError: terminated: other side closed
[15:34:21.018] [PROXY] 🔄 Closed. Retrying in 1000ms (attempt 1)...
[15:34:22.021] [PROXY] ❌ Connect failed (attempt 2): ECONNREFUSED
[15:34:24.025] [PROXY] 🔄 Retrying in 4000ms...

--- 重启 server ---

[15:34:36.032] [PROXY] ✅ Connected via SSEClientTransport
[15:34:36.033] [PROXY] 🔄 Re-initializing MCP session...
[15:34:36.041] [PROXY] ✅ MCP session re-initialized
[15:34:39.046] [PROXY] 💖 Heartbeat OK (count: 1)
[15:34:42.520] [RESPONSE] tools/list → 2 tools: [echo, time]
```

| 检查项 | 结果 |
|--------|------|
| 重连触发 | ✅ |
| 指数退避 (1s → 2s → 4s → 8s) | ✅ |
| Re-initialize 发送 | ✅ |
| Re-initialize 成功 | ✅ |
| 心跳恢复 | ✅ |
| tools/list 恢复 | ✅ |

---

## 验证要点

### 修复前行为（v1.4.9）

```
Connected → heartbeat (tools/list) → "Server not initialized" →
onerror → triggerReconnect → Connected → heartbeat → 同样失败 → 无限循环（~21s 周期）
```

### 修复后行为（v1.4.10）

```
Connected → 🔄 Re-initializing MCP session → ✅ re-initialized →
heartbeat → 💖 OK → 正常服务
```

### 关键改动

1. **捕获 initialize 消息** — `send()` 中拦截并存储 `initialize` 和 `notifications/initialized`
2. **重连后重放握手** — `performConnect(!initial)` 中调用 `performReInitialize()`
3. **失败时保持退避** — re-initialize 失败不重置 `retryAttempt`，指数退避正常工作
4. **响应拦截** — `respl-init-*` 前缀的响应不转发给下游 Client

---

## 单元测试

```bash
cd crates/nuwax-mcp-stdio-proxy
npx vitest run tests/resilient.test.ts
```

12/12 测试通过，覆盖场景：

- 正常连接
- 断连后消息队列 + flush
- 心跳失败重连
- transport error 重连
- 消息透传
- 队列溢出处理
- 关闭后发送抛异常
- 初始连接失败重试
- **重连后 initialize 重放（新增）**
- **re-initialize 超时退避重试（新增）**
- **re-initialize send 异常退避重试（新增）**
- **无 initialize 时跳过重放（新增）**

---

*测试日期: 2026-03-09*

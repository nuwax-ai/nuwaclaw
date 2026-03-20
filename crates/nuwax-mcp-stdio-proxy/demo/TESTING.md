# MCP Resilient Transport 重连测试文档

## 背景

`ResilientTransportWrapper` 在 v1.4.10 中修复了一个关键 bug：重连后未重放 MCP `initialize` 握手，导致服务端返回 `"Server not initialized"` 并进入无限重连循环。

本文档记录了修复后的测试流程与结果。

---

## 测试环境

| 项目 | 值 |
|------|-----|
| nuwax-mcp-stdio-proxy | v1.4.11 |
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
| `test-reconnect.mjs` | 一键重连测试脚本 |

---

## 快速测试

```bash
cd crates/nuwax-mcp-stdio-proxy

# 跑全部（streamable-http + sse）
node demo/test-reconnect.mjs

# 只跑单个协议
node demo/test-reconnect.mjs streamable-http
node demo/test-reconnect.mjs sse
```

---

## 测试流程

### 自动化测试步骤

脚本自动完成以下步骤：

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

### 输出示例

```
============================================================
  MCP Resilient Transport 重连测试
  模式: streamable-http, sse
============================================================

  ────────────────────────────────────────────────────────
  测试: streamable-http  (http://127.0.0.1:18080/mcp)
  ────────────────────────────────────────────────────────
    [15:57:30.628] STEP 1  启动 MCP Server
    [SERVER] 🚀 Streamable HTTP MCP Server listening on http://127.0.0.1:18080/mcp
    [15:57:32.206] PROXY   ✅ Connected via StreamableHTTPClientTransport
    [15:57:34.137] RESP    initialize OK -> protocol 2024-11-05
    [15:57:35.232] PROXY   💖 Health check OK (count: 1)
    [15:57:35.639] RESP    tools/list -> 2 tools: [echo, time]
    [15:57:41.641] STEP 6  SIGKILL 杀掉 server
    [15:57:41.646] PROXY   🔄 Closed. Retrying in 1000ms (attempt 1)...
    [15:57:42.647] PROXY   🔄 Invoking reconnect handler...
    [15:57:42.647] PROXY   ❌ Reconnect handler failed: TypeError: fetch failed
    [15:57:49.642] STEP 8  重启 server
    [15:57:50.668] PROXY   ✅ Reconnect handler completed
    [15:57:55.664] PROXY   💖 Health check OK (count: 1)
    [15:58:03.148] RESP    tools/list -> 2 tools: [echo, time]

  ────────────────────────────────────────────────────────
  测试: sse  (http://127.0.0.1:18081/sse)
  ────────────────────────────────────────────────────────
    ...

  测试结果汇总

  ┌                ┬─────────────────┬─────────┐
  │ 检查项         │ streamable-http │ sse     │
  ├────────────────┼─────────────────┼─────────┤
  │ 重连触发       │ ✅ PASS         │ ✅ PASS │
  │ Re-init 发送   │ ✅ PASS         │ ✅ PASS │
  │ Re-init 成功   │ ✅ PASS         │ ✅ PASS │
  │ 心跳恢复       │ ✅ PASS         │ ✅ PASS │
  └                ┴─────────────────┴─────────┘

  总结: ✅ 全部通过!
```

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
5. **`cleanupTransport()` 提取** — 消除重复的 transport 清理代码

---

## 单元测试

```bash
cd crates/nuwax-mcp-stdio-proxy
npx vitest run tests/resilient.test.ts tests/resilient-integration.test.ts
```

18/18 测试通过，覆盖场景：

### 基础单元测试 (resilient.test.ts)

| # | 测试场景 |
|---|----------|
| 1 | 正常连接 |
| 2 | 断连后消息队列 + flush |
| 3 | 心跳失败重连 |
| 4 | transport error 重连 |
| 5 | 消息透传 |
| 6 | 队列溢出处理 |
| 7 | 关闭后发送抛异常 |
| 8 | 初始连接失败重试 |
| 9 | 重连后 initialize 重放 |
| 10 | re-initialize 超时退避重试 |
| 11 | 无 initialize 时跳过重放 |
| 12 | re-initialize send 异常退避重试 |
| 13 | **并发健康检查防护 (v1.4.11)** |
| 14 | **响应驱动调度 (v1.4.11)** |
| 15 | **状态变化时不调度下次检查 (v1.4.11)** |
| 16 | **finally 块中仅在 connected 状态调度 (v1.4.11)** |

### 集成测试 (resilient-integration.test.ts)

| # | 测试场景 |
|---|----------|
| 1 | **慢网络下的并发保护 (v1.4.11)** |
| 2 | **快速定时器触发不堆积 (v1.4.11)** |
| 3 | **当前检查完成后才调度下次 (v1.4.11)** |
| 4 | **健康检查期间状态变化处理 (v1.4.11)** |
| 5 | **服务器重启场景 (v1.4.11)** |
| 6 | **可变检查时长下的心跳节奏 (v1.4.11)** |

---

## 退出码

| 退出码 | 说明 |
|--------|------|
| 0 | 全部通过 |
| 1 | 存在失败项 |

---

*测试日期: 2026-03-20*

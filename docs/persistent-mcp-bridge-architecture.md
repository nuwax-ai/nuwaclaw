# 持久化 MCP Server Bridge 架构设计

## 背景与问题

### 原有方案

`nuwax-mcp-stdio-proxy` 作为 MCP 聚合代理，由 ACP 引擎在每个 session 启动时 spawn，聚合所有用户配置的 MCP server 到一个 stdio endpoint。

```
ACP Session
└── nuwax-mcp-stdio-proxy (stdio)
    ├── chrome-devtools-mcp (子进程)
    ├── filesystem-mcp (子进程)
    └── ...
```

**核心问题**：proxy 进程的生命周期与 ACP session 绑定 — session 结束 → proxy 进程退出 → 所有 MCP server 子进程被 kill。

对于 chrome-devtools-mcp 这类有状态（stateful）的 MCP server：

| 问题 | 说明 |
|------|------|
| 状态丢失 | 每次 session 启动都 spawn 新 chrome-devtools-mcp → 启动新 Chrome → 之前的浏览器状态（页面、登录态、DOM 修改）全部丢失 |
| `--isolated` 模式 | 避免 Chrome profile 冲突，但每次都是全新浏览器，无法跨 session 连续操作 |
| 非 `--isolated` 模式 | Chrome profile 锁冲突："browser already running"，因为上一个 Chrome 可能还没完全退出 |

### 设计目标

将需要持久化状态的 MCP server 的生命周期从 ACP session 中解耦，由 Electron 主进程管理。

---

## 新方案：双通道架构

### 概览

引入 `persistent` 标志位，将 MCP server 分为两类，走不同的通道：

| 类型 | 标志 | 生命周期 | 通道 |
|------|------|---------|------|
| **临时 server**（ephemeral） | `persistent: false`（默认） | 跟随 ACP session | nuwax-mcp-stdio-proxy 聚合（不变） |
| **持久化 server**（persistent） | `persistent: true` | 跟随 Electron 主进程 | PersistentMcpBridge HTTP → mcp-bridge-client stdio |

### 架构图

```
Electron Main Process（长生命周期）
│
├── PersistentMcpBridge（新组件，单例）
│   │
│   ├── 持久化子进程: chrome-devtools-mcp（stdio，主进程 spawn）
│   │   └── MCP Client ← StdioClientTransport → 子进程 stdin/stdout
│   │
│   ├── HTTP Server（127.0.0.1，自动分配端口）
│   │   └── 路由: POST/GET/DELETE /mcp/<serverId>
│   │       └── 每个 HTTP client session → Server + StreamableHTTPServerTransport
│   │           └── 代理 tools/list, tools/call → 共享的 MCP Client
│   │
│   └── 自动重启 + 健康检查 + session 清理
│
└── McpProxyManager.getAgentMcpConfig()
    │
    ├── 持久化 server → mcp-bridge（mcp-bridge-client.mjs stdio 入口）
    └── 临时 server → mcp-proxy（nuwax-mcp-stdio-proxy 聚合，不变）

Per ACP Session（短生命周期）
│
├── nuwax-mcp-stdio-proxy（聚合临时 MCP servers，不变）
│   ├── filesystem-mcp（子进程）
│   └── ...（用户自定义临时 server）
│
└── mcp-bridge-client.mjs（连接持久化 bridge）
    └── StreamableHTTPClientTransport → Electron HTTP Bridge
        └── 聚合持久化 server 的 tools 为 stdio endpoint
```

### 数据流

```
Agent 引擎（claude-code / nuwaxcode）
  │
  ├── mcp_servers.mcp-proxy (stdio)      ← 临时 server 聚合
  │   └── nuwax-mcp-stdio-proxy
  │       └── [临时 MCP server 子进程群]
  │
  └── mcp_servers.mcp-bridge (stdio)     ← 持久化 server 桥接
      └── mcp-bridge-client.mjs
          └── StreamableHTTPClientTransport
              └── HTTP POST /mcp/<serverId>
                  └── Electron PersistentMcpBridge
                      └── MCP Client (StdioClientTransport)
                          └── chrome-devtools-mcp (持久化子进程)
```

---

## 核心组件

### 1. McpServerEntry — 配置类型

```typescript
interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
  persistent?: boolean;  // 标记为持久化 server
}
```

`persistent: true` 的 server 由 PersistentMcpBridge 管理，不再传给 nuwax-mcp-stdio-proxy。

### 2. PersistentMcpBridge — 主进程 HTTP Bridge

**文件**: `src/main/services/packages/persistentMcpBridge.ts`

**职责**：
- 管理持久化 MCP server 子进程的完整生命周期
- 提供 HTTP bridge 供 ACP session 的 bridge client 连接
- 工具列表缓存、子进程自动重启、session 清理

**关键设计**：

| 设计点 | 方案 |
|--------|------|
| 子进程管理 | MCP SDK `StdioClientTransport` 内部 spawn，通过 `Client.connect()` 启动 |
| HTTP 协议 | MCP SDK `StreamableHTTPServerTransport`（非 SSE，StreamableHTTP 是最新标准） |
| 端口分配 | `server.listen(0, '127.0.0.1')` 系统自动分配，仅监听 loopback |
| 路径路由 | 单端口，`/mcp/<serverId>` 路由到对应 server |
| Session 模型 | 每个 HTTP client session 独立的 `Server` + `StreamableHTTPServerTransport` 对，共享底层 `Client` |
| 并发安全 | MCP SDK `Client.callTool()` 内部使用 JSON-RPC 请求 ID 做响应关联，天然支持并发 |
| 自动重启 | 子进程退出 → 5 秒冷却 → 自动重新 spawn + connect |
| 安全防护 | HTTP body 10MB 限制、stale session 60 秒定期清理、进程 force-kill 兜底 |

**API**：

```typescript
class PersistentMcpBridge {
  start(servers: Record<string, McpServerEntry>): Promise<void>;  // 启动 bridge
  stop(): Promise<void>;                                           // 停止 bridge
  getBridgeUrl(serverId: string): string | null;                   // 获取 HTTP URL
  isRunning(): boolean;                                             // 是否在运行
  isServerHealthy(serverId: string): boolean;                       // server 健康检查
}

export const persistentMcpBridge: PersistentMcpBridge;  // 单例
```

### 3. mcp-bridge-client.mjs — Per-Session Stdio Bridge

**文件**: `resources/mcp-bridge-client.mjs`

**职责**：ACP 引擎每个 session spawn 一个实例，连接 PersistentMcpBridge 的 HTTP endpoint，聚合持久化 server 的 tools 暴露为 stdio MCP endpoint。

**运行方式**：
```bash
# Electron 内置 Node.js 运行 ESM 脚本
process.execPath mcp-bridge-client.mjs '{"chrome-devtools":"http://127.0.0.1:PORT/mcp/chrome-devtools"}'

# 环境变量:
#   ELECTRON_RUN_AS_NODE=1    — 让 Electron 作为 Node.js 运行
#   NODE_PATH=~/.nuwax-agent/node_modules  — 解析 @modelcontextprotocol/sdk
```

**协议桥接**：
```
父进程 (ACP 引擎)
  ↕ stdio (stdin/stdout, MCP JSON-RPC)
mcp-bridge-client.mjs
  ↕ StreamableHTTPClientTransport (HTTP)
PersistentMcpBridge HTTP Server
```

**ESM 格式**（`.mjs`）原因：`@modelcontextprotocol/sdk` 的 ESM 导出使用 `.js` 后缀的子路径（如 `@modelcontextprotocol/sdk/client/index.js`），在 ESM 模式下可直接使用 package.json `exports` 解析。

### 4. McpProxyManager — 配置分发

**文件**: `src/main/services/packages/mcp.ts`

`getAgentMcpConfig()` 方法负责将配置分发到两个通道：

```typescript
getAgentMcpConfig() {
  // 1. 分离 ephemeral vs persistent
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.persistent) persistent[name] = entry;
    else ephemeral[name] = entry;
  }

  // 2. 临时 server → mcp-proxy key (nuwax-mcp-stdio-proxy 聚合)
  if (ephemeral.length > 0 && proxyScript) {
    result['mcp-proxy'] = {
      command: process.execPath,
      args: [proxyScript, '--config', JSON.stringify(resolvedConfig)],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  // 3. 持久化 server → mcp-bridge key (bridge client → HTTP)
  if (persistent.length > 0 && bridge.isRunning()) {
    result['mcp-bridge'] = {
      command: process.execPath,
      args: [bridgeClientScript, JSON.stringify(bridgeUrls)],
      env: { ELECTRON_RUN_AS_NODE: '1', NODE_PATH: appNodeModules },
    };
  }

  return result;
}
```

Agent 引擎收到的 MCP 配置结构：
```json
{
  "mcp-proxy": {
    "command": "/path/to/electron",
    "args": ["/path/to/nuwax-mcp-stdio-proxy/index.js", "--config", "{...临时servers...}"],
    "env": { "ELECTRON_RUN_AS_NODE": "1" }
  },
  "mcp-bridge": {
    "command": "/path/to/electron",
    "args": ["/path/to/mcp-bridge-client.mjs", "{\"chrome-devtools\":\"http://127.0.0.1:PORT/mcp/chrome-devtools\"}"],
    "env": { "ELECTRON_RUN_AS_NODE": "1", "NODE_PATH": "~/.nuwax-agent/node_modules" }
  }
}
```

---

## 生命周期管理

### 启动流程

```
app.whenReady() → runStartupTasks()
  └── mcpProxyManager.start()
      ├── 验证 nuwax-mcp-stdio-proxy 已安装（缓存脚本路径）
      └── persistentMcpBridge.start(persistentServers)
          ├── 为每个 persistent server 创建 StdioClientTransport + Client
          ├── Client.connect() → spawn 子进程 → MCP initialize
          ├── Client.listTools() → 缓存 tool 列表
          └── 启动 HTTP server（自动端口） + session 清理定时器
```

### ACP Session 流程

```
agentService.init() → getAgentMcpConfig()
  ├── mcp-proxy: ACP 引擎 spawn nuwax-mcp-stdio-proxy（临时 servers）
  └── mcp-bridge: ACP 引擎 spawn mcp-bridge-client.mjs
      └── connectAll() → HTTP connect 到 PersistentMcpBridge
          └── 聚合 tools → stdio 暴露给 ACP 引擎

Session 结束:
  ├── mcp-proxy 进程退出 → 临时 MCP server 子进程全部退出 ✓
  └── mcp-bridge-client.mjs 退出 → HTTP 连接关闭
      └── 持久化 MCP server 子进程继续运行 ✓ (关键!)
```

### 停止/退出流程

```
app 退出 / services:stopAll
  └── mcpProxyManager.cleanup() / mcpProxyManager.stop()
      └── persistentMcpBridge.stop()
          ├── 清理 session cleanup 定时器
          ├── 关闭所有 HTTP session transport
          ├── 关闭 HTTP server
          └── 逐个停止持久化 server:
              ├── Client.close()
              ├── transport.close() → 子进程终止
              └── 兜底: process.kill(pid, SIGTERM/SIGKILL)
```

### 子进程自动重启

```
子进程异常退出 → transport.onclose 触发
  └── scheduleRestart(5秒冷却)
      └── 清理旧 client/transport → spawnAndConnect()
          └── 新 StdioClientTransport + Client → listTools()
```

---

## 配置

### 默认配置

```typescript
const DEFAULT_MCP_PROXY_CONFIG = {
  mcpServers: {
    'chrome-devtools': {
      command: 'chrome-devtools-mcp',
      args: [],
      persistent: true,     // 持久化: 由 PersistentMcpBridge 管理
    },
  },
};
```

### 用户自定义 Server

通过 UI（MCPSettings 组件）添加的 server 默认为临时（ephemeral），走 nuwax-mcp-stdio-proxy 聚合。

需要持久化的 server 需在配置中设置 `persistent: true`。

---

## 依赖

| 依赖 | 用途 | 位置 |
|------|------|------|
| `@modelcontextprotocol/sdk` | MCP Client/Server/Transport 实现 | `package.json` devDependencies |
| `nuwax-mcp-stdio-proxy` | 临时 server 聚合代理（不变） | `~/.nuwax-agent/node_modules/` |
| `mcp-bridge-client.mjs` | 持久化 bridge 客户端脚本 | `resources/`（打包进 extraResources） |

### TypeScript 兼容性

MCP SDK 使用 package.json `exports` 字段的子路径导出，但项目 `tsconfig.main.json` 的 `moduleResolution: "node"` 不支持。

解决方案：`src/shared/types/mcp-sdk.d.ts` 提供 ambient module 声明，为以下子路径提供类型：
- `@modelcontextprotocol/sdk/client`
- `@modelcontextprotocol/sdk/server`
- `@modelcontextprotocol/sdk/client/stdio.js`
- `@modelcontextprotocol/sdk/server/streamableHttp.js`
- `@modelcontextprotocol/sdk/server/stdio.js`
- `@modelcontextprotocol/sdk/client/streamableHttp.js`
- `@modelcontextprotocol/sdk/types.js`

---

## 文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/main/services/packages/persistentMcpBridge.ts` | 新建 | 核心 bridge 服务 |
| `resources/mcp-bridge-client.mjs` | 新建 | stdio↔HTTP 桥接客户端（ESM） |
| `src/shared/types/mcp-sdk.d.ts` | 新建 | MCP SDK 子路径类型声明 |
| `src/main/services/packages/mcp.ts` | 修改 | 双通道分发逻辑 |
| `src/main/services/packages/mcp.test.ts` | 修改 | 新增持久化相关测试 |
| `src/main/main.ts` | 小改 | cleanup 流程说明 |
| `src/main/ipc/processHandlers.ts` | 小改 | stopAll/restartAll 说明 |
| `package.json` | 修改 | SDK 依赖 + extraResources |

---

## 验证

1. `npm run build` → TypeScript 编译通过
2. `npm run test` → 所有测试通过（含新增的 persistent bridge 测试用例）
3. `npm run electron:dev` → 开发模式验证:
   - PersistentMcpBridge 启动 → chrome-devtools-mcp 成功 spawn → 28 tools 就绪
   - HTTP bridge 监听自动分配端口（如 57278）
   - ACP session 收到 `mcp-proxy` + `mcp-bridge` 双通道配置
   - bridge client 连接 HTTP endpoint → tools 正常列出和调用
4. 多 session 测试 → 同一 Chrome 实例跨 session 持续可用
5. 应用退出 → 无残留进程

---

*Last updated: 2026-02-27*

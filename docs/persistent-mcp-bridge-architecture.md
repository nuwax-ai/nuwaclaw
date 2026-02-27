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
| **持久化 server**（persistent） | `persistent: true` | 跟随 Electron 主进程 | PersistentMcpBridge HTTP ← nuwax-mcp-stdio-proxy bridge 入口（{ url }） |

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
    └── 单一 mcp-proxy：nuwax-mcp-stdio-proxy --config '{ mcpServers: { stdio... | url... } }'
        ├── 临时 server → { command, args, env }（stdio 子进程）
        └── 持久化 server → { url }（bridge，StreamableHTTP → PersistentMcpBridge）

Per ACP Session（短生命周期）
│
└── nuwax-mcp-stdio-proxy（单一进程，混合 stdio + bridge）
    ├── 临时 server：stdio 子进程
    └── 持久化 server：StreamableHTTPClientTransport → PersistentMcpBridge HTTP
```

### 数据流

```
Agent 引擎（claude-code / nuwaxcode）
  │
  └── mcp_servers.mcp-proxy (stdio)      ← 单一入口
      └── nuwax-mcp-stdio-proxy --config '{ mcpServers: {...} }'
          ├── stdio 条目 → 子进程（临时 server）
          └── bridge 条目 { url } → StreamableHTTPClientTransport
              └── HTTP POST /mcp/<serverId> → Electron PersistentMcpBridge
                  └── MCP Client (StdioClientTransport) → chrome-devtools-mcp（持久化子进程）
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

### 3. Bridge 入口（已并入 nuwax-mcp-stdio-proxy）

持久化 server 的桥接不再使用独立脚本，由 **nuwax-mcp-stdio-proxy** 的 `--config` 中 `{ url }` 条目完成：

- **stdio 条目**：`{ command, args, env }` → proxy 内部 spawn 子进程（临时 server）
- **bridge 条目**：`{ url: "http://127.0.0.1:PORT/mcp/<serverId>" }` → proxy 内部用 `StreamableHTTPClientTransport` 连接 PersistentMcpBridge

协议桥接：
```
Agent 引擎 (stdio)
  ↕
nuwax-mcp-stdio-proxy（单一进程）
  ├── stdio 上游 → 子进程
  └── bridge 上游 → StreamableHTTPClientTransport → PersistentMcpBridge HTTP
```

### 4. McpProxyManager — 配置分发

**文件**: `src/main/services/packages/mcp.ts`

`getAgentMcpConfig()` 构建**单一** mcp-proxy 配置，临时与持久化 server 均写入同一份 `mcpServers`：

```typescript
getAgentMcpConfig() {
  const proxyServers = {};
  // 临时 server → { command, args, env }
  for (const [name, entry] of ephemeral) {
    proxyServers[name] = resolveServersConfig({ [name]: entry })[name];
  }
  // 持久化 server → { url: persistentMcpBridge.getBridgeUrl(name) }
  if (persistentMcpBridge.isRunning()) {
    for (const [name, entry] of persistent) {
      const url = persistentMcpBridge.getBridgeUrl(name);
      if (url) proxyServers[name] = { url };
    }
  }
  return {
    'mcp-proxy': {
      command: process.execPath,
      args: [proxyScript, '--config', JSON.stringify({ mcpServers: proxyServers })],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
  };
}
```

Agent 引擎收到的 MCP 配置（仅一个 key）：
```json
{
  "mcp-proxy": {
    "command": "/path/to/electron",
    "args": ["/path/to/nuwax-mcp-stdio-proxy", "--config", "{\"mcpServers\":{\"filesystem\":{\"command\":\"npx\",\"args\":[\"...\"]},\"chrome-devtools\":{\"url\":\"http://127.0.0.1:PORT/mcp/chrome-devtools\"}}}"],
    "env": { "ELECTRON_RUN_AS_NODE": "1" }
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
  └── mcp-proxy: ACP 引擎 spawn 单一 nuwax-mcp-stdio-proxy
      ├── stdio 上游 → 临时 server 子进程
      └── bridge 上游 → HTTP 连接 PersistentMcpBridge（持久化 server）

Session 结束:
  └── nuwax-mcp-stdio-proxy 进程退出
      ├── 临时 server 子进程全部退出 ✓
      └── bridge HTTP 连接关闭，持久化 MCP server 子进程继续运行 ✓ (关键!)
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
| `nuwax-mcp-stdio-proxy` | 临时 + 持久化 聚合（stdio + bridge 入口） | 应用依赖 + `~/.nuwax-agent/node_modules/` |

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
| `src/main/services/packages/mcp.ts` | 修改 | 统一 mcp-proxy 配置（stdio + bridge 合并进一份 config） |
| `src/shared/types/mcp-sdk.d.ts` | 新建 | MCP SDK 子路径类型声明 |
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
   - ACP session 收到单一 `mcp-proxy` 配置（config 内含 stdio + bridge 条目）
   - nuwax-mcp-stdio-proxy 内 bridge 连接 PersistentMcpBridge HTTP → tools 正常列出和调用
4. 多 session 测试 → 同一 Chrome 实例跨 session 持续可用
5. 应用退出 → 无残留进程

---

*Last updated: 2026-02-27*

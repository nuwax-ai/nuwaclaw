# nuwax-mcp-stdio-proxy

一个纯 TypeScript 编写的 MCP (Model Context Protocol) 代理工具，为 MCP Server 提供高级聚合、协议转换以及生命周期管理功能。

它的设计初衷，是为了解决将 MCP Server 集成到大型应用或 Agent OS 平台时遇到的“启动时序竞争”及“应用退出后产生僵尸进程”等痛点问题。

## 环境要求

- **Node.js** >= 22.0.0

## 运行模式

该代理工具具备三种截然不同的工作模式：

### 1. Stdio 聚合模式 (默认)

将多个基于不同协议上游 MCP Server 聚合成单个面向下游的 `stdio` 节点。

```bash
nuwax-mcp-stdio-proxy --config '{"mcpServers":{...}}'
```

配置中可以混合配置 `stdio` (子进程) 和 `bridge` (HTTP 连接) 类型的上游服务器。代理会统一将它们聚合并向客户端暴露唯一的一个 `stdio` MCP 交互接口。

### 2. 协议转换模式 (`convert`)

将单个远程的 SSE 或 Streamable HTTP MCP Server 代理转化为本地的 `stdio` MCP Server。适用于仅支持 `stdio` 接入的客户端应用。

```bash
nuwax-mcp-stdio-proxy convert http://example.com/mcp/sse --protocol sse
```

### 3. 持久化 HTTP 桥接模式 (`proxy`)

作为 Streamable HTTP Server 启动 `PersistentMcpBridge`。该模式会预先构建并管理标准的 `stdio` 子进程，进而将它们通过高速、可秒连的 HTTP 接口暴露给下游使用。

```bash
nuwax-mcp-stdio-proxy proxy --port 18099 --config '{"mcpServers":{...}}'
```

## 配置文件格式

在使用默认聚合模式或 `proxy` 模式时，使用如下结构的 JSON 配置：

| 节点类型   | 配置结构                                                                   | 描述                                                                    |
| ---------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **stdio**  | `{ "command": string, "args"?: string[], "env"?: Record<string, string> }` | 创建子进程；通过 stdio 进行 MCP 通信。                                  |
| **bridge** | `{ "url": string }`                                                        | 通过 HTTP 建立 MCP 连接 (例如 `http://127.0.0.1:PORT/mcp/<serverId>`)。 |

**配置示例：**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed"
      ]
    },
    "chrome-devtools": {
      "url": "http://127.0.0.1:57278/mcp/chrome-devtools"
    }
  }
}
```

## 架构简图

```
Agent / ACP 引擎客户端 (stdin/stdout)
        ↕
  nuwax-mcp-stdio-proxy (Stdio 模式)
        ├→ [stdio 上游]  → Spawn 启动子进程 (StdioClientTransport)
        └→ [bridge 上游] → StreamableHTTPClientTransport → 连接 PersistentMcpBridge HTTP
```

通过引入 `proxy` 模式开启 `PersistentMcpBridge`，上层的应用可以剥离 MCP Server 的原本子进程生命周期，从而避免启动初期的时序竞争条件，同时能够更加可靠、整洁地在退出时销毁无用进程。

## 开发指令

| 指令                    | 描述                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `npm run build`         | 编译 TypeScript 输出到 `dist/` 目录。                        |
| `npm run test`          | 运行测试 (Vitest)。                                          |
| `npm run test:run`      | 单次运行所有的单元与集成测试 (无监控交互)。                  |
| `npm run test:coverage` | 运行测试并生成详细的覆盖率统计报告 (存于 `coverage/` 目录)。 |

## 许可证

MIT

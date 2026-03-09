# nuwax-mcp-stdio-proxy (Agent 开发文档)

## 概述

`nuwax-mcp-stdio-proxy` 是一个基于 TypeScript 编写的 MCP (Model Context Protocol) 代理程序。它主要用于解决在复杂环境（例如 Electron 应用或统一的 Agent OS 平台）中集成多个 MCP Server 时遇到的生命周期管理、启动时序以及僵尸进程等关键问题。

## 核心架构与运行模式

代理程序提供三种主要的运行模式，均可通过 CLI 命令行启动：

1. **stdio (默认聚合模式)**
   - **用途**：将多个上游的 MCP Server (可以是标准的基于子进程的 `stdio` 服务器，也可以是基于 HTTP 的 `bridge` 服务器) 汇聚成**单个**对下游暴露的 `stdio` MCP 接口。
   - **用法**：`nuwax-mcp-stdio-proxy --config '{"mcpServers":{...}}'`
   - **数据流**：Agent (stdin/stdout) ↔ 代理 ↔ [上游 1 (stdio), 上游 2 (HTTP Bridge), ...]

2. **convert (协议转换模式)**
   - **用途**：连接到单个远程的 MCP 服务（通过 SSE 或 Streamable HTTP），并将其在本地作为标准的 `stdio` MCP 服务器暴露。
   - **用法**：`nuwax-mcp-stdio-proxy convert http://remote-mcp-server/sse`

3. **proxy (持久化桥接模式, PersistentMcpBridge)**
   - **用途**：作为 Streamable HTTP Server 启动 `PersistentMcpBridge`。该模式会预先启动多个基于子进程的 MCP Server，并通过本地 HTTP 将它们暴露出来供下游连接。
   - **用法**：`nuwax-mcp-stdio-proxy proxy --port 18099 --config '{"mcpServers":{...}}'`

## 解决的核心痛点：就绪状态与生命周期

根据 `fix-mcp-readiness-and-cleanup.md` 中的记录，如果 Agent 引擎直接使用原生的 `stdio` 子进程来启动 MCP Server，会遇到两个重大问题：

1. **首次对话的时序竞争（Timing Race）**：标准 `stdio` MCP 进程的启动、初始化及连接需要时间。如果在启动 MCP 进程后立刻发送 Prompt 给 Agent 引擎，工具列表可能还未加载完毕，导致 Agent 认为没有合适的工具可用。
2. **退出时的僵尸进程问题**：在跨平台环境（如 Electron 应用的 Teardown 阶段）中，快速、可靠地清理所有子进程非常困难。

### `PersistentMcpBridge` 解决方案

`proxy` 模式和 `PersistentMcpBridge` 类的引入，将 MCP Server 的生命周期与即时的 Agent 对话会话（Session）解耦，从而彻底解决了上述问题：

1. **预热与阻塞启动**：Bridge 会预先 Spawn 所有配置的 MCP Server 子进程，并**阻塞等待**它们通过 `listTools()` 就绪检查。
2. **HTTP 协议转换**：一旦就绪，它们将通过 Streamable HTTP 暴露 (例如 `http://127.0.0.1:<PORT>/mcp/<serverId>`)。
3. **秒级连接**：当下游的 Agent 引擎开启新的对话会话时，只需通过 HTTP URL 进行连接。由于 Bridge 早已运行并且缓存了工具列表，此连接过程是**瞬间完成**的，完全消除了时序竞争。
4. **集中式的退出清理**：Bridge 采用优雅终止（Graceful Termination）逻辑来统一编排并管理所有子进程的关闭，有效避免遗留孤儿进程。同时它还能追踪 HTTP 会话，自动清理失效连接。

## 关键文件导读

- `src/index.ts`: CLI 入口点、参数解析及模式路由逻辑。
- `src/bridge.ts`: `PersistentMcpBridge` 的具体实现代码。
- `src/customStdio.ts`: 自定义的 StdioClientTransport 实现，具备更健壮的子进程管理能力及降级处理（这对 Windows 环境下的进程终止尤为重要）。
- `src/modes/`: 包含 `stdio`, `convert` 和 `proxy` 三种模式的具体实现逻辑。

## 如何修改与扩展

- 若要添加新的 CLI 选项，请更新 `src/index.ts` 以及位于 `src/modes/` 下对应的模式文件。
- 若需修改 Bridge 的 HTTP 路由策略或 Session 处理逻辑，请参考 `src/bridge.ts` 中的 `handleHttpRequest` 方法。

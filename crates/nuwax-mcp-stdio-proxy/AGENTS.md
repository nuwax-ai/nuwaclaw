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
- `src/logger.ts`: 统一日志模块，同时输出到 stderr 和可选的日志文件。
- `src/resilient.ts`: `ResilientTransportWrapper`，为 URL-based MCP Server 提供心跳监测、指数退避重连和请求队列。

## 日志系统 (logger.ts)

所有日志通过 `logger.ts` 统一输出，stdout 保留给 MCP JSON-RPC 通信。

### 输出通道

| 通道 | 说明 |
|------|------|
| **stderr** | 始终输出，Agent 引擎可捕获 |
| **日志文件** | 通过环境变量 `MCP_PROXY_LOG_FILE` 启用，append 模式写入 |

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `MCP_PROXY_LOG_FILE` | 日志文件路径，设置后日志同时写入该文件 | `~/.nuwaxbot/logs/mcp-proxy.log` |

### 日志格式

```
[2026-03-09 19:29:37.650] [info]  [nuwax-mcp-proxy] Proxy server running on stdio
```

与 electron-log 格式一致：`[时间戳] [级别]  [标签] 消息`

### Electron 集成

Electron 宿主无法直接捕获 proxy 的 stderr（proxy 由 ACP 引擎 spawn，是 ACP 的子进程）。
集成方式：Electron 在 proxy 环境变量中设置 `MCP_PROXY_LOG_FILE`，然后通过 `fs.watchFile` tail 读取日志文件，逐行转发到 `electron-log`，最终出现在 `~/.nuwaxbot/logs/main.log`。

## 弹性传输层 (ResilientTransportWrapper)

`src/resilient.ts` 为 URL-based MCP Server（SSE / Streamable HTTP）提供连接弹性保障。

### 核心参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `pingIntervalMs` | 30000 | 心跳检测间隔 (ms)，响应驱动调度 |
| `maxConsecutiveFailures` | 3 | 连续失败次数阈值，达到后触发重连 |
| `pingTimeoutMs` | 5000 | 单次心跳超时 (ms) |
| `reconnectDelayMs` | 1000 | 退避基础延迟 (ms) |
| `maxReconnectDelayMs` | 60000 | 退避延迟上限 (ms) |
| `maxQueueSize` | 100 | 重连期间请求队列最大容量 |

### 心跳机制

- **响应驱动调度**: 使用 `setTimeout` 替代 `setInterval`，上一次心跳检查完成后才开始计时下一次，避免网络慢时请求堆积。
- **并发保护**: `healthCheckInProgress` 标志位防止多个心跳检查同时执行。
- **轻量级检查**: SSE/HTTP 连接依赖 transport 层的 `onclose`/`onerror` 回调监控连接健康状态，不再使用 `client.listTools()` 避免创建额外的 HTTP 连接。
- **心跳间隔**: 默认 30 秒（从 20 秒增加），减少不必要的检查频率。

### 重连触发机制

**两种触发路径：**

| 触发源 | 延迟 | 说明 |
|--------|------|------|
| Transport `onclose`/`onerror` | **立即** | SSE 断开、网络错误等，立即触发重连 |
| 心跳健康检查失败 | 连续 3 次 | 仅在使用 `healthCheckFn` 时生效（stdio 传输） |

**SSE/HTTP 传输**：由于不使用 `healthCheckFn`，心跳检查只是轻量级存活性验证（检查 `activeTransport !== null`），实际重连由 transport 层的 `onclose`/`onerror` 回调**立即触发**。

### 重连策略

- **指数退避**: `1s → 2s → 4s → 8s → 16s → 32s → 60s`（capped），与 Rust mcp-proxy 的 `CappedExponentialBackoff` 一致
- **不限重试**: 初次连接和 heartbeat 触发的重连均不限次数
- **成功重置**: 连接成功后 `retryAttempt` 重置为 0，退避延迟回归 1s

### 重连流程

```
初次连接 / Heartbeat 失败 ×3
    ↓
关闭当前 transport（清理 handler、停止 heartbeat）
    ↓
指数退避等待（1s → 2s → ... → 60s）
    ↓
performConnect() 创建新 transport
    ├── 成功 → state='connected'，重置 retryAttempt=0，恢复 heartbeat
    └── 失败 → 继续退避重试（不限次数）
```

### 状态机

```
idle → connecting → connected ←→ reconnecting
                        ↓
                     closed（永久停止）
```

## 如何修改与扩展

- 若要添加新的 CLI 选项，请更新 `src/index.ts` 以及位于 `src/modes/` 下对应的模式文件。
- 若需修改 Bridge 的 HTTP 路由策略或 Session 处理逻辑，请参考 `src/bridge.ts` 中的 `handleHttpRequest` 方法。

## 测试与质量保障

项目使用 Vitest 作为主要的测试框架。测试文件位于 `tests/` 目录中，主要覆盖组件的功能完整性、集成逻辑及内部封装（如 `ResilientTransportWrapper` 心跳检测和连接重试）。

运行相关指令获取覆盖率等指标：

- `npm run test`：以 Watch 模式启动测试监听。
- `npm run test:run`：单次运行所有测试用例。
- `npm run test:coverage`：运行所有测试用例并生成 v8 代码行级和分支覆盖率报告，输出结果将存在于根目录下的 `coverage/` 文件夹中。

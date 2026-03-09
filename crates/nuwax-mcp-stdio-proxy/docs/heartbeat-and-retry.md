# 心跳与重试机制设计 (nuwax-mcp-stdio-proxy)

## 1. 背景与问题

目前 `nuwax-mcp-stdio-proxy` 缺乏针对其传输层（特别是 `sse` 和 `streamable` 远程连接）的健壮的心跳（Keep-Alive）和透明重试机制。如果后端的 MCP 服务器崩溃或网络断开，依赖代理的下游 Agent 会遇到 `stdio` 管道断裂或请求挂起的问题。

我们需要一个具有弹性的代理层：

1. 主动监控上游连接的健康状况（使用 Ping 等请求）。
2. 如果连接断开，透明地重连并重新映射传输层。
3. 对下游的 Agent（仅通过标准 stdio 通信）屏蔽这些临时故障，有效创建一个“永远在线”的代理抽象。

## 2. 核心功能与要求

### 2.1 心跳 (Keep-Alive)

- **间隔**: 默认 20 秒 (`--ping-interval`)。
- **超时**: 默认 5 秒 (`--ping-timeout`)。
- **方式**: 发送 MCP 的 JSON-RPC `ping` 请求进行健康检查。
- **失败阈值**: 连续 3 次健康检查失败。

### 2.2 重连与重试逻辑

- 当连接被认定为不健康（连续 3 次失败或传输层触发 `onclose`/`onerror`）时：
  1. 状态变更为 `RECONNECTING` (重连中)。在重连期间到达的 MCP 请求会进入内部队列进行缓冲，代理本身**绝不能崩溃**。
  2. 代理启动对上游服务的重连（重新 spawn 标准子进程，或重新建立 SSE/Streamable HTTP 连接）。
  3. 重连成功后，代理将把内部的 `Transport` 重新映射到新的连接，并自动刷出之前排队的请求。
  4. 下游 Agent 与代理之间的 `stdio` 连接在整个过程中保持完好无损。

## 3. 架构设计

### 3.1 弹性代理传输层 (ResilientTransportWrapper)

我们使用 `ResilientTransportWrapper` 将底层的连接进行封装。这个 Wrapper 向上层环境暴露标准稳定的 `Transport` 接口，但内部动态管理和更替实际的 SSE/Streamable/Stdio 传输实例。

```typescript
class ResilientTransportWrapper implements Transport {
  // 实现 MCP Transport 接口
  // 内部管理实际的连接 (activeTransport)
  // 包含断开重连逻辑、心跳检测机制和消息排队发送队列
}
```

### 3.2 内部实现细节

1. **连接建立**: 初始化时通过外部传入的 `connectParams` 工厂函数创建底层的 Transport 连接。
2. **心跳定时器**: 每隔固定时间（例如 20 秒），向 `activeTransport` 发送原生的 JSON-RPC `ping` 请求。如果在发送期间抛错或传输直接断开，则累加连续失败计数。
3. **断开拦截**: 拦截 `activeTransport` 的 `onclose` 和 `onerror` 事件，并触发内部重连，防止其向上冒泡直接中止下游的 stdio 代理进程。
4. **请求排队**: 当正处于重连状态时，由于暂时没有可用的底层发送通道，通过外层 `send(message)` 收到的任何请求都会进入一个有容量限制（默认 100）的队列中。新的底层连接建立成功后，会迅速重放（flush）发送队列的所有请求。
5. **多模式支持**: 这个逻辑被集中继承到了 `modes/convert.ts` (独立服务转换模式) 及 `bridge.ts` (`PersistentMcpBridge` 持久化管理桥接) 内部，以实现对不同形式请求的通用重连保护。

## 4. 命令行及参数配置

新增了控制心跳频次的参数选项支持，可以通过启动命令或在配置文件内声明：

- `--ping-interval <毫秒>`: 发送心跳 Ping 的时间间隔（如果不指定，默认为 20000 即 20 秒）。
- `--ping-timeout <毫秒>`: 心跳请求超时判断（如果不指定，默认为 5000 即 5 秒）。

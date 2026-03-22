# 更新日志 (Changelog)

本项目的所有显著更改都将记录在此文件中。

## [1.4.11] - 2026-03-20

### 修复 (Fixed)

- **心跳并发问题修复**: 解决了 `ResilientTransportWrapper` 中多个心跳检查同时执行的并发问题，该问题会导致创建多个 SSE/HTTP 连接。
  - 添加 `healthCheckInProgress` 标志位防止并发执行
  - `finally` 块中显式检查 `state === 'connected'` 后才调度下一次检查
  - 修复 `heartbeatTimer` 类型定义（`setInterval` → `setTimeout`）

### 改进 (Changed)

- **响应驱动心跳机制**: 将固定间隔 `setInterval` 改为响应驱动的 `setTimeout` 调度。上一次心跳检查完成后才开始计时下一次，避免网络慢时请求堆积。
- **移除 listTools() 健康检查**: SSE/HTTP 连接不再使用 `client.listTools()` 进行心跳检查（该方法会创建新的 HTTP 连接），改为依赖 transport 层的 `onclose`/`onerror` 回调监控连接健康状态。
- **心跳间隔调整**: 默认心跳间隔从 20s 增加到 30s，减少不必要的检查频率。

## [1.4.10] - 2026-03-10

### 修复 (Fixed)

- **重连后自动重放 MCP initialize 握手**: 修复了 `ResilientTransportWrapper` 重连后不重放 MCP `initialize` 握手导致服务端返回 `"Server not initialized"` 并进入无限重连循环（~21s 周期）的关键 bug。
  - 在 `send()` 中捕获 `initialize` 和 `notifications/initialized` 消息
  - 重连后自动调用 `performReInitialize()` 重放握手
  - re-initialize 失败时保持指数退避，不重置 `retryAttempt`
  - 使用 `respl-init-*` 前缀拦截内部握手响应，不转发给下游 Client

### 改进 (Changed)

- **`cleanupTransport()` 提取**: 将 transport 清理逻辑（detach handlers + close）提取为独立方法，消除 `performConnect` 和 `triggerReconnect` 中的重复代码。
- **`retryAttempt` 重置时机修正**: 从 transport 连接成功后立即重置，改为 re-initialize 成功后才重置，确保指数退避在握手失败时正常工作。
- **`pendingReInit` 泄漏修复**: `performReInitialize()` 中 `send()` 抛异常时正确清理 `pendingReInit`，避免悬空的超时定时器。

### 测试 (Tests)

- 新增 4 个单元测试覆盖 re-initialize 相关场景（重放、超时、send 异常、无 initialize 边界）
- 修复 1 个已有的错误测试用例
- 新增 `demo/` 目录：Streamable HTTP / SSE demo server + 一键重连测试脚本
- 新增 `demo/TESTING.md` 测试文档

## [1.4.9] - 2026-03-09

### 新增 (Added)

- **日志文件输出 (File Logging)**: 新增 `MCP_PROXY_LOG_FILE` 环境变量支持。设置后，`logger.ts` 会将所有日志同时写入指定文件（append 模式），便于 Electron 宿主通过 tail 机制将 proxy stderr 日志转发到 `main.log`。
- **日志时间戳 (Timestamps)**: 日志格式改为 `[YYYY-MM-DD HH:mm:ss.SSS] [level]  [nuwax-mcp-proxy] message`，与 electron-log 输出格式保持一致，方便日志对照排查。

### 改进 (Changed)

- **指数退避重连 (Exponential Backoff Reconnect)**: `ResilientTransportWrapper` 重连策略从固定延迟（3s）改为指数退避（1s → 2s → 4s → ... → 60s cap），与 Rust mcp-proxy 的 `CappedExponentialBackoff` 保持一致。
- **初次连接失败自动重试**: `performConnect()` 初次连接失败不再抛出异常，而是进入指数退避重试循环，不限次数。此前初次连接失败会直接 `throw`，导致上游无法恢复。
- **重连不限次数**: `triggerReconnect()` 和 `performConnect()` 均不限重试次数。通过 `retryAttempt` 计数器驱动退避延迟，连接成功后重置为 0。
- **修复重连死循环 Bug**: `performConnect()` 失败后不再调用 `triggerReconnect()`（该方法有 `state === 'reconnecting'` 守卫导致重入失败），改为直接调度下一次 `performConnect()`。
- **新增 `maxReconnectDelayMs` 选项**: 退避延迟上限，默认 60000ms (60s)。
- **`start()` 幂等性增强**: 在 `reconnecting` 状态下调用 `start()` 也直接返回，避免重复连接。

## [1.4.7] - 2026-03-09

### 新增 (Added)

- **ResilientTransportWrapper (弹性传输包装层)**: 实现了一个全面的弹性传输层，专门针对 `sse` 和 `streamable-http` 协议在网络不稳定或服务端崩溃时的连接恢复能力。
- **心跳监测 (Heartbeat monitoring)**: 将基于 JSON-RPC 的 `ping` 请求原生集成到传输层循环中，支持自定义检测间隔 (`pingIntervalMs`) 和超时时间 (`pingTimeoutMs`)。
- **自动重连与队列 (Connection Retry Logic)**: 为中断的传输流添加了原生自动重连能力，并包含消息队列缓冲机制，以防止在临时断网期间丢失下游的 RPC 请求。
- **Vitest 单元测试覆盖 (Vitest Testing)**: 新增针对 `ResilientTransportWrapper` 的专用单元测试，与现有的集成测试系统整合在一起。引入 `@vitest/coverage-v8`，实现了关键代码路径及分支近乎 100% 的覆盖率保障。
- **文档与规范 (Documentation)**: 全面更新了 `AGENTS.md` 和 `README.md`，加入了测试、覆盖率统计和弹性传输层的官方说明与支持。

### 修复 (Fixed)

- 修复了因为下游的 `stdio` 服务器子进程初始化失败 (例如找不到二进制文件而触发 `ENOENT` 报错) 从而导致 Promise 未捕获异常并无限挂起进程的核心缺陷。
- 修复了 `flushQueue` 时因不保证 Promise 顺序而产生的有效载荷竞态和乱序重发的问题。
- 彻底消除了下游的远端 MCP 服务因 HTTP 边界失效导致无声无息断连，进而产生的僵尸请求和进程挂起问题。

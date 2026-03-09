# 更新日志 (Changelog)

本项目的所有显著更改都将记录在此文件中。

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

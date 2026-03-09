# 更新日志 (Changelog)

本项目的所有显著更改都将记录在此文件中。

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

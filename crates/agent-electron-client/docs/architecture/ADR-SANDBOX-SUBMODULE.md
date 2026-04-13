# ADR: 三端沙箱运行时子模块化

- 状态: accepted
- 日期: 2026-03-27
- 适用范围: `crates/agent-electron-client`

## 背景

Electron 客户端需要统一接入三端沙箱：

- macOS: `sandbox-exec`（系统）
- Linux: `bubblewrap`（系统优先 + 内置兜底）
- Windows: Codex sandbox helper（内置二进制）

同时要求开箱即用、可配置启停、并可长期维护运行时产物。

## 决策

将三端沙箱运行时作为独立子模块维护在 `crates/agent-sandbox-runtime`，Electron 客户端通过 `prepare:sandbox-runtime` 将当前平台产物同步到 `resources/sandbox-runtime`，再通过 `extraResources` 参与打包。

## 关键取舍

1. 采用预构建产物而非构建时本地编译。
2. 子模块 commit pin 控制升级节奏，避免主仓直接漂移。
3. 主进程保留统一策略层（`sandbox_policy`），后端由策略选择。

## 影响

1. 打包链新增 `prepare:sandbox-runtime`。
2. `after-sign` 增加 `resources/sandbox-runtime` 签名。
3. 文档与运维流程新增子模块升级/回滚步骤。

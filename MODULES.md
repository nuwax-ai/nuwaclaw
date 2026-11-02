# NuwaClaw 功能模块地图

本仓直接维护完整客户端源码。功能模块分为三个层级：**A 独立包**（外部产品直接
依赖）、**B 客户端功能域**（随客户端整体接入，内部边界受强制约束）、**C 平台 helper**；
产品差异经 **D 注入开关** 而非代码分叉实现。

## A. 独立可接入包（products can depend directly）

| 模块 | 位置 | 形态 | 能力 | 接入方式 |
|---|---|---|---|---|
| **@nuwax-ai/agent-kit** | `crates/agent-kit` | npm 包（已发布 v0.4.0，tsup ESM+CJS） | ACP/agent 原语：引擎解析（codex/claude）、file-server/lanproxy 健康轮询、PersistentMcpBridge 生命周期、MCP npx 缓存预热、ACP 权限决策原语、启动重试 | `npm install @nuwax-ai/agent-kit`（nuwa-cli 即此模式）；本仓内部经 `pnpm.overrides file:` 本地联调（**须先构建 dist 再 install**，见 README） |
| **agent-gui-server** | `crates/agent-gui-server` | workspace 包（bin + prepublishOnly，具备发布条件） | GUI Agent MCP server：截屏 + 键鼠模拟自动化 | workspace:*；需要跨仓接入时可发布 npm（低垂果实） |

agent-kit 边界原则（见其 README）：不依赖任何宿主运行时包；codex adapter 为
peerDependency；MCP bridge 由宿主注入。

## B. 客户端功能域（crates/agent-electron-client/src/main/services/）

内部按域划分，`scripts/tools/check-import-boundaries.js` + 测试强制 renderer/main
跨层禁连（30+ 桥接文件白名单），新增功能请落位对应域并遵守边界：

| 域 | 职责 |
|---|---|
| `engines/` | 多引擎 ACP：engineManager、unifiedAgent、acpClient、权限体系 |
| `sandbox/` | 命令/Docker 沙箱：策略矩阵、macOS seatbelt、Linux bwrap |
| `system/` | 依赖安装、shellEnv、进程注册表（ProcessRegistry sweep）、平台适配 |
| `packages/` | MCP 管理（mcp-proxy 集成）、ttyd、GUI agent server、持久 MCP 桥 |
| `computer/` | admin server、chat dispatch、SSE 流 |
| `intervention/` | 干预/审批协议 |
| `memory/` | 会话记忆 |
| `autoUpdater` | 更新通道（feed base 可注入） |

渲染层 `renderer/`、共享层 `shared/`（注入契约单点 `constants.ts`）。

## C. 平台 helper

| 模块 | 位置 | 说明 |
|---|---|---|
| windows-sandbox-helper | `crates/windows-sandbox-helper`（Rust） | Windows Restricted Token 沙箱；由 prepare:all 在 Windows 宿主构建 |

## D. 产品差异化接入点（开关，不是分叉）

- 保留现有 **4 个 NUWAX_* 构建期 env**：identifier / 显示名 / 端口偏移 / 更新通道。默认值维持社区版身份；定义位于共享常量与更新服务。
- 新功能直接在本仓对应模块开发、测试和提交，构建发布也由本仓工作流完成。

## 扩展落位指引

1. 新增**独立能力**（无 Electron 依赖）→ 优先下沉 `agent-kit`，或新建 crate 作为
   workspace 包（`crates/*`，agent-kit 除外——它走 npm 独立发布）。
2. 客户端**新功能域** → `services/<domain>/`，遵守 import 边界检查与对应测试。
3. 产品功能 → 本仓对应客户端功能域；独立能力继续保持包边界。

## 分模块粒度深化（Roadmap，按收益排序）

1. `agent-gui-server` 发布 npm（几乎零成本，第二个独立接入单元）
2. services 域中纯逻辑（权限决策、沙箱策略矩阵等）逐步下沉 agent-kit
3. electron 客户端整体 npm 包化（electron-builder 配置与 extraResources 路径参数化）——
   工程量大，待真有第三方产品需要"只装客户端包"时再做

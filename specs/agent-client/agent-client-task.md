# Agent Client 任务分解文档

> 版本：v1.1.0
> 创建日期：2026-01-29
> 基于文档：
> - `agent-client-spec.md`（技术设计规格）
> - `agent-client-plan.md`（深度实现计划）

---

## 开发阶段

### 阶段一：核心通信与 UI（当前优先级）

**目标**：验证 `agent-server-admin` 与 `agent-client` 之间的双向通信能力，确保 `data-server` 的 P2P/TCP/WebSocket 通信正常工作。

**包含任务**：
- Phase 1：基础框架（P0-1.x）- 脚手架、UI、托盘、自启动、协议版本、安全存储
- Phase 2：核心功能（P0-2.x）- 连接管理、业务通道、设置界面、安全机制
- Phase 3：依赖管理（P0-3.x）- Node.js 检测安装、npm 工具
- Phase 3.5：管理端最小实现（P0-3.5.x）- agent-server-admin 用于验证通信
- Phase 3.6：跨平台打包（P0-3.6.x）- cargo-packager、CI/CD

**验证指标**：
- [ ] 客户端可在 macOS/Windows/Linux 打包安装
- [ ] 客户端能连接 data-server（获取 ID）
- [ ] 管理端能发现并连接客户端
- [ ] 双向消息通信正常（P2P/Relay）
- [ ] 端到端集成测试全部通过
- [ ] 单元测试覆盖率 >= 75%

### 阶段二：Agent 运行时集成（后续开发）

**目标**：集成 agent_runner，实现 Agent 任务执行等功能。

**包含任务**：
- Phase 4：Agent 运行时（P1-4.x）
- Phase 5：增强功能（P1-5.x）
- Phase 6：收尾完善（P2-6.x）

---

## 文档说明

本文档是 agent-client 项目的任务分解文档，专注于回答"AI 需要完成哪些步骤"的问题。

### 任务 ID 规则

```
P-M.T
| | |
| | └── 任务序号 (1, 2, 3...)
| └──── 模块序号 (1=基础框架, 2=核心功能, 3=依赖管理...)
└────── 阶段序号 (P0=必须, P1=应该, P2=可选)
```

### 优先级说明

| 优先级 | 说明 | 含义 |
|--------|------|------|
| P0 | 必须实现 | MVP 必备功能，阻塞发布 |
| P1 | 应该实现 | 重要功能，影响体验 |
| P2 | 可选实现 | 锦上添花，不阻塞发布 |

---

## 任务清单总览

> **说明**：
> - **阶段一（当前优先级）**：Phase 1-3.6，目标是验证通信能力和基础 UI，包含测试和打包
> - **阶段二（后续开发）**：Phase 4-6，集成 agent_runner 和增强功能

### Phase 1：基础框架（P0） *阶段一*

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P0-1.1.1 | 创建 Workspace 配置 | 1h | P0 | ☑ |
| P0-1.1.2 | 创建 agent-protocol 协议模块 | 2h | P0 | ☑ |
| P0-1.1.3 | 配置 Feature Flags | 0.5h | P0 | ☑ |
| P0-1.1.4 | 配置 vendors 路径依赖 | 0.5h | P0 | ☑ |
| P0-1.2.1 | 实现 main.rs 程序入口 | 2h | P0 | ☑ |
| P0-1.2.2 | 实现 lib.rs 库入口 | 1h | P0 | ☑ |
| P0-1.2.3 | 实现 App 应用状态管理 | 3h | P0 | ☑ |
| P0-1.2.4 | 实现 Root 根组件 | 4h | P0 | ☑ |
| P0-1.2.5 | 实现 StatusBar 状态栏 | 3h | P0 | ☑ |
| P0-1.3.1 | 实现 TrayManager 托盘管理器 | 4h | P0 | ☑ |
| P0-1.3.2 | 实现托盘菜单 | 2h | P0 | ☑ |
| P0-1.4.1 | 实现 AutoLaunchManager | 3h | P0 | ☑ |
| P0-1.4.2 | 集成自启动到设置界面 | 2h | P0 | ☑ |
| P0-1.5.1 | 实现协议版本协商机制 | 2h | P0 | ☑ |
| P0-1.5.2 | 实现配置文件加密存储 | 3h | P0 | ☑ |
| P0-1.6.1 | Phase 1 单元测试 | 4h | P0 | ☑ |
| P0-1.6.2 | Phase 1 集成测试脚手架 | 2h | P0 | ☑ |

**Phase 1 预估总工时：39h**

### Phase 2：核心功能（P0） *阶段一*

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P0-2.1.1 | 集成 nuwax-rustdesk ConnectionManager | 6h | P0 | ☑ |
| P0-2.1.2 | 实现连接状态管理 | 3h | P0 | ☑ |
| P0-2.1.3 | 实现心跳保活机制 | 2h | P0 | ☑ |
| P0-2.1.4 | 实现重连逻辑 | 3h | P0 | ☑ |
| P0-2.2.1 | 实现 BusinessChannel 模块 | 4h | P0 | ☑ |
| P0-2.2.2 | 修改 nuwax-rustdesk 导出模块 | 2h | P0 | ☑ |
| P0-2.3.1 | 实现 Settings 主组件 | 4h | P0 | ☑ |
| P0-2.3.2 | 实现服务器配置子页面 | 3h | P0 | ☑ |
| P0-2.3.3 | 实现安全设置子页面（密码修改） | 3h | P0 | ☑ |
| P0-2.3.4 | 实现常规/外观/日志子页面 | 3h | P0 | ☑ |
| P0-2.4.1 | 实现 ClientInfo 组件（ID/密码） | 4h | P0 | ☑ |
| P0-2.4.2 | 实现剪贴板复制功能 | 1h | P0 | ☑ |
| P0-2.5.1 | 实现密码 bcrypt 加密存储 | 2h | P0 | ☑ |
| P0-2.5.2 | 实现离线消息队列 | 3h | P0 | ☑ |
| P0-2.5.3 | 实现大消息分片传输 | 4h | P0 | ☑ |
| P0-2.6.1 | Phase 2 单元测试 | 4h | P0 | ☑ |
| P0-2.6.2 | 协议兼容性测试 | 2h | P0 | ☑ |

**Phase 2 预估总工时：53h**

### Phase 3：依赖管理（P0） *阶段一*

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P0-3.1.1 | 实现跨平台目录管理（dirs） | 2h | P0 | ☑ |
| P0-3.1.2 | 实现 NodeDetector 系统检测 | 4h | P0 | ☑ |
| P0-3.1.3 | 实现 NodeInstaller 下载安装 | 6h | P0 | ☑ |
| P0-3.1.4 | 实现 npm 工具安装器 | 4h | P0 | ☑ |
| P0-3.2.1 | 实现 DependencyManager 核心 | 3h | P0 | ☑ |
| P0-3.2.2 | 实现依赖状态 UI 组件 | 4h | P0 | ☑ |
| P0-3.2.3 | 实现手动安装指引界面 | 2h | P0 | ☑ |
| P0-3.2.4 | 实现安装进度显示 | 2h | P0 | ☑ |
| P0-3.3.1 | Phase 3 单元测试 | 3h | P0 | ☑ |
| P0-3.3.2 | 依赖安装集成测试 | 2h | P0 | ☑ |

**Phase 3 预估总工时：32h**

### Phase 3.5：agent-server-admin 最小实现（P0） *阶段一*

> **说明**：阶段一验证通信需要管理端配合，此 Phase 实现最小可用的 agent-server-admin

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P0-3.5.1 | 创建 agent-server-admin crate 脚手架 | 1h | P0 | ☑ |
| P0-3.5.2 | 实现 HTTP API 基础框架 (axum) | 3h | P0 | ☑ |
| P0-3.5.3 | 实现客户端列表 API | 2h | P0 | ☑ |
| P0-3.5.4 | 实现连接客户端 API | 3h | P0 | ☑ |
| P0-3.5.5 | 实现双向消息发送 API | 3h | P0 | ☑ |
| P0-3.5.6 | 实现 SSE 消息推送 | 3h | P0 | ☑ |
| P0-3.5.7 | 集成 nuwax-rustdesk 通信 | 4h | P0 | ☑ |
| P0-3.5.8 | 创建 data-server crate（封装 rustdesk-server） | 3h | P0 | ☑ |
| P0-3.5.9 | data-server 本地部署配置 | 2h | P0 | ☑ |
| P0-3.5.10 | 端到端通信集成测试 | 4h | P0 | ☑ |

**Phase 3.5 预估总工时：28h**

### Phase 3.6：跨平台打包（P0） *阶段一*

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P0-3.6.1 | 配置 cargo-packager | 2h | P0 | ☑ |
| P0-3.6.2 | macOS 打包配置 (.dmg/.app) | 3h | P0 | ☑ |
| P0-3.6.3 | Windows 打包配置 (.msi/.exe) | 3h | P0 | ☑ |
| P0-3.6.4 | Linux 打包配置 (.deb/.AppImage) | 3h | P0 | ☑ |
| P0-3.6.5 | CI/CD 打包脚本 (GitHub Actions) | 4h | P0 | ☑ |
| P0-3.6.6 | 打包产物验证测试 | 2h | P0 | ☑ |

**Phase 3.6 预估总工时：17h**

### Phase 4：Agent 运行时（P1） *阶段二（后续开发）*

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P1-4.1.1 | 集成 agent_runner 依赖 | 2h | P1 | ☑ |
| P1-4.1.2 | 实现 AgentManager 核心 | 4h | P1 | ☑ |
| P1-4.1.3 | 实现消息转换层 | 3h | P1 | ☑ |
| P1-4.1.4 | 实现任务执行流程 | 4h | P1 | ☑ |
| P1-4.1.5 | 实现进度回传机制 | 3h | P1 | ☑ |
| P1-4.1.6 | 实现任务取消功能 | 2h | P1 | ☑ |
| P1-4.2.1 | 实现状态栏 Agent 状态显示 | 2h | P1 | ☑ |
| P1-4.3.1 | Phase 4 单元测试 | 3h | P1 | ☑ |
| P1-4.3.2 | Agent 执行集成测试 | 3h | P1 | ☑ |

**Phase 4 预估总工时：26h**

### Phase 5：增强功能（P1） *阶段二（后续开发）*

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P1-5.1.1 | 实现 PermissionManager 核心 | 4h | P1 | ☑ |
| P1-5.1.2 | 实现 macOS 权限检测 | 3h | P1 | ☑ |
| P1-5.1.3 | 实现 Windows 权限检测 | 3h | P1 | ☑ |
| P1-5.1.4 | 实现权限设置 UI | 3h | P1 | ☑ |
| P1-5.2.1 | 实现日志系统（tracing） | 3h | P1 | ☑ |
| P1-5.2.2 | 实现日志导出功能 | 2h | P1 | ☑ |
| P1-5.3.1 | 实现文件传输核心 | 4h | P1 | ☑ |
| P1-5.3.2 | 实现文件发送 UI | 3h | P1 | ☑ |
| P1-5.3.3 | 实现文件接收提示 | 2h | P1 | ☑ |
| P1-5.4.1 | 实现 RemoteDesktop 组件 | 6h | P1 | ☑ |
| P1-5.4.2 | 集成 enigo 输入模拟 | 3h | P1 | ☑ |
| P1-5.5.1 | Phase 5 单元测试 | 4h | P1 | ☑ |
| P1-5.5.2 | 文件传输集成测试 | 3h | P1 | ☑ |
| P1-5.5.3 | 远程桌面集成测试 | 3h | P1 | ☑ |

**Phase 5 预估总工时：46h**

### Phase 6：收尾完善（P2） *阶段二（后续开发）*

| ID | 任务名称 | 预估工时 | 优先级 | 状态 |
|----|----------|----------|--------|------|
| P2-6.1.1 | 实现 About 组件 | 2h | P2 | ☑ |
| P2-6.1.2 | 实现版本信息显示 | 1h | P2 | ☑ |
| P2-6.2.1 | 实现 Chat 聊天界面 | 6h | P2 | ☑ |
| P2-6.2.2 | 实现聊天记录管理 | 3h | P2 | ☑ |
| P2-6.3.1 | 实现客户端升级检查 | 4h | P2 | ☑ |
| P2-6.3.2 | 实现升级下载安装 | 4h | P2 | ☑ |
| P2-6.4.1 | 国际化支持（中/英） | 4h | P2 | ☑ |
| P2-6.4.2 | 主题切换功能 | 2h | P2 | ☑ |
| P2-6.5.1 | Phase 6 单元测试 | 3h | P2 | ☑ |
| P2-6.5.2 | 全量回归测试 | 4h | P2 | ☑ |

**Phase 6 预估总工时：33h**

---

## 详细任务说明

## Phase 1：基础框架（P0）

### P0-1.1.1 创建 Workspace 配置

**任务描述**：创建项目根目录的 Cargo.toml，配置 workspace 成员和共享依赖

**实现文件**：
- `crates/agent-client/Cargo.toml`

**验收标准**：
- [ ] workspace 包含 `crates/agent-client` 和 `crates/agent-protocol` 等成员
- [ ] 共享依赖版本在 workspace.dependencies 中统一定义
- [ ] `cargo check --workspace` 通过

**相关文档**：
- spec: 7. 目录结构
- plan: 1.2 Workspace Cargo.toml 完整配置

---

### P0-1.1.2 创建 agent-protocol 协议模块

**任务描述**：创建协议定义 crate，包含 protobuf 消息定义和编译脚本

**实现文件**：
- `crates/agent-protocol/Cargo.toml`
- `crates/agent-protocol/build.rs`
- `crates/agent-protocol/src/lib.rs`
- `crates/agent-protocol/src/proto/message.proto`

**验收标准**：
- [ ] proto 文件包含 HandshakeRequest/Response, AgentTaskRequest/Response 等消息定义
- [ ] build.rs 正确编译 proto 文件
- [ ] 生成的 Rust 代码可被 agent-client 引用
- [ ] 单元测试通过

**相关文档**：
- spec: 5. 通信协议设计
- plan: 1.4 agent-protocol/Cargo.toml 完整配置

---

### P0-1.2.1 实现 main.rs 程序入口

**任务描述**：实现应用入口，包含日志初始化、配置加载、信号处理、主循环

**实现文件**：
- `crates/agent-client/src/main.rs`

**验收标准**：
- [ ] 程序启动时初始化日志系统
- [ ] 加载配置文件
- [ ] 处理 Ctrl+C 和 terminate 信号
- [ ] 正确创建 App 实例并运行
- [ ] 优雅关闭（清理资源）

**代码参考**：
- plan: 1.6 项目脚手架

---

### P0-1.2.4 实现 Root 根组件

**任务描述**：实现主窗口根组件，包含标题栏、Tab 面板、内容区、状态栏

**实现文件**：
- `crates/agent-client/src/components/root.rs`

**验收标准**：
- [ ] 顶部显示应用名称和图标
- [ ] Tab 面板可切换不同功能页面
- [ ] 根据 feature 过滤不可用的 Tab（remote-desktop, chat-ui）
- [ ] 底部显示状态栏
- [ ] 主题适配（深色/浅色）

**代码参考**：
- plan: 1.8 UI 组件实现

---

### P0-1.3.1 实现 TrayManager 托盘管理器

**任务描述**：实现系统托盘图标显示和菜单功能

**实现文件**：
- `crates/agent-client/src/tray/mod.rs`
- `crates/agent-client/src/tray/menu.rs`
- `crates/agent-client/src/tray/icon.rs`

**验收标准**：
- [ ] 启动时在系统托盘显示图标
- [ ] 左键点击显示主窗口
- [ ] 右键点击显示菜单（显示窗口、设置、依赖管理、关于、退出）
- [ ] 菜单项可点击响应
- [ ] 支持跨平台（macOS/Windows/Linux）

**代码参考**：
- plan: 1.9 系统托盘

---

## Phase 2：核心功能（P0）

### P0-2.1.1 集成 nuwax-rustdesk ConnectionManager

**任务描述**：集成 nuwax-rustdesk 的 RendezvousMediator，实现与 data-server 的连接

**实现文件**：
- `crates/agent-client/src/core/connection.rs`

**验收标准**：
- [ ] 可配置 hbbs 和 hbbr 服务器地址
- [ ] 连接到 hbbs 获取客户端 ID
- [ ] 连接到 hbbr 准备中继
- [ ] 根据网络情况自动选择 P2P 或 Relay 模式
- [ ] 返回连接延迟（latency）

**代码参考**：
- plan: 2.1 nuwax-rustdesk 集成

---

### P0-2.1.2 实现连接状态管理

**任务描述**：实现连接状态的统一管理，包括状态定义、状态切换、状态持久化

**实现文件**：
- `crates/agent-client/src/core/connection/state.rs`

**验收标准**：
- [ ] 定义完整的连接状态枚举（Disconnected/Connecting/Connected/Error）
- [ ] 状态切换时发出通知
- [ ] 状态持久化到配置文件
- [ ] 状态栏正确显示当前状态

**代码参考**：
- plan: 2.1 nuwax-rustdesk 集成

---

### P0-2.1.3 实现心跳保活机制

**任务描述**：实现客户端与服务器之间的心跳保活机制，检测连接是否存活

**实现文件**：
- `crates/agent-client/src/core/connection/heartbeat.rs`

**验收标准**：
- [ ] 定期发送心跳包（默认 30 秒）
- [ ] 检测心跳超时（默认 90 秒）
- [ ] 超时后触发重连
- [ ] 心跳包最小化（仅包含必要字段）

**代码参考**：
- plan: 2.1 nuwax-rustdesk 集成

---

### P0-2.1.4 实现重连逻辑

**任务描述**：实现网络断开后的自动重连机制，包含指数退避和随机抖动

**实现文件**：
- `crates/agent-client/src/core/connection/reconnect.rs`

**验收标准**：
- [ ] 断线后自动尝试重连
- [ ] 使用指数退避策略（初始 1s，最大 30s）
- [ ] 支持随机抖动避免同时重连
- [ ] 离线消息队列缓存待发送消息
- [ ] 可配置最大重试次数

**代码参考**：
- plan: 8.2 重连机制实现

---

### P0-2.2.1 实现 BusinessChannel 模块

**任务描述**：在 nuwax-rustdesk 基础上实现业务数据通道，用于传输 Agent 任务数据

**实现文件**：
- `crates/agent-client/src/core/business_channel.rs`
- `vendors/nuwax-rustdesk/src/business_channel.rs`

**验收标准**：
- [ ] 复用 nuwax-rustdesk 的底层 Stream
- [ ] 创建独立的业务通道（channel_id = 0xBIZ）
- [ ] 支持发送/接收业务消息
- [ ] 支持消息订阅机制
- [ ] 消息格式正确（message_type + payload）

**代码参考**：
- plan: 2.2 业务数据通道

---

### P0-2.4.1 实现 ClientInfo 组件

**任务描述**：实现客户端信息 Tab，显示 ID 和密码

**实现文件**：
- `crates/agent-client/src/components/client_info.rs`

**验收标准**：
- [ ] 显示 8 位客户端 ID（只读）
- [ ] 显示连接密码，可切换显示/隐藏
- [ ] 点击复制按钮复制到剪贴板
- [ ] 点击"修改密码"跳转到设置页的安全子页面
- [ ] 显示密码强度提示

**代码参考**：
- spec: 2.2 客户端信息 Tab

---

## Phase 3：依赖管理（P0）

### P0-3.1.2 实现 NodeDetector 系统检测

**任务描述**：检测系统中已安装的 Node.js，优先使用系统全局安装

**实现文件**：
- `crates/agent-client/src/core/dependency/node.rs`

**验收标准**：
- [ ] 检测 PATH 中的 node 命令
- [ ] 检测 macOS 特定路径（/usr/local/bin/node）
- [ ] 检测 Windows 特定路径（Program Files）
- [ ] 获取版本号并验证是否 >= 18.0.0
- [ ] 区分系统全局和客户端目录安装

**代码参考**：
- plan: 3.1 Node.js 自动安装

---

### P0-3.1.3 实现 NodeInstaller 下载安装

**任务描述**：自动下载并安装 Node.js 到客户端隔离目录

**实现文件**：
- `crates/agent-client/src/core/dependency/node_installer.rs`

**验收标准**：
- [ ] 下载对应平台的 Node.js 预编译包
- [ ] 显示下载进度
- [ ] 解压到隔离目录（`<APP_DATA>/tools/node/`）
- [ ] 设置可执行权限
- [ ] 验证安装成功
- [ ] 支持断点续传（可选）

**代码参考**：
- plan: 3.1 Node.js 自动安装

---

### P0-3.2.2 实现依赖状态 UI 组件

**任务描述**：实现依赖管理 Tab 的 UI，显示依赖列表和状态

**实现文件**：
- `crates/agent-client/src/components/dependency_manager.rs`

**验收标准**：
- [ ] 显示依赖列表（Node.js, npm, opencode, claude-code 等）
- [ ] 每行显示：名称、版本、来源、状态、操作按钮
- [ ] 状态使用颜色区分（绿色=正常，红色=缺失，黄色=可更新）
- [ ] 支持一键安装所有缺失依赖
- [ ] 支持手动刷新状态

**代码参考**：
- spec: 2.4 依赖管理 Tab

---

### P0-3.3.1 Phase 3 单元测试

**任务描述**：为依赖管理模块编写单元测试

**实现文件**：
- `crates/agent-client/src/core/dependency/tests.rs`

**验收标准**：
- [ ] NodeDetector 检测逻辑测试
- [ ] 版本比较逻辑测试
- [ ] 路径解析逻辑测试
- [ ] 测试覆盖率 >= 80%

---

## Phase 3.5：agent-server-admin 最小实现（P0）

### P0-3.5.1 创建 agent-server-admin crate 脚手架

**任务描述**：创建管理端 crate 基础结构

**实现文件**：
- `crates/agent-server-admin/Cargo.toml`
- `crates/agent-server-admin/src/main.rs`
- `crates/agent-server-admin/src/lib.rs`

**验收标准**：
- [ ] crate 可编译
- [ ] 基础目录结构完整
- [ ] 依赖 agent-protocol

---

### P0-3.5.2 实现 HTTP API 基础框架

**任务描述**：使用 axum 实现 HTTP API 服务

**实现文件**：
- `crates/agent-server-admin/src/api/mod.rs`
- `crates/agent-server-admin/src/api/router.rs`

**验收标准**：
- [ ] 启动 HTTP 服务监听指定端口
- [ ] 支持 CORS 配置
- [ ] 健康检查接口 `/health`
- [ ] 错误处理中间件

---

### P0-3.5.5 实现双向消息发送 API

**任务描述**：实现向客户端发送消息并接收响应的 API

**实现文件**：
- `crates/agent-server-admin/src/api/message.rs`

**验收标准**：
- [ ] POST `/api/clients/{id}/message` 发送消息
- [ ] 支持同步等待响应
- [ ] 支持超时配置
- [ ] 消息使用 Protobuf 序列化

---

### P0-3.5.8 创建 data-server crate

**任务描述**：基于 rustdesk-server 封装 data-server crate，提供信令和中继服务

**实现文件**：
- `crates/data-server/Cargo.toml`
- `crates/data-server/src/main.rs`
- `crates/data-server/src/config.rs`

**验收标准**：
- [ ] 封装 rustdesk-server 的 hbbs（信令服务）
- [ ] 封装 rustdesk-server 的 hbbr（中继服务）
- [ ] 支持配置文件加载
- [ ] 支持端口配置
- [ ] 可独立启动运行

**代码参考**：
- vendorsdoc: rustdesk-server.md

---

### P0-3.5.9 data-server 本地部署配置

**任务描述**：配置 data-server 本地开发环境

**实现文件**：
- `config/data-server.toml`
- `scripts/start-data-server.sh`
- `docker-compose.yml` (可选)

**验收标准**：
- [ ] 本地可一键启动 data-server
- [ ] 配置默认端口（hbbs: 21116, hbbr: 21117）
- [ ] 日志输出正常
- [ ] 文档说明启动步骤

---

### P0-3.5.10 端到端通信集成测试

**任务描述**：验证 agent-client 与 agent-server-admin 的完整通信流程

**实现文件**：
- `tests/e2e/communication_test.rs`

**验收标准**：
- [ ] 客户端可连接 data-server 获取 ID
- [ ] 管理端可发现在线客户端
- [ ] 管理端可向客户端发送消息
- [ ] 客户端可向管理端返回响应
- [ ] P2P 模式测试通过
- [ ] Relay 模式测试通过

---

## Phase 3.6：跨平台打包（P0）

### P0-3.6.1 配置 cargo-packager

**任务描述**：配置 cargo-packager 打包工具

**实现文件**：
- `crates/agent-client/packager.toml`
- `crates/agent-client/Cargo.toml` (metadata)

**验收标准**：
- [ ] 配置应用名称、版本、描述
- [ ] 配置图标路径
- [ ] 配置安装目录

---

### P0-3.6.2 macOS 打包配置

**任务描述**：配置 macOS 平台打包

**实现文件**：
- `crates/agent-client/packager.toml`
- `crates/agent-client/assets/macos/Info.plist`
- `crates/agent-client/assets/macos/entitlements.plist`

**验收标准**：
- [ ] 生成 .app 应用包
- [ ] 生成 .dmg 安装镜像
- [ ] 配置代码签名（可选）
- [ ] 配置公证（可选）

---

### P0-3.6.5 CI/CD 打包脚本

**任务描述**：配置 GitHub Actions 自动打包

**实现文件**：
- `.github/workflows/build.yml`
- `.github/workflows/release.yml`

**验收标准**：
- [ ] PR 触发构建检查
- [ ] Tag 触发发布构建
- [ ] 产出 macOS/Windows/Linux 安装包
- [ ] 自动上传 Release Assets

---

## Phase 4：Agent 运行时（P1）

### P1-4.1.2 实现 AgentManager 核心

**任务描述**：实现 Agent 任务管理器，直接调用 agent_runner 内部函数

**实现文件**：
- `crates/agent-client/src/core/agent.rs`

**验收标准**：
- [ ] 通过 path 依赖调用 agent_runner（不使用 gRPC）
- [ ] 启动 Agent 任务（start_agent）
- [ ] 取消正在执行的任务（cancel_agent）
- [ ] 查询任务状态（get_agent_status）
- [ ] 管理多个并发任务
- [ ] 使用 DashMap 保证线程安全

**代码参考**：
- plan: 4.1 AgentManager 完整实现（250 行）

---

## Phase 5：增强功能（P1）

### P1-5.1.1 实现 PermissionManager 核心

**任务描述**：实现跨平台权限检测和管理

**实现文件**：
- `crates/agent-client/src/core/platform/permissions.rs`

**验收标准**：
- [ ] 检测辅助功能权限（Accessibility）
- [ ] 检测屏幕录制权限（ScreenRecording）
- [ ] 检测磁盘访问权限（FullDiskAccess）
- [ ] 打开系统设置页面
- [ ] macOS 使用 TCC 检查
- [ ] Windows 使用注册表检查

**代码参考**：
- plan: 5.1 权限检测

---

## Phase 6：收尾完善（P2）

### P2-6.1.1 实现 About 组件

**任务描述**：实现关于界面，显示版本信息和链接

**实现文件**：
- `crates/agent-client/src/components/about.rs`

**验收标准**：
- [ ] 显示应用图标
- [ ] 显示版本号（1.0.0）和构建信息
- [ ] 显示 Git commit SHA
- [ ] 提供文档、问题反馈、官网链接
- [ ] 提供导出日志按钮

**代码参考**：
- plan: 6.1 About 组件完整实现（120 行）

---

## 任务依赖关系

```
Phase 1 (基础框架)
├── P0-1.1.1 (Workspace) ───┐
├── P0-1.1.2 (Protocol) ────┤
├── P0-1.1.3 (Features) ────┤
├── P0-1.1.4 (Dependencies) ─┤
├── P0-1.5.x (协议/安全) ←──┤
└── P0-1.2.x (UI) ──────────┤
    └── P0-1.3.x (Tray) ────┤
        └── P0-1.4.x (AutoLaunch)
            └── P0-1.6.x (Tests) ← 全部 Phase 1 任务
                            │
Phase 2 (核心功能) ──────────┤
├── P0-2.1.x (Connection) ←─┘
├── P0-2.2.x (BusinessChannel) ← P0-1.1.2
├── P0-2.5.x (安全/消息队列) ← P0-2.1.x
└── P0-2.3.x (Settings) ←─────┤
    └── P0-2.4.x (ClientInfo) ← P0-2.1.x (Connection)
        └── P0-2.6.x (Tests) ← 全部 Phase 2 任务
                                │
Phase 3 (依赖管理) ←────────────┤
├── P0-3.1.x (Node.js) ←───────┤
├── P0-3.2.x (UI) ←────────────┤
└── P0-3.3.x (Tests) ←─────────┘
                                │
Phase 3.5 (管理端最小实现) ←────┤
├── P0-3.5.1 (脚手架) ←────────┤
├── P0-3.5.2-7 (API/通信) ←────┤
└── P0-3.5.8 (E2E Tests) ← Phase 1-3.5 全部
                                │
Phase 3.6 (跨平台打包) ←────────┤
├── P0-3.6.1-4 (打包配置) ←────┤
├── P0-3.6.5 (CI/CD) ←─────────┤
└── P0-3.6.6 (验证) ←──────────┘

═══════════════════════════════════════
        阶段一完成线 (验证里程碑)
═══════════════════════════════════════

Phase 4 (Agent) ←──────────────┤
├── P1-4.1.x (AgentManager) ← P0-1.1.2 (Protocol)
├── P1-4.2.x (UI) ←────────────┤
└── P1-4.3.x (Tests) ←─────────┘

Phase 5 (增强) ←───────────────┤
├── P1-5.1.x (Permissions) ←───┤
├── P1-5.2.x (Logging) ←───────┤
├── P1-5.3.x (FileTransfer) ←──┤
├── P1-5.4.x (RemoteDesktop) ←─┤
└── P1-5.5.x (Tests) ←─────────┘

Phase 6 (收尾) ←────────────────┤
├── P2-6.1.x (About) ←─────────┤
├── P2-6.2.x (Chat) ←─────────┤
├── P2-6.3.x (Update) ←───────┤
├── P2-6.4.x (i18n) ←─────────┤
└── P2-6.5.x (Tests) ←─────────┘
```

---

### P2-6.4.1 国际化支持（中/英）

**任务描述**：实现应用国际化，支持中文和英文两种语言

**实现文件**：
- `crates/agent-client/src/i18n/mod.rs`
- `crates/agent-client/assets/locales/zh-CN/messages.toml`
- `crates/agent-client/assets/locales/en-US/messages.toml`

**验收标准**：
- [ ] 实现 I18nManager 管理语言切换
- [ ] 创建中英文资源文件
- [ ] 支持设置界面切换语言
- [ ] 界面文本实时更新
- [ ] 日期/时间/文件大小按区域格式化

**代码参考**：
- plan: 9.1 国际化基础设施

---

### P2-6.4.2 主题切换功能

**任务描述**：实现浅色/深色/跟随系统三种主题模式

**实现文件**：
- `crates/agent-client/src/core/theme.rs`
- `crates/agent-client/src/components/theme_toggle.rs`

**验收标准**：
- [ ] 支持浅色主题
- [ ] 支持深色主题
- [ ] 支持跟随系统设置
- [ ] 主题切换实时生效
- [ ] 主题设置持久化

**代码参考**：
- spec: 2.3.5 外观设置子页面

---

## 开发顺序建议

### 阶段一：核心通信与 UI（当前优先级）

**目标**：验证 `agent-server-admin` 与 `agent-client` 之间的双向通信能力。

#### 第一批（MVP 最小可运行版本）

1. P0-1.1.1 ~ P0-1.1.4：项目脚手架、协议模块、依赖配置
2. P0-1.5.1 ~ P0-1.5.2：协议版本协商、配置加密
3. P0-1.2.1 ~ P0-1.2.5：基础 UI 框架、状态栏
4. P0-1.3.1 ~ P0-1.3.2：托盘功能
5. P0-1.4.1 ~ P0-1.4.2：开机自启动
6. P0-1.6.1 ~ P0-1.6.2：Phase 1 测试

**预计工时：~39h**

#### 第二批（核心通信）

1. P0-2.1.1 ~ P0-2.1.4：连接管理、心跳保活、重连
2. P0-2.2.1 ~ P0-2.2.2：业务通道
3. P0-2.5.1 ~ P0-2.5.3：密码加密、离线队列、消息分片
4. P0-2.3.1 ~ P0-2.3.4：设置界面
5. P0-2.4.1 ~ P0-2.4.2：客户端信息显示
6. P0-2.6.1 ~ P0-2.6.2：Phase 2 测试

**预计工时：~53h**

#### 第三批（依赖管理）

1. P0-3.1.1 ~ P0-3.1.4：Node.js 检测和安装
2. P0-3.2.1 ~ P0-3.2.4：依赖管理 UI
3. P0-3.3.1 ~ P0-3.3.2：Phase 3 测试

**预计工时：~32h**

#### 第四批（管理端最小实现）

1. P0-3.5.1 ~ P0-3.5.7：agent-server-admin API 和通信
2. P0-3.5.8 ~ P0-3.5.9：data-server crate 和部署配置
3. P0-3.5.10：端到端通信集成测试

**预计工时：~28h**

#### 第五批（跨平台打包）

1. P0-3.6.1 ~ P0-3.6.4：各平台打包配置
2. P0-3.6.5：CI/CD 配置
3. P0-3.6.6：打包验证

**预计工时：~17h**

**阶段一验证里程碑**：
- [ ] 客户端可在 macOS/Windows/Linux 打包安装
- [ ] 客户端能连接 data-server（获取 ID）
- [ ] 管理端能发现并连接客户端
- [ ] 双向消息通信正常（P2P/Relay）
- [ ] 端到端集成测试全部通过
- [ ] 所有平台安装包可用

**阶段一总预计工时：~169h**

---

### 阶段二：Agent 运行时集成（后续开发）

**目标**：集成 agent_runner，实现 Agent 任务执行等功能。

#### 第六批（Agent 功能）

1. P1-4.1.1 ~ P1-4.1.6：Agent 管理器
2. P1-4.2.1：状态栏显示
3. P1-4.3.1 ~ P1-4.3.2：Phase 4 测试

**预计工时：~26h**

#### 第七批（增强功能）

1. P1-5.1.x：权限管理
2. P1-5.2.x：日志系统
3. P1-5.3.x：文件传输
4. P1-5.4.x：远程桌面
5. P1-5.5.x：Phase 5 测试

**预计工时：~46h**

#### 第八批（收尾完善）

1. P2-6.1.x：关于界面
2. P2-6.2.x：聊天界面
3. P2-6.3.x：自动升级
4. P2-6.4.x：国际化、主题
5. P2-6.5.x：Phase 6 测试

**预计工时：~33h**

**阶段二总预计工时：~105h**

---

## 里程碑

> **说明**：Milestone 1-5 属于阶段一（当前开发），Milestone 6-8 属于阶段二（后续开发）

### Milestone 1：骨架完成
- [ ] 完成 Phase 1 所有任务（含测试）
- [ ] 应用可启动，显示 UI
- [ ] 系统托盘图标正常
- [ ] 开机自启动可配置
- [ ] Phase 1 单元测试通过

**达成条件**：编译运行成功，UI 可交互，测试覆盖率 >= 80%

### Milestone 2：核心通信
- [ ] 完成 Phase 2 所有任务（含测试）
- [ ] 可连接到 data-server
- [ ] 显示连接状态和延迟
- [ ] 客户端 ID 和密码功能正常
- [ ] 双向通信正常（P2P/Relay）
- [ ] 密码加密存储
- [ ] 离线消息队列可用
- [ ] 协议兼容性测试通过

**达成条件**：可与服务器建立双向通信，安全机制完备

### Milestone 3：依赖就绪
- [ ] 完成 Phase 3 所有任务（含测试）
- [ ] 自动检测系统 Node.js
- [ ] 可自动安装 Node.js
- [ ] 依赖管理 UI 完整

**达成条件**：Agent 运行环境准备就绪

### Milestone 4：管理端就绪
- [ ] 完成 Phase 3.5 所有任务
- [ ] agent-server-admin 可启动
- [ ] 可发现在线客户端
- [ ] 可向客户端发送消息
- [ ] 端到端集成测试全部通过

**达成条件**：客户端与管理端完整通信流程验证通过

### Milestone 5：打包发布（阶段一完成）
- [ ] 完成 Phase 3.6 所有任务
- [ ] macOS .dmg 可安装运行
- [ ] Windows .msi 可安装运行
- [ ] Linux .deb/.AppImage 可运行
- [ ] CI/CD 自动打包流程正常
- [ ] 打包产物验证测试通过

**达成条件**：阶段一完成，可发布 Alpha 版本

---

### Milestone 6：Agent 可用
- [ ] 完成 Phase 4 所有任务（含测试）
- [ ] 可执行 Agent 任务
- [ ] 进度实时回传
- [ ] 可取消任务

**达成条件**：Agent 任务完整流程可用

### Milestone 7：功能完整
- [ ] 完成 Phase 5 所有任务（含测试）
- [ ] 文件传输正常
- [ ] 远程桌面可用
- [ ] 权限检测完善
- [ ] 日志系统完整

**达成条件**：所有 P1 功能可用

### Milestone 8：发布就绪
- [ ] 完成 Phase 6 所有任务（含测试）
- [ ] 所有 P2 功能完成
- [ ] 国际化支持
- [ ] 全量回归测试通过
- [ ] 文档完善

**达成条件**：可发布正式版本

---

## 风险与注意事项

### 技术风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| nuwax-rustdesk API 变化 | 低 | 高 | 封装隔离层，减少直接依赖 |
| gpui API 变化 | 中 | 中 | 锁定 git commit，使用 wrapper |
| 跨平台兼容性问题 | 中 | 中 | 条件编译，CI 测试覆盖 |

### 阻塞风险

| 阻塞项 | 依赖任务 | 缓解措施 |
|--------|----------|----------|
| nuwax-rustdesk 未完成 business_channel | P0-2.2.1 | 先使用模拟实现，后续替换 |
| agent_runner 函数接口未导出 | P1-4.1.1 | 确认接口，或直接调用内部函数 |
| gpui-component 组件不完整 | 多个 UI 任务 | 使用基础 gpui 替代，编写 wrapper |

---

## 变更记录

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| v1.1.0 | 2026-01-29 | 补充测试任务、agent-server-admin 最小实现、跨平台打包、安全存储等遗漏任务 | - |
| v1.0.0 | 2026-01-29 | 初始版本 | - |

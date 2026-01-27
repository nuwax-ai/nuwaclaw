# Agent Client 技术设计规格文档

## 1. 技术选型评估

### 1.1 Rust 桌面客户端技术现状

根据 2025 年 Rust GUI 生态调研（参考 [A 2025 Survey of Rust GUI Libraries](https://www.boringcactus.com/2025/04/13/2025-survey-of-rust-gui-libraries.html) 和 [Are we GUI yet?](https://areweguiyet.com/)），主流框架对比如下：

| 框架 | 特点 | 适用场景 | 成熟度 |
|------|------|----------|--------|
| **Tauri** | Web 技术 + Rust 后端，轻量级 | Web 开发者转型，快速开发 | 生产可用 |
| **Iced** | Elm 架构，类型安全，纯 Rust | 复杂状态管理，桌面应用 | 快速迭代中 |
| **GPUI** | Zed 编辑器使用，高性能 | 高性能桌面应用 | 文档不完善但可用 |
| **Slint** | 声明式 UI，支持嵌入式 | 嵌入式 + 桌面 | 生产可用 |
| **Dioxus** | 类 React，全平台 | Web/桌面/移动全栈 | 快速发展中 |
| **egui** | 即时模式，简单易用 | 工具类应用、游戏 UI | 成熟 |

### 1.2 本项目技术选型评估

**当前选型：GPUI + gpui-component**

**合理性分析：**

1. **gpui-component 组件库完善**
   - 提供 60+ 跨平台桌面 UI 组件
   - 支持 Dock 系统、Tab 面板、对话框等复杂布局
   - 支持主题系统、国际化
   - 本地已有完整源码（vendors/gpui-component）

2. **与项目需求匹配**
   - 需要原生桌面体验（非 Web 渲染）
   - 需要复杂的 Tab 切换、设置面板、状态栏等 UI
   - 需要高性能（远程桌面场景）

3. **风险点**
   - GPUI 文档相对不完善
   - 社区生态相比 Tauri/Iced 较小
   - **缓解措施**：有 gpui-component 组件库和示例代码参考

**结论：技术选型合理，建议继续使用。**

### 1.3 其他依赖库评估

| 依赖 | 用途 | 评估 |
|------|------|------|
| `auto-launch` | 开机自启 | Tauri 团队维护，成熟稳定 |
| `tray-icon` + `muda` | 系统托盘 | Tauri 团队出品，跨平台支持好 |
| `cargo-packager` | 跨平台打包 | 从 Tauri 拆分，支持多种格式 |
| `librustdesk` | 通信层 | 已有 rlib 支持，可作为 lib 使用 |
| `enigo` | 输入模拟 | rustdesk 验证，跨平台稳定 |

---

## 2. 整体架构设计

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Browser (Web)                               │
│                         agent-server-admin 管理端页面                      │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ HTTP/SSE
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          agent-server-admin                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  HTTP API   │  │   SSE 推送   │  │ 任务调度器  │  │ 客户端管理   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ Protobuf (P2P 或 中转)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            data-server                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │
│  │  ID 分配器   │  │  P2P 中介    │  │  数据中转    │                      │
│  └─────────────┘  └─────────────┘  └─────────────┘                      │
│                    (基于 rustdesk-server)                                │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ Protobuf (P2P 或 中转)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           agent-client                                   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      UI Layer (gpui-component)                    │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │   │
│  │  │ ID/密码  │ │  设置   │ │  聊天   │ │  权限   │ │ About  │    │   │
│  │  │  界面   │ │  界面   │ │  界面   │ │  界面   │ │  界面   │    │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │   │
│  │                         状态栏 (连接状态)                         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Core Layer (核心逻辑层)                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │   │
│  │  │ 配置管理器   │  │ 连接管理器   │  │ Agent 运行器 │               │   │
│  │  │ ConfigMgr   │  │ ConnManager │  │ AgentRunner │               │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                   Communication Layer (通信层)                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐  │   │
│  │  │              librustdesk (通信协议封装)                       │  │   │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │  │   │
│  │  │  │Rendezvous│  │  P2P    │  │  文件    │  │  屏幕   │        │  │   │
│  │  │  │ 连接器   │  │ 通道    │  │  传输    │  │  捕获   │        │  │   │
│  │  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │  │   │
│  │  └─────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Platform Layer (平台适配层)                     │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                          │   │
│  │  │ Windows │  │  macOS  │  │  Linux  │                          │   │
│  │  │ 适配器   │  │  适配器  │  │  适配器  │                          │   │
│  │  └─────────┘  └─────────┘  └─────────┘                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Workspace 结构

```
nuwax-agent/
├── Cargo.toml                    # workspace 配置
├── crates/
│   ├── agent-client/             # 客户端主程序 (bin + lib)
│   │   ├── src/
│   │   │   ├── main.rs           # 程序入口
│   │   │   ├── lib.rs            # 库入口
│   │   │   ├── app.rs            # 应用状态管理
│   │   │   ├── ui/               # UI 组件
│   │   │   ├── core/             # 核心逻辑
│   │   │   └── platform/         # 平台适配
│   │   └── Cargo.toml
│   │
│   ├── agent-server-admin/       # 服务端管理程序
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── api/              # HTTP API
│   │   │   ├── sse/              # SSE 推送
│   │   │   └── client_manager/   # 客户端管理
│   │   └── Cargo.toml
│   │
│   ├── data-server/              # 数据中转服务
│   │   ├── src/
│   │   │   └── main.rs           # 基于 rustdesk-server 封装
│   │   └── Cargo.toml
│   │
│   └── agent-protocol/           # 共享协议定义
│       ├── proto/                # protobuf 定义文件
│       │   ├── message.proto     # 消息定义
│       │   └── common.proto      # 公共类型
│       ├── src/
│       │   ├── lib.rs
│       │   └── generated/        # 生成的 Rust 代码
│       └── Cargo.toml
│
├── vendors/                      # 依赖的外部项目
│   ├── nuwax-rustdesk/           # fork 的 rustdesk
│   ├── rustdesk-server/          # fork 的 rustdesk-server
│   ├── gpui-component/           # UI 组件库
│   ├── rcoder/                   # agent_runner 复用
│   ├── auto-launch/              # 自启动
│   ├── tray-icon/                # 系统托盘
│   ├── enigo/                    # 输入模拟
│   └── cargo-packager/           # 打包工具
│
└── specs/                        # 设计文档
```

---

## 3. 复用现有库的策略

### 3.1 librustdesk 复用策略

`nuwax-rustdesk` 已配置为可输出 rlib：

```toml
[lib]
name = "librustdesk"
crate-type = ["cdylib", "staticlib", "rlib"]
```

**复用方式：作为 path 依赖引入**

```toml
# crates/agent-client/Cargo.toml
[dependencies]
librustdesk = { path = "../../vendors/nuwax-rustdesk" }
```

**需要从 librustdesk 复用的核心模块：**

| 模块 | 路径 | 用途 |
|------|------|------|
| rendezvous_mediator | `src/rendezvous_mediator.rs` | 与 data-server 建立连接 |
| client | `src/client.rs` | 远程连接管理 |
| ipc | `src/ipc.rs` | 进程间通信 |
| platform | `src/platform/` | 平台适配（权限、截图等） |
| hbb_common | `libs/hbb_common/` | 协议、配置、工具函数 |
| scrap | `libs/scrap/` | 屏幕捕获 |
| enigo | `libs/enigo/` | 输入模拟 |

**改造建议：**

在 `vendors/nuwax-rustdesk` 中添加 feature 来控制暴露的模块：

```toml
[features]
default = []
# 只暴露通信层，不包含 UI
communication-only = []
# 作为 lib 使用，暴露核心 API
as-library = []
```

### 3.2 agent_runner 复用策略

从 `vendors/rcoder/crates/agent_runner` 复用 Agent 执行逻辑：

```toml
# crates/agent-client/Cargo.toml
[dependencies]
agent_runner = { path = "../../vendors/rcoder/crates/agent_runner" }
```

**复用的核心能力：**
- ACP 协议客户端
- Agent 生命周期管理（创建、执行、销毁）
- Agent 闲置自动销毁逻辑
- 任务执行状态追踪

### 3.3 gpui-component 复用策略

```toml
# crates/agent-client/Cargo.toml
[dependencies]
gpui-component = { path = "../../vendors/gpui-component/crates/ui" }
gpui = { git = "https://github.com/zed-industries/zed" }
```

**需要使用的核心组件：**

| 组件 | 用途 |
|------|------|
| `Root` | 窗口根视图 |
| `TabPanel` | Tab 切换 |
| `Input` | 输入框（密码配置等） |
| `Button` | 按钮 |
| `Modal` / `Dialog` | 对话框 |
| `Notification` | 通知提示 |
| `StatusBar` | 状态栏（可自定义） |
| `Icon` | 图标 |
| `Theme` | 主题系统 |

---

## 4. 核心 Trait 和 Struct 设计

### 4.1 应用状态管理

```rust
/// 全局应用状态
pub struct AppState {
    /// 客户端唯一 ID（由 data-server 分配）
    pub client_id: Option<String>,
    /// 连接密码
    pub password: String,
    /// 连接状态
    pub connection_status: ConnectionStatus,
    /// 当前配置
    pub config: AppConfig,
    /// Agent 运行状态
    pub agent_status: AgentStatus,
}

/// 连接状态枚举
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected { server_addr: String },
    Error { message: String },
}

/// Agent 运行状态
pub enum AgentStatus {
    Idle,
    Running { task_id: String },
    Paused,
}
```

### 4.2 配置管理

```rust
/// 应用配置
pub struct AppConfig {
    /// data-server 地址列表
    pub relay_servers: Vec<String>,
    /// ID 服务器地址
    pub id_server: String,
    /// 开机自启动
    pub auto_launch: bool,
    /// 工作目录
    pub work_dir: PathBuf,
    /// 主题
    pub theme: ThemeMode,
    /// 语言
    pub language: String,
}

/// 配置管理器 trait
pub trait ConfigManager: Send + Sync {
    /// 加载配置
    fn load(&self) -> Result<AppConfig>;
    /// 保存配置
    fn save(&self, config: &AppConfig) -> Result<()>;
    /// 获取配置文件路径
    fn config_path(&self) -> PathBuf;
}
```

### 4.3 连接管理

```rust
/// 连接管理器 trait
#[async_trait]
pub trait ConnectionManager: Send + Sync {
    /// 连接到 data-server
    async fn connect(&mut self, server_addr: &str) -> Result<()>;
    /// 断开连接
    async fn disconnect(&mut self) -> Result<()>;
    /// 获取连接状态
    fn status(&self) -> ConnectionStatus;
    /// 获取分配的客户端 ID
    fn client_id(&self) -> Option<&str>;
    /// 发送消息
    async fn send_message(&self, msg: ProtocolMessage) -> Result<()>;
    /// 接收消息（返回消息流）
    fn message_stream(&self) -> impl Stream<Item = ProtocolMessage>;
}

/// 基于 librustdesk 的连接管理器实现
pub struct RustdeskConnectionManager {
    // 内部使用 librustdesk 的连接逻辑
    inner: Option<RendezvousMediator>,
    status: Arc<RwLock<ConnectionStatus>>,
    client_id: Option<String>,
}
```

### 4.4 Agent 运行器适配

```rust
/// Agent 运行器 trait（适配 rcoder 的 agent_runner）
#[async_trait]
pub trait AgentExecutor: Send + Sync {
    /// 启动 Agent 执行任务
    async fn execute(&self, task: AgentTask) -> Result<TaskHandle>;
    /// 取消任务
    async fn cancel(&self, task_id: &str) -> Result<()>;
    /// 获取任务状态
    async fn status(&self, task_id: &str) -> Result<TaskStatus>;
    /// 订阅任务进度
    fn subscribe_progress(&self, task_id: &str) -> impl Stream<Item = ProgressEvent>;
}

/// Agent 任务
pub struct AgentTask {
    pub task_id: String,
    pub prompt: String,
    pub context: Option<TaskContext>,
}

/// 任务进度事件
pub enum ProgressEvent {
    Started,
    Progress { message: String, percent: Option<f32> },
    Output { content: String },
    Completed { result: TaskResult },
    Failed { error: String },
}
```

### 4.5 UI 视图 trait

```rust
/// 可切换的面板视图 trait
pub trait PanelView: Render {
    /// 面板标识
    fn panel_id(&self) -> &'static str;
    /// 面板标题
    fn title(&self, cx: &AppContext) -> String;
    /// 面板图标
    fn icon(&self) -> IconName;
    /// 是否可通过 feature 控制
    fn feature_flag(&self) -> Option<&'static str> {
        None
    }
}

/// 主要的面板类型
pub enum PanelType {
    ClientInfo,     // ID/密码界面
    Settings,       // 设置界面
    Chat,           // Agent 聊天界面（可选 feature）
    Permissions,    // 权限设置界面
    About,          // 关于界面
}
```

### 4.6 平台适配 trait

```rust
/// 平台适配层 trait
pub trait PlatformAdapter: Send + Sync {
    /// 检查屏幕录制权限
    fn check_screen_capture_permission(&self) -> PermissionStatus;
    /// 请求屏幕录制权限
    fn request_screen_capture_permission(&self) -> Result<()>;
    /// 检查辅助功能权限（用于输入模拟）
    fn check_accessibility_permission(&self) -> PermissionStatus;
    /// 请求辅助功能权限
    fn request_accessibility_permission(&self) -> Result<()>;
    /// 获取系统信息
    fn system_info(&self) -> SystemInfo;
    /// 设置开机自启动
    fn set_auto_launch(&self, enabled: bool) -> Result<()>;
}

/// 权限状态
pub enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
}
```

---

## 5. 通信协议设计

### 5.1 Protobuf 消息结构

```protobuf
// proto/message.proto
syntax = "proto3";
package nuwax.agent;

// 协议版本
message ProtocolVersion {
  uint32 major = 1;
  uint32 minor = 2;
  uint32 patch = 3;
}

// 消息包装器
message Message {
  ProtocolVersion version = 1;
  string message_id = 2;
  int64 timestamp = 3;

  oneof payload {
    // 连接相关
    HandshakeRequest handshake_request = 10;
    HandshakeResponse handshake_response = 11;
    HeartbeatPing heartbeat_ping = 12;
    HeartbeatPong heartbeat_pong = 13;

    // Agent 任务相关
    TaskRequest task_request = 20;
    TaskResponse task_response = 21;
    TaskProgress task_progress = 22;
    TaskCancel task_cancel = 23;

    // 文件传输
    FileTransferRequest file_request = 30;
    FileTransferChunk file_chunk = 31;
    FileTransferComplete file_complete = 32;

    // 远程桌面
    ScreenCaptureData screen_data = 40;
    InputEvent input_event = 41;
  }
}

// 握手请求
message HandshakeRequest {
  string client_id = 1;        // 可选，首次连接时为空
  string password = 2;
  ClientInfo client_info = 3;
}

// 客户端信息
message ClientInfo {
  string os = 1;
  string os_version = 2;
  string app_version = 3;
  string hostname = 4;
}

// 任务请求
message TaskRequest {
  string task_id = 1;
  string prompt = 2;
  map<string, string> context = 3;
}

// 任务进度
message TaskProgress {
  string task_id = 1;
  ProgressType type = 2;
  string message = 3;
  float percent = 4;  // 0.0 - 1.0
}

enum ProgressType {
  STARTED = 0;
  RUNNING = 1;
  OUTPUT = 2;
  COMPLETED = 3;
  FAILED = 4;
  CANCELLED = 5;
}
```

### 5.2 大消息分片机制

```protobuf
// 文件传输分片
message FileTransferChunk {
  string transfer_id = 1;
  string file_path = 2;
  uint64 total_size = 3;
  uint32 chunk_index = 4;
  uint32 total_chunks = 5;
  bytes data = 6;
  string checksum = 7;  // 当前块的校验和
}
```

---

## 6. Features 设计

### 6.1 agent-client features

```toml
[features]
default = ["tray", "auto-launch"]

# 开发者模式：详细日志 + 日志文件输出
dev-mode = []

# 系统托盘支持
tray = ["dep:tray-icon", "dep:muda"]

# 开机自启动
auto-launch = ["dep:auto-launch"]

# Agent 聊天界面（可选功能）
chat-ui = []

# 远程桌面功能
remote-desktop = ["dep:librustdesk/scrap"]

# 硬件编解码（可选，提升性能）
hwcodec = ["librustdesk/hwcodec"]
```

### 6.2 构建配置

```toml
# 完整功能构建
[profile.release]
lto = true
codegen-units = 1
panic = 'abort'
strip = true

# 调试构建
[profile.dev]
opt-level = 0
debug = true
```

---

## 7. 日志系统设计

### 7.1 日志层级

```rust
/// 日志配置
pub struct LogConfig {
    /// 日志级别
    pub level: LogLevel,
    /// 是否输出到控制台
    pub console_output: bool,
    /// 是否输出到文件
    pub file_output: bool,
    /// 日志目录
    pub log_dir: PathBuf,
    /// 单文件最大大小（MB）
    pub max_file_size_mb: u32,
    /// 保留的日志文件数量
    pub max_files: u32,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            level: if cfg!(feature = "dev-mode") {
                LogLevel::Debug
            } else {
                LogLevel::Info
            },
            console_output: cfg!(feature = "dev-mode"),
            file_output: cfg!(feature = "dev-mode"),
            log_dir: dirs::data_local_dir()
                .unwrap_or_default()
                .join("nuwax-agent/logs"),
            max_file_size_mb: 10,
            max_files: 5,
        }
    }
}
```

### 7.2 敏感信息脱敏

```rust
/// 日志脱敏 trait
pub trait LogSanitizer {
    fn sanitize(&self) -> String;
}

impl LogSanitizer for Message {
    fn sanitize(&self) -> String {
        // 对密码、token 等敏感字段进行脱敏处理
        // password: "xxx" -> password: "***"
    }
}
```

---

## 8. 错误处理设计

遵循 Fail Fast 原则：

```rust
/// 应用错误类型
#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("Connection failed: {0}")]
    ConnectionError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Permission denied: {0}")]
    PermissionError(String),

    #[error("Agent execution failed: {0}")]
    AgentError(String),

    #[error("Protocol error: {0}")]
    ProtocolError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// 统一结果类型
pub type AppResult<T> = Result<T, AppError>;
```

---

## 9. 安全考量

### 9.1 密钥存储

- 使用操作系统的密钥链存储敏感信息
  - macOS: Keychain
  - Windows: Credential Manager
  - Linux: Secret Service (libsecret)

### 9.2 通信安全

- 使用 TLS 加密所有网络通信
- 密码在本地使用 bcrypt 哈希存储
- 支持端到端加密（复用 rustdesk 的加密机制）

### 9.3 代码安全

- 禁止 unsafe 代码（除 FFI 调用外）
- 使用 DashMap 替代 `Arc<RwLock<HashMap>>` 避免死锁
- 所有外部输入进行验证和清理

---

## 10. 参考资源

### 技术文档
- [A 2025 Survey of Rust GUI Libraries](https://www.boringcactus.com/2025/04/13/2025-survey-of-rust-gui-libraries.html)
- [Are we GUI yet?](https://areweguiyet.com/)
- [GPUI Documentation](https://gpui.rs)
- [The state of Rust GUI libraries - LogRocket Blog](https://blog.logrocket.com/state-rust-gui-libraries/)

### 本地参考源码
- `vendors/nuwax-rustdesk` - 通信层参考
- `vendors/gpui-component` - UI 组件库
- `vendors/rcoder/crates/agent_runner` - Agent 执行器
- `vendors/rustdesk-server` - 服务端参考
- `vendors/auto-launch` - 自启动实现
- `vendors/tray-icon` - 系统托盘实现

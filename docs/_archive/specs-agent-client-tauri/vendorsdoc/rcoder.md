# rcoder

## 项目概述

基于 ACP (Agent Protocol) 协议的 AI 代理开发平台，提供 Docker 容器化运行时和反向代理。本项目的核心模块 `agent_runner` 提供了完整的 Agent 生命周期管理能力，包括 Docker 容器管理、消息收发、超时自动销毁等功能。

**本地路径**: `vendors/rcoder`

## 目录结构

```
rcoder/
├── Cargo.toml                    # workspace 配置
├── crates/
│   ├── rcoder/                   # 主应用服务
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── main.rs
│   │   │   ├── app.rs            # 应用主逻辑
│   │   │   ├── router.rs         # HTTP 路由
│   │   │   ├── state.rs          # 应用状态
│   │   │   ├── error.rs          # 错误处理
│   │   │   └── middlewares/      # 中间件
│   │   └── Cargo.toml
│   │
│   ├── agent_runner/             # Agent 运行时核心（最重要）
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── manager.rs        # AgentWorkerManager
│   │   │   ├── worker.rs         # Agent Worker
│   │   │   ├── adapter.rs        # ACP 协议适配器
│   │   │   ├── types.rs          # 类型定义
│   │   │   ├── message.rs        # 消息处理
│   │   │   └── docker.rs         # Docker 集成
│   │   └── Cargo.toml
│   │
│   ├── docker_manager/           # Docker 容器管理
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── manager.rs        # DockerManager
│   │   │   ├── actor.rs          # Actor 模式状态
│   │   │   ├── container.rs      # 容器操作
│   │   │   └── network.rs        # 网络管理
│   │   └── Cargo.toml
│   │
│   ├── acp_adapter/              # ACP 协议适配器
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── types.rs          # ACP 类型定义
│   │   │   ├── client.rs         # ACP 客户端
│   │   │   └── handler.rs        # 消息处理
│   │   └── Cargo.toml
│   │
│   ├── shared_types/             # 共享类型定义
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── proto/            # gRPC proto 文件
│   │   │   │   └── agent.proto
│   │   │   └── types.rs
│   │   └── Cargo.toml
│   │
│   └── rcoder-proxy/             # 反向代理
│       ├── src/
│       │   ├── lib.rs
│       │   ├── proxy.rs
│       │   └── upstream.rs
│       └── Cargo.toml
└── Cargo.lock
```

## Agent Worker Manager (agent_runner)

这是 rcoder 的核心模块，负责管理 agent 的生命周期。

### 核心结构体

```rust
// crates/agent_runner/src/manager.rs

use tokio::sync::{mpsc, watch};
use std::sync::{Arc, Mutex};
use chrono::DateTime;
use dashmap::DashMap;

pub struct AgentWorkerManager {
    // 任务发送器（使用 ArcSwap 支持热更新）
    sender: ArcSwap<Option<mpsc::UnboundedSender<LocalSetAgentRequest>>>,

    // 状态广播
    state_tx: watch::Sender<WorkerState>,

    // 最后心跳时间
    last_heartbeat: Arc<Mutex<Option<DateTime<Utc>>>>,

    // 状态变化时间
    last_state_change: Arc<Mutex<DateTime<Utc>>>,

    // 活跃请求追踪
    active_requests: Arc<DashMap<String, DateTime<Utc>>>,

    // 配置
    config: AgentRunnerConfig,
}

// Worker 状态
pub enum WorkerState {
    Starting,
    Running,
    Stopping,
    Stopped,
}

impl Default for WorkerState {
    fn default() -> Self {
        WorkerState::Stopped
    }
}
```

### 心跳超时检测

```rust
// crates/agent_runner/src/manager.rs

impl AgentWorkerManager {
    /// 检查心跳是否超时
    pub fn check_heartbeat_timeout(&self) -> bool {
        let last_heartbeat_opt = {
            let last = self.last_heartbeat.lock().expect("mutex poisoned");
            *last  // Copy 数据，立即释放锁
        };

        if let Some(timestamp) = last_heartbeat_opt {
            // 正常运行时：15秒无心跳视为超时
            let elapsed = Utc::now() - timestamp;
            elapsed.num_seconds() > 15
        } else {
            // 首次启动：30秒内未收到心跳视为超时
            let state_change = self.last_state_change.lock().expect("mutex poisoned");
            let elapsed = Utc::now() - *state_change;
            elapsed.num_seconds() > 30
        }
    }

    /// 更新心跳时间
    pub fn update_heartbeat(&self) {
        let mut last = self.last_heartbeat.lock().expect("mutex poisoned");
        *last = Some(Utc::now());
    }
}
```

### Agent Worker 核心逻辑

```rust
// crates/agent_runner/src/worker.rs

pub struct AgentWorker {
    config: AgentRunnerConfig,
    receiver: mpsc::UnboundedReceiver<LocalSetAgentRequest>,
    state_tx: watch::Sender<WorkerState>,
    docker: DockerManager,
    adapter: ACPAdapter,
}

impl AgentWorker {
    pub async fn run(&mut self) {
        tracing::info!("AgentWorker started");
        self.state_tx.send(WorkerState::Running).unwrap();

        loop {
            tokio::select! {
                Some(request) = self.receiver.recv() => {
                    self.handle_request(request).await;
                }
                _ = self.docker.health_check() => {
                    // Docker 健康检查
                }
            }
        }
    }

    async fn handle_request(&mut self, request: LocalSetAgentRequest) {
        match request {
            LocalSetAgentRequest::Message { session_id, content } => {
                self.handle_message(&session_id, &content).await;
            }
            LocalSetAgentRequest::Stop => {
                self.shutdown().await;
                return;
            }
            LocalSetAgentRequest::Spawn { config } => {
                self.spawn_container(&config).await;
            }
        }
    }

    /// 启动 Docker 容器
    async fn spawn_container(&mut self, config: &AgentConfig) -> Result<(), AgentError> {
        // 1. 创建容器
        let container_id = self.docker.create_container(CreateContainerOptions {
            image: config.image.clone(),
            env: config.env_vars.clone(),
            Cmd: config.command.clone().unwrap_or_else(|| vec!["/bin/sh"]),
            ..Default::default()
        }).await?;

        // 2. 启动容器
        self.docker.start_container(&container_id).await?;

        // 3. 等待容器就绪
        self.docker.wait_until_ready(&container_id).await?;

        // 4. 建立 ACP 连接
        self.adapter.connect(&container_id, config.acp_url).await?;

        Ok(())
    }
}
```

### ACP 协议消息类型

```rust
// crates/agent_runner/src/types.rs

use agent_client_protocol::{Message, MessageChunk};

// ACP 流更新事件
pub enum StreamUpdate {
    UserMessageChunk {
        session_id: String,
        content: String,
    },
    AgentMessageChunk {
        session_id: String,
        content: String,
    },
    ToolCall {
        session_id: String,
        tool_call: ToolCall,
    },
    ToolCallUpdate {
        session_id: String,
        tool_call_update: ToolCallUpdate,
    },
    SessionStateChanged {
        session_id: String,
        new_state: SessionState,
        message: String,
    },
    Plan {
        session_id: String,
        plan: Plan,
    },
    StepFinished {
        session_id: String,
        step_id: String,
    },
    SessionFinished {
        session_id: String,
        reason: String,
    },
}

pub enum SessionState {
    Initializing,
    Connected,
    Prompting,
    Paused,
    Closed,
    Error(String),
}

pub struct Plan {
    pub entries: Vec<PlanEntry>,
    pub created_at: SystemTime,
    pub status: PlanStatus,
}

pub enum PlanStatus {
    Pending,
    Approved,
    Executing,
    Finished,
    Cancelled,
}

pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

pub struct ToolCallUpdate {
    pub id: String,
    pub status: ToolCallStatus,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

pub enum ToolCallStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}
```

## Docker Manager (docker_manager)

Docker 容器管理模块，使用 Actor 模式管理容器状态，避免并发问题。

### 核心结构体

```rust
// crates/docker_manager/src/manager.rs

use bollard::{Docker, APIError};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct DockerManager {
    docker: Docker,                              // Docker 客户端
    config: DockerManagerConfig,                 // 配置
    containers: ContainerStateHandle,            // Actor 模式状态
    main_network_name: Arc<RwLock<String>>,     // 网络名称
}

pub struct DockerManagerConfig {
    pub socket_path: Option<String>,             // Docker socket 路径
    pub network_name: String,                    // 网络名称
    pub max_containers: usize,                   // 最大容器数
    pub container_ttl: Duration,                 // 容器存活时间
    pub auto_remove: bool,                       // 是否自动删除
}
```

### Actor 模式状态管理

```rust
// crates/docker_manager/src/container_state_actor.rs

// 使用 Actor 模式避免 DashMap 跨 await 持有锁导致的死锁
pub struct ContainerStateActor {
    containers: HashMap<String, DockerContainerInfo>,
    receiver: mpsc::Receiver<ContainerStateCommand>,
}

pub enum ContainerStateCommand {
    Get { key: String, reply: oneshot::Sender<Option<DockerContainerInfo>> },
    Insert { key: String, info: DockerContainerInfo },
    Remove { key: String, reply: oneshot::Sender<Option<DockerContainerInfo>> },
    List { reply: oneshot::Sender<Vec<DockerContainerInfo>> },
    Keys { reply: oneshot::Sender<Vec<String>> },
    RemoveIfContainerId { key: String, container_id: String, reply: oneshot::Sender<Option<DockerContainerInfo>> },
}

impl ContainerStateActor {
    pub async fn run(&mut self) {
        while let Some(cmd) = self.receiver.recv().await {
            match cmd {
                ContainerStateCommand::Get { key, reply } => {
                    let info = self.containers.get(&key).cloned();
                    reply.send(info).ok();
                }
                ContainerStateCommand::Insert { key, info } => {
                    self.containers.insert(key, info);
                }
                // ... 其他命令处理
            }
        }
    }
}
```

### 容器创建流程

```rust
// crates/docker_manager/src/manager.rs

impl DockerManager {
    pub async fn create_container(
        &self,
        config: DockerContainerConfig,
    ) -> DockerResult<DockerContainerInfo> {
        let container_name = format!("{}-{}", self.config.network_name, config.name);

        // 1. 清理同名旧容器
        if let Ok(Some((existing_id, _, status, is_running))) =
            self.find_container_realtime(&container_name).await
        {
            if is_running {
                self.stop_container_by_id(&existing_id).await?;
            }
            self.remove_container_by_id(&existing_id).await?;
        }

        // 2. 拉取镜像
        self.ensure_image_exists(&config.image).await?;

        // 3. 构建挂载点
        let mut mounts = Vec::new();
        if !config.host_path.is_empty() {
            mounts.push(Mount {
                target: Some(config.container_path.clone()),
                source: Some(config.host_path.clone()),
                typ: Some(MountTypeEnum::BIND),
                read_only: Some(false),
                ..Default::default()
            });
        }

        // 4. 构建环境变量
        let mut env_vars: Vec<String> = config.env_vars
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();

        // 5. 构建网络配置
        let (networking_config, container_network_name) = if config.network_mode != "host" {
            let main_network = self.get_main_network_name().await;
            let mut endpoints = HashMap::new();
            endpoints.insert(main_network.clone(), EndpointSettings {
                aliases: Some(vec![container_name.clone()]),
                ..Default::default()
            });
            (Some(NetworkingConfig { endpoints_config: Some(endpoints) }), main_network)
        } else {
            (None, "host".to_string())
        };

        // 6. 创建并启动容器
        let container_config = ContainerConfig {
            image: config.image.clone(),
            env: Some(env_vars),
            cmd: config.command.map(|c| vec![c]),
            host_config: Some(HostConfig {
                mounts: Some(mounts),
                network_mode: Some(container_network_name),
                auto_remove: Some(self.config.auto_remove),
                ..Default::default()
            }),
            ..Default::default()
        };

        let response = self.docker.create_container(
            Some(CreateContainerOptions {
                name: container_name.clone(),
                ..Default::default()
            }),
            container_config,
        ).await?;

        self.docker.start_container(&response.id, None::<StartContainerOptions>).await?;

        // 7. 健康检查
        self.check_container_health(&response.id).await?;

        // 8. 获取容器信息
        let inspect = self.docker.inspect_container(&response.id, None).await?;

        Ok(DockerContainerInfo {
            id: response.id,
            name: container_name,
            image: config.image,
            status: "running".to_string(),
            ip_address: inspect.network_settings?.ip_address,
            created_at: Utc::now(),
        })
    }

    /// 等待容器就绪
    pub async fn wait_until_ready(&self, container_id: &str) -> Result<(), DockerError> {
        let timeout = Duration::from_secs(60);
        let start_time = Utc::now();

        loop {
            // 检查容器状态
            let info = self.inspect_container(container_id).await?;
            if info.state.as_ref().map(|s| &s.status) == Some(&ContainerStateStatusEnum::RUNNING) {
                // 检查健康检查
                if let Some(health) = &info.state.as_ref().unwrap().healthcheck {
                    if health.status == ContainerHealthStatusEnum::HEALTHY {
                        return Ok(());
                    }
                } else {
                    return Ok(());
                }
            }

            // 超时检查
            if (Utc::now() - start_time).num_seconds() > timeout.as_secs() as i64 {
                return Err(DockerError::Timeout);
            }

            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
}
```

## 超时自动销毁机制

```rust
// crates/agent_runner/src/proxy_agent/cleanup_task.rs

pub struct CleanupConfig {
    pub idle_timeout: Duration,       // 闲置超时（默认3分钟）
    pub cleanup_interval: Duration,   // 清理间隔（默认30秒）
}

impl Default for CleanupConfig {
    fn default() -> Self {
        Self {
            idle_timeout: Duration::from_secs(3 * 60),  // 3分钟
            cleanup_interval: Duration::from_secs(30),  // 30秒
        }
    }
}

// 清理逻辑：基于 RAII 模式
async fn cleanup_idle_agents(&mut self) -> Result<CleanupStats> {
    for entry in AGENT_REGISTRY.iter_agents() {
        let agent_info = entry.value();

        // 只清理 Idle 状态的 agent
        if agent_info.status == AgentStatus::Idle
            && self.is_agent_idle_timeout(agent_info.last_activity, current_time)
        {
            // 从 Registry 中移除，AgentLifecycleGuard 自动清理资源
            AGENT_REGISTRY.remove_by_project(project_id);
        }
    }
}
```

## 环境变量和 PATH 管理

```rust
// crates/agent_runner/src/docker.rs

pub fn build_environment(
    node_path: &Path,
    npm_global_path: &Path,
    extra_env: &HashMap<String, String>,
) -> Vec<String> {
    let mut env = vec![
        // Node.js 环境
        format!("PATH={}:{}:{}",
            node_path.join("bin").to_string_lossy(),
            npm_global_path.join("bin").to_string_lossy(),
            std::env::var("PATH").unwrap_or_default()
        ),
        format!("NODE_PATH={}", node_path.join("lib").to_string_lossy()),
        format!("NPM_CONFIG_PREFIX={}", npm_global_path.to_string_lossy()),
    ];

    // 添加额外的环境变量
    for (k, v) in extra_env {
        env.push(format!("{}={}", k, v));
    }

    env
}

// 在容器启动时设置环境变量
pub async fn start_container_with_env(
    &self,
    config: &AgentConfig,
) -> Result<String, AgentError> {
    let env = build_environment(
        &config.node_path,
        &config.npm_global_path,
        &config.extra_env,
    );

    let container_id = self.docker.create_container(CreateContainerOptions {
        image: config.image.clone(),
        env: Some(env),
        Cmd: config.command.clone().unwrap_or_default(),
        ..Default::default()
    }).await?;

    self.docker.start_container(&container_id, None).await?;
    Ok(container_id)
}
```

## Node.js 自动安装

```rust
// crates/agent_runner/src/installer/node_installer.rs

pub struct NodeInstaller {
    install_dir: PathBuf,
    platform: Platform,
}

pub enum Platform {
    Windows,
    MacOSIntel,
    MacOSAppleSilicon,
    Linux,
}

impl NodeInstaller {
    /// 检测系统是否已有 Node.js
    pub async fn detect_system_node(&self) -> Option<Version> {
        // 检查系统 PATH
        if let Ok(path) = which("node") {
            if let Ok(output) = Command::new(&path)
                .arg("--version")
                .output()
                .await
            {
                if output.status.success() {
                    let version_str = String::from_utf8_lossy(&output.stdout);
                    return Version::parse(&version_str.trim_start_matches('v')).ok();
                }
            }
        }
        None
    }

    /// 下载并安装 Node.js
    pub async fn download_and_install(&self, version: &Version) -> Result<(), InstallationError> {
        let url = self.get_download_url(version);
        let archive_path = self.install_dir.join("cache").join(format!("node-{}.tar.xz", version));

        // 1. 下载
        if !archive_path.exists() {
            self.download(&url, &archive_path).await?;
        }

        // 2. 解压
        let extract_dir = self.install_dir.join("node").join(version.to_string());
        self.extract(&archive_path, &extract_dir).await?;

        // 3. 创建 symlink
        let bin_path = extract_dir.join("bin");
        let symlink_path = self.install_dir.join("bin").join("node");
        if symlink_path.exists() {
            std::fs::remove_file(&symlink_path)?;
        }
        std::os::unix::fs::symlink(&bin_path.join("node"), &symlink_path)?;

        Ok(())
    }

    fn get_download_url(&self, version: &Version) -> String {
        match self.platform {
            Platform::Windows => format!(
                "https://nodejs.org/dist/v{}/node-v{}-win-x64.zip",
                version, version
            ),
            Platform::MacOSIntel => format!(
                "https://nodejs.org/dist/v{}/node-v{}-darwin-x64.tar.gz",
                version, version
            ),
            Platform::MacOSAppleSilicon => format!(
                "https://nodejs.org/dist/v{}/node-v{}-darwin-arm64.tar.gz",
                version, version
            ),
            Platform::Linux => format!(
                "https://nodejs.org/dist/v{}/node-v{}-linux-x64.tar.xz",
                version, version
            ),
        }
    }
}
```

## ACP 协议适配器

```rust
// crates/acp_adapter/src/client.rs

use agent_client_protocol::{Client, Message as AcpMessage};

pub struct ACPAdapter {
    client: Option<Client<WebSocketStream<Upgraded>>>,
    session_id: String,
    pending_requests: Arc<DashMap<String, oneshot::Sender<Result<String>>>>,
}

impl ACPAdapter {
    /// 连接到 Agent 容器
    pub async fn connect(
        &mut self,
        container_id: &str,
        url: &str,
    ) -> Result<(), AdapterError> {
        // 获取容器 IP
        let container_ip = self.get_container_ip(container_id).await?;

        // 建立 WebSocket 连接
        let stream = WebSocket::connect(url).await?;
        let (ws_stream, _) = stream.split();
        let (write, read) = ws_stream.split();

        // 创建 ACP 客户端
        self.client = Some(Client::new(read, write));

        // 生成会话 ID
        self.session_id = uuid::Uuid::new_v4().to_string();

        Ok(())
    }

    /// 发送消息
    pub async fn send_message(&self, session_id: &str, content: &str) {
        if let Some(client) = &self.client {
            let message = AcpMessage::user_message_chunk(session_id, content);
            client.send(message).await;
        }
    }

    /// 接收消息
    pub async fn receive(&self) -> Option<StreamUpdate> {
        if let Some(client) = &self.client {
            if let Some(msg) = client.recv().await {
                Some(self.convert_message(msg))
            } else {
                None
            }
        } else {
            None
        }
    }
}
```

## 在本项目中的使用

### Agent 依赖管理界面

```rust
// agent-client/src/ui/dependency_management.rs

use crate::agent::AgentManager;

pub struct DependencyManager {
    agent_manager: Arc<AgentManager>,
    node_installer: Arc<NodeInstaller>,
}

impl DependencyManager {
    /// 检查所有依赖状态
    pub async fn check_all_dependencies(&self) -> Vec<DependencyStatus> {
        let mut statuses = vec![];

        // 检查 Node.js
        statuses.push(self.check_node().await);

        // 检查 npm
        statuses.push(self.check_npm().await);

        // 检查 opencode
        statuses.push(self.check_agent("opencode").await);

        // 检查 claude-code
        statuses.push(self.check_agent("@anthropic-ai/claude-code").await);

        statuses
    }

    async fn check_node(&self) -> DependencyStatus {
        // 1. 先检查系统全局
        if let Some(version) = self.node_installer.detect_system_node().await {
            return DependencyStatus {
                name: "Node.js",
                version: Some(version.to_string()),
                source: DependencySource::System,
                status: DependencyStatus::Installed,
                action: None,
            };
        }

        // 2. 检查客户端目录
        if let Some(version) = self.detect_local_node().await {
            return DependencyStatus {
                name: "Node.js",
                version: Some(version.to_string()),
                source: DependencySource::Local,
                status: DependencyStatus::Installed,
                action: Some(DependencyAction::Update),
            };
        }

        // 3. 未安装
        DependencyStatus {
            name: "Node.js",
            version: None,
            source: DependencySource::None,
            status: DependencyStatus::NotInstalled,
            action: Some(DependencyAction::Install),
        }
    }
}

pub enum DependencySource {
    System,
    Local,
    None,
}

pub enum DependencyStatus {
    Installed,
    Installing,
    Failed,
    NotInstalled,
    NeedsUpdate,
}
```

### 安装目录结构

```
<APP_DATA_DIR>/                  # 客户端应用数据目录
├── tools/
│   ├── node/                    # Node.js 安装目录
│   │   ├── v20.10.0/
│   │   │   ├── bin/
│   │   │   │   ├── node
│   │   │   │   └── npm
│   │   │   └── lib/
│   │   └── current -> v20.10.0  # 当前版本 symlink
│   ├── npm-global/              # npm 全局安装目录（隔离）
│   │   ├── bin/
│   │   │   ├── opencode
│   │   │   └── claude
│   │   └── lib/
│   └── versions.json            # 已安装工具的版本记录
├── config/                      # 配置文件
├── logs/                        # 日志文件
└── cache/                       # 缓存文件（下载的安装包等）
```

## 关键设计模式

1. **Actor 模式**: DockerManager 使用 Actor 模式管理容器状态，避免死锁
2. **ArcSwap**: 热更新配置而不需要重启
3. **DashMap**: 高并发场景下的线程安全 HashMap
4. **Watch 通道**: 状态变更广播
5. **RAII 清理**: Agent 闲置超时自动销毁
6. **隔离安装**: Node.js 和 Agent 工具安装到独立目录，不污染全局环境

## 可复用代码

| 模块 | 路径 | 用途 |
|------|------|------|
| **agent_runner** | `crates/agent_runner/` | Agent 生命周期管理 |
| **docker_manager** | `crates/docker_manager/` | Docker 容器操作 |
| **acp_adapter** | `crates/acp_adapter/` | ACP 协议客户端 |

## 与本项目的集成

```
agent-client
    │
    ├── UI 层
    │   ├── 依赖管理界面 (DataTable, Badge, Button)
    │   ├── 安装进度弹窗 (Dialog, Progress)
    │   └── 设置界面 (Form, Switch, Input)
    │
    └── Agent 运行时
        ├── rcoder/agent_runner    # Agent 生命周期管理
        │       │
        │       ├── Docker Manager  # 容器管理
        │       │       └── opencode 容器
        │       │
        │       └── ACP Adapter     # ACP 协议通信
        │               │
        │               └── opencode ACP 端口
        │
        └── Node.js 安装器          # 环境隔离安装
```

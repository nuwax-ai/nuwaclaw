# nuwax-rustdesk

## 项目概述

RustDesk 远程桌面客户端的定制版本，支持远程控制、文件传输、音视频服务、剪贴板同步等功能。作为本项目的核心通信库，提供双向通信、P2P 直连和中继传输能力。

**本地路径**: `vendors/nuwax-rustdesk`

## 目录结构

```
nuwax-rustdesk/
├── src/
│   ├── lib.rs                      # 库入口，导出公共API
│   ├── client.rs                   # 客户端连接处理核心模块
│   ├── server.rs                   # 服务端音视频/剪贴板/输入服务
│   ├── common.rs                   # 公共工具函数和类型定义
│   ├── rendezvous_mediator.rs      # 远程连接中介（核心）
│   ├── ipc.rs                      # 进程间通信
│   └── platform/                   # 平台特定代码
│       ├── linux/
│       ├── macos/
│       └── windows/
├── libs/
│   ├── hbb_common/                 # 通用工具库（最重要）
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── message_proto/      # protobuf 消息定义
│   │   │   ├── net/                # 网络相关（TCP/KCP/WebSocket）
│   │   │   ├── crypto/             # 加密模块
│   │   │   ├── config/             # 配置管理
│   │   │   └── util/               # 工具函数
│   │   └── Cargo.toml
│   ├── scrap/                      # 屏幕捕获库
│   ├── enigo/                      # 键盘鼠标模拟库
│   ├── clipboard/                  # 剪贴板库
│   └── virtual_display/            # 虚拟显示驱动
├── proto/                          # protobuf 协议定义
└── Cargo.toml                      # workspace 配置
```

## 核心通信架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       agent-client                               │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────────────────────┐   │
│  │  UI 界面        │     │  核心通信模块                    │   │
│  │  - 聊天窗口     │     │  - rendezvous_mediator (连接管理)│   │
│  │  - 设置界面     │     │  - client (数据收发)             │   │
│  │  - 依赖管理     │     │  - server (音视频服务)           │   │
│  └─────────────────┘     └─────────────────────────────────┘   │
│                                │                                 │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    data-server (rustdesk-server)                 │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │       hbbs          │    │       hbbr          │            │
│  │   (信令服务器)      │    │   (中继服务器)       │            │
│  │   - 端口: 21116     │    │   - 端口: 21117     │            │
│  │   - ID 注册        │    │   - 数据中继        │            │
│  │   - 连接协商       │    │   - 带宽限制        │            │
│  │   - NAT 穿透       │    │                     │            │
│  └─────────────────────┘    └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  agent-server-admin (管理端)                      │
└─────────────────────────────────────────────────────────────────┘
```

## 连接管理 (rendezvous_mediator.rs)

### 核心结构体

```rust
// src/rendezvous_mediator.rs

pub struct RendezvousMediator {
    addr: TargetAddr<'static>,
    host: String,
    host_prefix: String,
    keep_alive: i32,
}

impl RendezvousMediator {
    /// 启动连接管理器（根据配置选择 UDP 或 TCP 模式）
    pub async fn start(server: ServerPtr, host: String) -> ResultType<()> {
        log::info!("start rendezvous mediator of {}", host);

        // 根据配置选择通信模式
        if cfg!(debug_assertions) && option_env!("TEST_TCP").is_some()
            || Config::is_proxy()
            || use_ws()
            || crate::is_udp_disabled()
        {
            // WebSocket/代理模式
            Self::start_tcp(server, host).await
        } else {
            // UDP 直连模式
            Self::start_udp(server, host).await
        }
    }
}
```

### 双协议支持

```rust
// UDP 直连模式（优先使用，性能更好）
async fn start_udp(server: ServerPtr, host: String) -> ResultType<()> {
    // 注册超时管理
    const MIN_REG_TIMEOUT: i64 = 3_000;
    const MAX_REG_TIMEOUT: i64 = 30_000;
    let mut reg_timeout = MIN_REG_TIMEOUT;

    loop {
        // 心跳延迟计算（EMA 指数移动平均）
        if ema_latency == 0 {
            ema_latency = latency;
        } else {
            ema_latency = latency / 30 + (ema_latency * 29 / 30);
        }

        // 动态调整注册间隔
        let mut n = latency / 5;
        if n < 3000 { n = 3000; }

        // 心跳保活
        if !send_heartbeat(...).await {
            reg_timeout = (reg_timeout * 2).min(MAX_REG_TIMEOUT);
        }
    }
}

// TCP/WebSocket 模式（代理环境或 UDP 被禁用时）
async fn start_tcp(server: ServerPtr用于, host: String) -> ResultType<()> {
    // 建立 TCP 连接
    let mut socket = connect_tcp(&*self.host, CONNECT_TIMEOUT).await?;

    // 发送注册消息
    let mut msg_out = Message::new();
    let mut rr = RegisterRelay {
        socket_addr: socket_addr.into(),
        version: crate::VERSION.to_owned(),
        ..Default::default()
    };
    msg_out.set_register_relay(rr);
    socket.send(&msg_out).await?;

    // 处理中继响应
    if let Some(msg) = socket.next().await {
        let response = msg?.payload;
        // 建立中继连接...
    }
}
```

## P2P 直连流程 (打洞)

### 打洞请求处理

```rust
// src/rendezvous_mediator.rs

async fn handle_punch_hole(&self, ph: PunchHole, server: ServerPtr) -> ResultType<()> {
    // 1. 解析对端地址
    let mut peer_addr = AddrMangle::decode(&ph.socket_addr);

    // 2. 去重处理（100ms 内重复消息忽略）
    let last = *LAST_MSG.lock().await;
    if last.0 == peer_addr && last.1.elapsed().as_millis() < 100 {
        return Ok(());  // 忽略重复消息
    }

    // 3. 判断是否需要中继
    let relay = use_ws() || Config::is_proxy() || ph.force_relay;
    let nat_type = NatType::from_i32(Config::get_nat_type())?;

    // 对称型 NAT 或强制中继时降级到中继模式
    if nat_type == NatType::SYMMETRIC || relay || (config::is_disable_tcp_listen() && ph.udp_port <= 0) {
        return self.create_relay(...).await;
    }

    // 4. UDP 打洞
    if ph.udp_port > 0 {
        peer_addr.set_port(ph.udp_port as u16);
        return self.punch_udp_hole(peer_addr, server, msg_punch, control_permissions).await;
    }

    // 5. TCP 打洞
    let mut socket = connect_tcp(&*self.host, CONNECT_TIMEOUT).await?;
    allow_err!(socket_client::connect_tcp_local(peer_addr, Some(local_addr), 30).await);
}
```

### NAT 类型与连接策略

```rust
// NAT 类型决定连接策略
enum NatType {
    NO_NAT,         // 无 NAT，优先 P2P 直连
    FULL_CONE,      // 完全锥形 NAT，优先 P2P 直连
    RESTRICTED,     // 限制锥形 NAT，可能需要中继
    SYMMETRIC,      // 对称型 NAT，必须中继
}

// 连接策略选择
fn select_connection_strategy(nat_type: NatType, force_relay: bool) -> ConnectionMode {
    if force_relay || nat_type == NatType::SYMMETRIC {
        ConnectionMode::Relay  // 必须中继
    } else if nat_type == NatType::RESTRICTED {
        ConnectionMode::TryP2PThenRelay  // 尝试 P2P，失败则中继
    } else {
        ConnectionMode::P2P  // 优先 P2P
    }
}
```

## 中继模式 (Relay)

### 创建中继连接

```rust
// src/rendezvous_mediator.rs

async fn create_relay(
    &self,
    socket_addr: Vec<u8>,
    relay_server: String,
    uuid: String,
    server: ServerPtr,
    secure: bool,
    initiate: bool,
    socket_addr_v6: bytes::Bytes,
    control_permissions: Option<ControlPermissions>,
) -> ResultType<()> {
    // 1. 建立到 rendezvous server 的 TCP 连接
    let mut socket = connect_tcp(&*self.host, CONNECT_TIMEOUT).await?;

    // 2. 发送中继请求
    let mut msg_out = Message::new();
    let mut rr = RelayResponse {
        socket_addr: socket_addr.into(),
        version: crate::VERSION.to_owned(),
        socket_addr_v6,
        ..Default::default()
    };
    msg_out.set_relay_response(rr);
    socket.send(&msg_out).await?;

    // 3. 建立 relay 连接
    crate::create_relay_connection(
        server,
        relay_server,
        uuid,
        peer_addr,
        secure,
        is_ipv4(&self.addr),
        control_permissions,
    ).await;

    Ok(())
}
```

### 心跳保活机制

```rust
// 心跳机制确保连接活跃
async fn send_heartbeat(&self, socket: &mut impl FramedWrite) -> bool {
    let mut msg = Message::new();
    msg.set_ping(Ping {
        timestamp: get_time().await,
        ..Default::default()
    });

    if let Err(e) = socket.send(&msg).await {
        log::error!("Heartbeat failed: {}", e);
        return false;
    }
    true
}

// 心跳超时检测
fn check_heartbeat_timeout(last_heartbeat: Option<DateTime<Utc>>, timeout_secs: i64) -> bool {
    if let Some(timestamp) = last_heartbeat {
        let elapsed = Utc::now() - timestamp;
        elapsed.num_seconds() > timeout_secs
    } else {
        false
    }
}
```

## Protocol Buffers 消息定义

### 主消息类型

```protobuf
// libs/hbb_common/src/message_proto/mod.rs

// 主消息类型（oneof 模式支持多种消息）
message Message {
  int32 id = 1;                    // 消息 ID
  MessageType type = 2;            // 消息类型
  oneof payload {
    LoginRequest login_request = 3;
    LoginResponse login_response = 4;
    AudioFrame audio_frame = 5;
    VideoFrame video_frame = 6;
    InputEvent input_event = 7;
    ClipboardData clipboard_data = 8;
    FileTransfer file_transfer = 9;
    CloseReason close_reason = 10;
    Ping ping = 11;
    Pong pong = 12;
    PunchHole punch_hole = 13;     // 打洞消息
    RelayResponse relay_response = 14;  // 中继响应
  }
}

enum MessageType {
  NONE = 0;
  LOGIN_REQUEST = 1;
  LOGIN_RESPONSE = 2;
  AUDIO_FRAME = 3;
  VIDEO_FRAME = 4;
  INPUT_EVENT = 5;
  CLIPBOARD = 6;
  FILE_TRANSFER = 7;
  CLOSE = 8;
  PING = 9;
  PONG = 10;
  PUNCH_HOLE = 11;
  RELAY_RESPONSE = 12;
}
```

### 打洞消息

```protobuf
message PunchHole {
  string peer_id = 1;              // 对端 ID
  bytes socket_addr = 2;           // 序列化地址
  int32 socket_addr_version = 3;   // 地址版本
  int32 peer_port = 4;             // 对端端口
  bool force_relay = 5;            // 强制中继
  int32 nat_type = 6;              // NAT 类型
  bytes local_addr = 7;            // 本地地址
  int32 local_port = 8;            // 本地端口
  int32 udp_port = 9;              // UDP 端口
  int32 conn_type = 10;            // 连接类型
  bytes socket_addr_v6 = 11;       // IPv6 地址
  bytes local_addr_v6 = 12;        // IPv6 本地地址
}
```

### 文件传输（支持分片和断点续传）

```protobuf
message FileTransfer {
  string id = 1;                   // 传输 ID
  FileTransferAction action = 2;
  bytes data = 3;                  // 文件数据
  int64 offset = 4;                // 文件偏移（支持断点续传）
  bool compressed = 5;             // 是否压缩
}

enum FileTransferAction {
  FILE_TRANSFER_NONE = 0;
  FILE_TRANSFER_REQUEST = 1;       // 请求传输
  FILE_TRANSFER_RESPONSE = 2;      // 响应
  FILE_TRANSFER_DATA = 3;          // 数据块
  FILE_TRANSFER_CANCEL = 4;        // 取消
  FILE_TRANSFER_DONE = 5;          // 完成
}

// 文件元数据
message FileMeta {
  string name = 1;
  int64 size = 2;
  int64 modified = 3;
  bool is_directory = 4;
}

// 文件块
message FileChunk {
  int32 id = 1;
  int32 file_num = 2;
  bytes data = 3;
  bool compressed = 4;
  int64 offset = 5;
}
```

### 输入事件

```protobuf
message InputEvent {
  oneof event {
    KeyEvent key = 1;
    MouseEvent mouse = 2;
    WheelEvent wheel = 3;
    ClipboardEvent clipboard = 4;
  }
}

message KeyEvent {
  Direction direction = 1;
  int32 code = 2;                  // 扫描码
  int32 key = 3;                   // 虚拟键码
  bool scan = 4;
  bool raw = 5;
}

message MouseEvent {
  Direction direction = 1;
  int32 button = 2;
  int32 x = 3;
  int32 y = 4;
}

message WheelEvent {
  Axis axis = 1;
  int32 delta = 2;
}

enum Direction {
  DOWN = 0;
  UP = 1;
}

enum Axis {
  HORIZONTAL = 0;
  VERTICAL = 1;
}
```

## 在本项目中的使用

### 1. 客户端连接管理

```rust
// agent-client/src/connection/mod.rs

use hbb_common::{rendezvous_proto::*, ResultType};
use std::sync::Arc;

pub struct ConnectionManager {
    mediator: Arc<RendezvousMediator>,
    state: ConnectionState,
}

pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected(PeerConnection),
    Relay(RelayConnection),
}

impl ConnectionManager {
    /// 连接到远程客户端
    pub async fn connect(
        &self,
        peer_id: &str,
        key: &str,
    ) -> ResultType<PeerConnection> {
        // 1. 从 hbbs 获取对端信息
        let peer_info = self.mediator.get_peer_info(peer_id).await?;

        // 2. 尝试 P2P 直连
        if let Some(conn) = self.try_p2p_connect(&peer_info, key).await {
            return Ok(conn);
        }

        // 3. P2P 失败，降级到中继
        self.connect_via_relay(&peer_info, key).await
    }

    /// 监听远程连接
    pub async fn listen(&self, id: &str, key: &str) -> ResultType<()> {
        self.mediator.start(id, key).await
    }
}
```

### 2. 消息收发

```rust
// agent-client/src/connection/message.rs

use hbb_common::message_proto::{Message, MessageType};

pub struct MessageChannel {
    stream: Box<dyn FramedStream>,
}

impl MessageChannel {
    /// 发送消息
    pub async fn send(&mut self, msg: &Message) -> ResultType<()> {
        self.stream.send(msg).await?;
        Ok(())
    }

    /// 接收消息
    pub async fn recv(&mut self) -> ResultType<Option<Message>> {
        match self.stream.next().await {
            Some(Ok(msg)) => Ok(Some(msg)),
            Some(Err(e)) => Err(e.into()),
            None => Ok(None),
        }
    }

    /// 发送聊天消息
    pub async fn send_chat(&mut self, content: &str) -> ResultType<()> {
        let msg = Message {
            id: generate_id(),
            type_: MessageType::MESSAGE_CHAT as i32,
            payload: Some(ChatMessage {
                content: content.to_string(),
                timestamp: get_timestamp(),
            }.into()),
            ..Default::default()
        };
        self.send(&msg).await
    }
}
```

### 3. 连接状态指示

```rust
// agent-client/src/ui/status_bar.rs

use hbb_common::rendezvous_proto::PunchHole;

pub struct ConnectionIndicator {
    state: ConnectionState,
    last_heartbeat: Option<DateTime<Utc>>,
}

impl Render for ConnectionIndicator {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        let status = match self.state {
            ConnectionState::Connected => Status::Online,
            ConnectionState::Relay => Status::Relay,  // 中继模式
            ConnectionState::Connecting => Status::Connecting,
            ConnectionState::Disconnected => Status::Offline,
        };

        let color = match status {
            Status::Online => cx.theme().colors.success,
            Status::Relay => cx.theme().colors.warning,
            Status::Connecting => cx.theme().colors.info,
            Status::Offline => cx.theme().colors.error,
        };

        div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .w_3()
                    .h_3()
                    .rounded_full()
                    .bg(color)
            )
            .child(match status {
                Status::Online => "已连接 (P2P)",
                Status::Relay => "已连接 (中继)",
                Status::Connecting => "连接中...",
                Status::Offline => "未连接",
            })
    }
}
```

## 文件传输功能

### 文件分片传输

```rust
// agent-client/src/connection/file_transfer.rs

use hbb_common::message_proto::{FileTransfer, FileTransferAction};

const CHUNK_SIZE: usize = 64 * 1024;  // 64KB 分片

pub struct FileTransferManager {
    upload_jobs: HashMap<String, UploadJob>,
    download_jobs: HashMap<String, DownloadJob>,
}

pub struct UploadJob {
    file: File,
    path: PathBuf,
    offset: i64,
    peer_id: String,
}

impl FileTransferManager {
    /// 上传文件（支持断点续传）
    pub async fn upload(&mut self, path: &Path, peer_id: &str) -> ResultType<()> {
        let file = File::open(path).await?;
        let metadata = file.metadata().await?;
        let file_name = path.file_name().unwrap().to_string_lossy();

        // 检查断点续传
        let offset = self.get_checkpoint(&peer_id, &file_name).unwrap_or(0);

        let job = UploadJob {
            file,
            path: path.to_path_buf(),
            offset,
            peer_id: peer_id.to_string(),
        };

        // 开始分片传输
        self.upload_with_offset(job).await
    }

    async fn upload_with_offset(&mut self, mut job: UploadJob) -> ResultType<()> {
        job.file.seek(SeekFrom::Start(job.offset as u64)).await?;

        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut offset = job.offset;

        while let Ok(n) = job.file.read(&mut buffer).await {
            if n == 0 { break; }

            // 发送分片
            let chunk = FileTransfer {
                id: job.peer_id.clone(),
                action: FileTransferAction::FILE_TRANSFER_DATA as i32,
                data: buffer[..n].to_vec(),
                offset,
                compressed: false,
            };

            self.send_chunk(&chunk).await?;

            // 保存断点
            self.save_checkpoint(&job.peer_id, &job.path, offset);

            offset += n as i64;
        }

        // 传输完成
        self.send_done(&job.peer_id).await?;

        Ok(())
    }
}
```

## 可复用代码

### 核心复用模块

| 模块 | 路径 | 用途 |
|------|------|------|
| **hbb_common** | `libs/hbb_common/` | 消息编解码、网络工具、配置管理 |
| **scrap** | `libs/scrap/` | 屏幕捕获、视频编码 |
| **enigo** | `libs/enigo/` | 键盘鼠标输入模拟 |
| **clipboard** | `libs/clipboard/` | 跨平台剪贴板同步 |

### 推荐集成方式

```toml
[dependencies]
hbb_common = { path = "vendors/nuwax-rustdesk/libs/hbb_common" }
```

## 关键设计模式

1. **双协议支持**：UDP 直连优先，失败降级 TCP/WebSocket 中继
2. **NAT 打洞**：根据 NAT 类型自动选择连接策略
3. **心跳保活**：EMA 动态调整心跳间隔
4. **断点续传**：支持文件传输中断后继续
5. **分片传输**：大文件分块传输，提高可靠性

## 与本项目的集成点

| 功能 | 使用模块 | 说明 |
|------|----------|------|
| 双向通信 | `hbb_common::message_proto` | 消息编解码 |
| P2P 直连 | `rendezvous_mediator` | NAT 穿透 |
| 中继传输 | `relay_connection` | 数据中转 |
| 文件传输 | `file_transfer` | 分片传输 |
| 输入模拟 | `enigo` | 远程控制 |
| 屏幕捕获 | `scrap` | 远程桌面 |

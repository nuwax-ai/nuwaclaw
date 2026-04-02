# rustdesk-server

## 项目概述

RustDesk 官方服务器端程序，包含 hbbs（信令服务器）和 hbbr（中继服务器）。

**本地路径**: `vendors/rustdesk-server`

## 目录结构

```
rustdesk-server/
├── src/
│   ├── lib.rs                    # 库入口
│   ├── rendezvous_server.rs      #  rendezvous 服务器（核心）
│   ├── relay_server.rs           # 中继服务器
│   ├── peer.rs                   # 对等节点管理
│   ├── database.rs               # SQLite数据库操作
│   ├── message.rs                # 消息处理
│   ├── heartbeat.rs              # 心跳检测
│   └── hbbr.rs                   # 中继服务器入口
├── Cargo.toml
└── libs/
    └── hbb_common/               # 通用库
        ├── src/
        │   ├── lib.rs
        │   ├── message_proto/    # protobuf 消息定义
        │   ├── net/              # 网络工具
        │   └── util/             # 工具函数
        └── Cargo.toml
```

## 核心依赖

```toml
[dependencies]
hbb_common = { path = "libs/hbb_common" }

# Web 框架
axum = "0.7"
tokio = { version = "1.0", features = ["full"] }

# 数据库
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio"] }

# WebSocket
tokio-tungstenite = "0.23"

# 命令行
clap = "4.0"

# 配置
rust-ini = "0.19"

# 认证
jsonwebtoken = "9.0"
bcrypt = "0.15"

# 工具
thiserror = "1.0"
anyhow = "1.0"
chrono = "0.4"
parking_lot = "0.12"
```

## hbbs - 信令服务器

### 核心结构体

```rust
// src/rendezvous_server.rs

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::mpsc;
use futures::Sink;

pub struct RendezvousServer {
    // TCP 打洞连接池
    tcp_punch: Arc<Mutex<HashMap<SocketAddr, Sink>>>,

    // 节点映射 (ID -> PeerInfo)
    pm: Arc<PeerMap>,

    // 消息发送通道
    tx: Sender,

    // 中继服务器列表
    relay_servers: Arc<RelayServers>,

    // 内部状态
    inner: Arc<Inner>,
}

// 内部状态
struct Inner {
    // 监听地址
    addr: SocketAddr,
    // 运行状态
    running: AtomicBool,
    // 配置
    config: Config,
}

// 节点映射
pub(crate) struct PeerMap {
    // 内存缓存 (ID -> PeerInfo)
    map: Arc<RwLock<HashMap<String, LockPeer>>>,

    // SQLite 持久化
    db: database::Database,
}

// 锁住的 Peer（带超时）
type LockPeer = Mutex<Option<Peer>>;

pub struct Peer {
    pub id: String,              // 节点 ID
    pub uuid: String,            // UUID
    pub pk: Vec<u8>,             # 公钥
    pub options: HashMap<String, String>,  // 选项
    pub created_at: chrono::DateTime<Utc>,
    pub user: Option<String>,    // 关联用户
    pub status: i32,             // 状态
    pub note: String,
    pub info: String,
}
```

### 数据库模型 (database.rs)

```rust
// src/database.rs

use sqlx::{SqlitePool, Row};

pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn new(path: &str) -> Result<Self> {
        let pool = SqlitePool::connect(path).await?;
        Ok(Self { pool })
    }

    /// 初始化数据库表
    pub async fn init(&self) -> Result<()> {
        sqlx::query!(
            r#"
            CREATE TABLE IF NOT EXISTS peer (
                guid blob PRIMARY KEY,
                id varchar(100) NOT NULL,
                uuid blob NOT NULL,
                pk blob NOT NULL,
                created_at datetime,
                user blob,
                status tinyint,
                note varchar(300),
                info text
            )
            "#
        ).execute(&self.pool).await?;

        // 创建索引
        sqlx::query!("CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_id ON peer(id)").execute(&self.pool).await?;
        sqlx::query!("CREATE INDEX IF NOT EXISTS idx_peer_user ON peer(user)").execute(&self.pool).await?;
        sqlx::query!("CREATE INDEX IF NOT EXISTS idx_peer_created ON peer(created_at)").execute(&self.pool).await?;
        sqlx::query!("CREATE INDEX IF NOT EXISTS idx_peer_status ON peer(status)").execute(&self.pool).await?;

        Ok(())
    }

    /// 根据 ID 查找节点
    pub async fn get_by_id(&self, id: &str) -> Result<Option<Peer>> {
        let row = sqlx::query("SELECT * FROM peer WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        row.map(|r| Peer {
            id: r.try_get("id")?,
            uuid: r.try_get("uuid")?,
            pk: r.try_get("pk")?,
            // ... 其他字段
        }).transpose()
    }

    /// 保存节点
    pub async fn save_peer(&self, peer: &Peer) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT OR REPLACE INTO peer (guid, id, uuid, pk, created_at, user, status, note, info)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            uuid::Uuid::new_v4().as_bytes(),
            peer.id,
            peer.uuid,
            peer.pk,
            peer.created_at,
            peer.user,
            peer.status,
            peer.note,
            peer.info,
        ).execute(&self.pool).await?;

        Ok(())
    }

    /// 列出所有节点
    pub async fn list_peers(&self, limit: i32, offset: i32) -> Result<Vec<Peer>> {
        sqlx::query_as!(Peer, "SELECT * FROM peer ORDER BY created_at DESC LIMIT ? OFFSET ?", limit, offset)
            .fetch_all(&self.pool)
            .await
    }
}
```

### 协议消息 (rendezvous_proto)

```protobuf
// 注册节点
message RegisterPeer {
    string id = 1;              // 节点 ID
    bytes uuid = 2;             // UUID
    bytes pk = 3;               // 公钥
    map<string, string> options = 4;  // 选项
}

// 注册公钥
message RegisterPk {
    bytes pk = 1;               // 公钥
}

// 打洞请求
message PunchHoleRequest {
    string target_id = 1;       // 目标节点 ID
    ConnectionType conn_type = 2;  // 连接类型
}

// 打洞响应
message PunchHoleResponse {
    bool success = 1;
    SocketAddr relay_server = 2;  // 中继服务器地址
    bytes challenge = 3;         // 挑战数据
}

// 连接类型
enum ConnectionType {
    CONNECTION_TYPE_NONE = 0;
    CONNECTION_TYPE_TCP = 1;
    CONNECTION_TYPE_KCP = 2;
    CONNECTION_TYPE_WEBSOCKET = 3;
}

// 请求中继
message RequestRelay {
    string target_id = 1;
    bytes token = 2;
}

// 中继响应
message RelayResponse {
    bytes relay_server = 1;
}
```

### 消息处理流程

```rust
// src/message.rs

pub async fn handle_message(
    msg: &Message,
    peer_map: &Arc<PeerMap>,
    tx: &Sender,
) -> Result<Option<Message>> {
    match msg.type_ {
        MessageType::RegisterPeer => {
            let req = msg.payload.register_peer()?;
            handle_register_peer(peer_map, &req, tx).await
        }
        MessageType::RegisterPk => {
            let req = msg.payload.register_pk()?;
            handle_register_pk(peer_map, &req, tx).await
        }
        MessageType::PunchHoleRequest => {
            let req = msg.payload.punch_hole_request()?;
            handle_punch_hole(peer_map, &req, tx).await
        }
        MessageType::RequestRelay => {
            let req = msg.payload.request_relay()?;
            handle_request_relay(peer_map, &req, tx).await
        }
        _ => Ok(None)
    }
}

/// 处理节点注册
async fn handle_register_peer(
    peer_map: &Arc<PeerMap>,
    req: &RegisterPeer,
    tx: &Sender,
) -> Result<Option<Message>> {
    // 1. 验证 ID 格式
    if req.id.is_empty() || req.id.len() > 100 {
        return Err(Error::InvalidId);
    }

    // 2. 检查 ID 是否已被使用
    if let Some(existing) = peer_map.get_by_id(&req.id).await? {
        if existing.uuid != req.uuid {
            return Err(Error::IdAlreadyInUse);
        }
    }

    // 3. 保存到数据库
    let peer = Peer {
        id: req.id.clone(),
        uuid: req.uuid.clone(),
        pk: req.pk.clone(),
        options: req.options.clone(),
        created_at: Utc::now(),
        user: None,
        status: 1,
        note: String::new(),
        info: String::new(),
    };
    peer_map.save_peer(&peer).await?;

    // 4. 广播新节点上线
    tx.send(MessageType::PeerOnline as i32, &peer.id).await;

    Ok(Some(Message {
        type_: MessageType::RegisterPeerResponse as i32,
        payload: Some(RegisterPeerResponse { success: true }.into()),
        ..Default::default()
    }))
}

/// 处理打洞请求
async fn handle_punch_hole(
    peer_map: &Arc<PeerMap>,
    req: &PunchHoleRequest,
    tx: &Sender,
) -> Result<Option<Message>> {
    // 1. 查找目标节点
    let target = peer_map.get_by_id(&req.target_id).await?;

    match target {
        Some(peer) => {
            // 2. 获取目标连接信息
            let peer_info = peer_map.get_connection_info(&req.target_id).await?;

            // 3. 发送打洞消息给目标
            let punch_msg = Message {
                type_: MessageType::PunchHole as i32,
                payload: Some(PunchHole {
                    from_id: req.from_id.clone(),
                    conn_type: req.conn_type,
                }.into()),
                ..Default::default()
            };
            tx.send_to(&req.target_id, &punch_msg).await;

            // 4. 返回目标信息
            Ok(Some(Message {
                type_: MessageType::PunchHoleResponse as i32,
                payload: Some(PunchHoleResponse {
                    success: true,
                    relay_server: peer_info.relay_server,
                    ..Default::default()
                }.into()),
                ..Default::default()
            }))
        }
        None => {
            // 目标不在线，返回中继服务器地址
            Ok(Some(Message {
                type_: MessageType::PunchHoleResponse as i32,
                payload: Some(PunchHoleResponse {
                    success: false,
                    relay_server: get_relay_server(),
                    ..Default::default()
                }.into()),
                ..Default::default()
            }))
        }
    }
}
```

## hbbr - 中继服务器

### 中继服务器架构

```rust
// src/relay_server.rs

use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use futures::StreamExt;

pub struct RelayServer {
    // 监听地址
    listen_addr: SocketAddr,

    // 带宽限制
    speed_limit: Arc<SpeedLimit>,

    // 连接管理
    connections: Arc<ConnectionManager>,

    // 配置
    config: RelayConfig,
}

pub struct RelayConfig {
    pub max_connections: usize,
    pub max_bandwidth: u64,       // 最大带宽 (bytes/s)
    pub connection_timeout: Duration,
}

impl RelayServer {
    pub async fn start(&self) -> Result<()> {
        let listener = TcpListener::bind(self.listen_addr).await?;

        tracing::info!("Relay server listening on {}", self.listen_addr);

        loop {
            let (stream, addr) = listener.accept().await?;
            let speed_limit = self.speed_limit.clone();
            let connections = self.connections.clone();

            tokio::spawn(async move {
                if let Err(e) = self.handle_connection(stream, addr, speed_limit, connections).await {
                    tracing::error!("Relay connection error: {}", e);
                }
            });
        }
    }

    async fn handle_connection(
        &self,
        stream: TcpStream,
        addr: SocketAddr,
        speed_limit: Arc<SpeedLimit>,
        connections: Arc<ConnectionManager>,
    ) -> Result<()> {
        // 1. 认证
        let (mut reader, writer) = stream.into_split();
        let auth = self.authenticate(&mut reader).await?;

        // 2. 注册连接
        let conn_id = connections.add(addr, auth).await?;

        // 3. 数据中继循环
        let mut buf = vec![0u8; 65536];
        loop {
            // 应用带宽限制
            speed_limit.wait_if_needed().await;

            // 读取数据
            let n = reader.read(&mut buf).await?;
            if n == 0 {
                break;
            }

            // 转发到目标
            connections.forward(&conn_id, &buf[..n]).await?;
        }

        // 4. 清理连接
        connections.remove(&conn_id).await;

        Ok(())
    }
}

/// 带宽限制
struct SpeedLimit {
    // 已使用的带宽
    used: AtomicU64,
    // 限制
    limit: u64,
    // 窗口开始时间
    window_start: AtomicU64,
}

impl SpeedLimit {
    pub async fn wait_if_needed(&self) {
        let now = current_time_millis();
        let window_start = self.window_start.load(Ordering::SeqCst);

        if now - window_start > 1000 {
            // 新窗口，重置计数器
            self.window_start.store(now, Ordering::SeqCst);
            self.used.store(0, Ordering::SeqCst);
        }

        // 等待可用带宽
        while self.used.load(Ordering::SeqCst) >= self.limit {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub fn add(&self, n: u64) {
        self.used.fetch_add(n, Ordering::SeqCst);
    }
}
```

### 中继协议

```rust
// 中继消息格式
struct RelayMessage {
    source_id: [u8; 16],        // 源节点 ID (UUID)
    target_id: [u8; 16],        // 目标节点 ID (UUID)
    payload: Vec<u8>,           // 负载数据
    timestamp: u64,             // 时间戳
    sequence: u64,              // 序列号
}

// 加密
fn encrypt_payload(data: &[u8], key: &[u8]) -> Vec<u8> {
    // 使用 libsodium 加密
}

// 解密
fn decrypt_payload(data: &[u8], key: &[u8]) -> Vec<u8> {
    // 使用 libsodium 解密
}
```

## 连接管理

```rust
// src/peer.rs

pub struct ConnectionManager {
    // 在线节点 (ID -> ConnectionInfo)
    online_peers: Arc<DashMap<String, ConnectionInfo>>,

    // 地址映射 (SocketAddr -> ID)
    addr_to_id: Arc<DashMap<SocketAddr, String>>,

    // 消息通道
    msg_tx: mpsc::UnboundedSender<(String, Message)>,
}

pub struct ConnectionInfo {
    pub id: String,
    pub addr: SocketAddr,
    pub conn_type: ConnectionType,
    pub last_heartbeat: DateTime<Utc>,
    pub public_key: Vec<u8>,
}

impl ConnectionManager {
    /// 添加连接
    pub async fn add_connection(&self, id: String, addr: SocketAddr, conn_type: ConnectionType) {
        let info = ConnectionInfo {
            id: id.clone(),
            addr,
            conn_type,
            last_heartbeat: Utc::now(),
            public_key: Vec::new(),
        };

        self.online_peers.insert(id.clone(), info);
        self.addr_to_id.insert(addr, id);
    }

    /// 移除连接
    pub async fn remove_connection(&self, id: &str) {
        if let Some((addr, _)) = self.online_peers.remove(id) {
            self.addr_to_id.remove(&addr);
        }
    }

    /// 根据 ID 查找连接
    pub fn get_connection(&self, id: &str) -> Option<ConnectionInfo> {
        self.online_peers.get(id).map(|v| v.clone())
    }

    /// 更新心跳
    pub async fn update_heartbeat(&self, id: &str) {
        if let Some(mut info) = self.online_peers.get_mut(id) {
            info.last_heartbeat = Utc::now();
        }
    }

    /// 获取所有在线节点
    pub fn get_online_peers(&self) -> Vec<String> {
        self.online_peers.keys().map(|s| s.clone()).collect()
    }
}
```

## 用户认证 (可选)

```rust
// 用户认证模块

use jsonwebtoken::{decode, encode, Header, Validation};
use bcrypt::{hash, verify};

pub struct AuthManager {
    jwt_secret: Vec<u8>,
    jwt_issuer: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,             // 用户 ID
    pub username: String,
    pub exp: usize,              // 过期时间
    pub iat: usize,              // 签发时间
}

impl AuthManager {
    /// 生成 JWT 令牌
    pub fn generate_token(&self, user_id: &str, username: &str) -> Result<String> {
        let exp = (Utc::now() + Duration::days(7)).timestamp() as usize;
        let iat = Utc::now().timestamp() as usize;

        let claims = Claims {
            sub: user_id.to_string(),
            username: username.to_string(),
            exp,
            iat,
        };

        encode(&Header::default(), &claims, &self.jwt_secret)
            .map_err(|e| Error::JwtError(e.to_string()))
    }

    /// 验证 JWT 令牌
    pub fn verify_token(&self, token: &str) -> Result<Claims> {
        let validation = Validation::default();
        decode::<Claims>(token, &self.jwt_secret, &validation)
            .map(|d| d.claims)
            .map_err(|e| Error::JwtError(e.to_string()))
    }

    /// 验证密码
    pub fn verify_password(&self, password: &str, hash: &str) -> bool {
        verify(password, hash).unwrap_or(false)
    }

    /// 哈希密码
    pub fn hash_password(&self, password: &str) -> Result<String> {
        hash(password, 12).map_err(|e| Error::BcryptError(e.to_string()))
    }
}
```

## 配置管理

```toml
# hbbs.toml 或命令行参数

[hbbs]
# 监听地址
host = "0.0.0.0"
port = 21116

# 数据库
db_file = "hbbs.db"

# 密钥
key = ""

# 中继服务器
relay = ""

# 用户认证
enable_user_auth = false

[relay]
# 中继服务器监听地址
host = "0.0.0.0"
port = 21117

# 带宽限制 (bytes/s)
max_bandwidth = 10485760  # 10 MB/s

# 最大连接数
max_connections = 1000
```

## 通信流程

```
┌─────────────┐                              ┌─────────────┐
│  Client A   │                              │  Client B   │
│  (ID: 1234) │                              │  (ID: 5678) │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │  1. 连接 hbbs:21116                        │
       ├───────────────────────────────────────────►│
       │                                            │
       │  2. RegisterPeer (注册 ID)                 │
       │◄──────────────────────────────────────────┤
       │                                            │
       │  3. Client A 请求连接 B (PunchHoleRequest) │
       │◄──────────────────────────────────────────┤
       │                                            │
       │  4. hbbs 通知 B (PunchHole)                │
       │───────────────────────────────────────────►│
       │                                            │
       │  5a. P2P 成功: A 和 B 直接连接             │
       │◄──────────────────────────────────────────┤
       │                                            │
       │  5b. P2P 失败: 通过 hbbr 中继              │
       │◄══════ hbbs/hbbr 中继 ════════════════════│
```

## 可复用代码

| 模块 | 路径 | 用途 |
|------|------|------|
| **rendezvous_server** | `src/rendezvous_server.rs` | 信令服务器核心 |
| **relay_server** | `src/relay_server.rs` | 中继服务器 |
| **peer** | `src/peer.rs` | 节点管理 |
| **database** | `src/database.rs` | SQLite 操作 |

## 在本项目中的使用

作为 `data-server`，提供：

```
┌─────────────────────────────────────────────────────────────────┐
│                        data-server (rustdesk-server)              │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │      hbbs           │    │       hbbr          │            │
│  │  (信令服务器)       │    │   (中继服务器)       │            │
│  │  - 端口: 21116      │    │   - 端口: 21117     │            │
│  │  - ID 注册         │    │   - 数据中继        │            │
│  │  - 连接协商        │    │   - 带宽限制        │            │
│  │  - NAT 穿透        │    │   - TCP/WS          │            │
│  └─────────────────────┘    └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     agent-client / agent-server-admin            │
└─────────────────────────────────────────────────────────────────┘
```

## 与 nuwax-rustdesk 的配合

```
nuwax-rustdesk (客户端) <───────────────► rustdesk-server (data-server)
    │                                              │
    │  连接 hbbs:21116                             │
    │  ├── RegisterPeer (注册 ID)                  │
    │  ├── PunchHoleRequest (请求连接)             │
    │  └── RequestRelay (请求中继)                 │
    │                                              │
    │  连接 hbbr:21117 (中继模式)                  │
    │  └── 数据中继传输                            │
```

## 在本项目中的使用场景

### 场景1：agent-server-admin 连接 agent-client

```rust
// rustdesk-server 作为消息中转枢纽

// 1. agent-client 连接 hbbs，注册 ID
let client_id = register_peer_to_hbbs(client).await?;

// 2. agent-server-admin 连接 hbbs，查询目标客户端
let target_info = query_peer_from_hbbs(target_id).await?;

// 3. hbbs 协调双方建立 P2P 连接或中继
let connection = establish_connection(source_id, target_id).await?;

// 4. 双方通过建立的通道传输 protobuf 消息
send_protobuf_message(&connection, message).await?;
```

### 场景2：SSE 实时消息推送

```rust
// hbbs 支持 WebSocket 连接，用于 SSE 推送

use tokio_tungstenite::{WebSocketStream, tungstenite::Message};
use futures::{StreamExt, SinkExt};

pub struct SseHandler {
    // 客户端连接 (client_id -> WebSocket)
    connections: Arc<DashMap<String, WebSocketStream<TcpStream>>>,
}

impl SseHandler {
    /// 处理 SSE 连接
    pub async fn handle_sse_connection(
        &self,
        client_id: String,
        ws_stream: WebSocketStream<TcpStream>,
    ) -> Result<()> {
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        // 保存连接
        self.connections.insert(client_id.clone(), ws_stream);

        // 接收消息
        while let Some(msg) = ws_receiver.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    self.handle_client_message(&client_id, &text).await?;
                }
                Ok(Message::Close(_)) => {
                    self.connections.remove(&client_id);
                    break;
                }
                _ => {}
            }
        }

        Ok(())
    }

    /// 向客户端推送消息
    pub async fn push_message(&self, client_id: &str, message: &str) -> Result<()> {
        if let Some((_, ws_stream)) = self.connections.get(client_id) {
            let mut ws = ws_stream.lock().await;
            ws.send(Message::Text(message.to_string())).await?;
        }
        Ok(())
    }

    /// 广播消息给所有在线客户端
    pub async fn broadcast(&self, message: &str) {
        for (client_id, _) in self.connections.iter() {
            let _ = self.push_message(client_id, message).await;
        }
    }
}
```

### 场景3：文件传输中继

```rust
// hbbr 支持大文件分片中继传输

pub struct FileRelayHandler {
    // 文件传输会话 (session_id -> FileSession)
    sessions: Arc<DashMap<String, FileSession>>,
    // 带宽限制
    speed_limit: Arc<SpeedLimit>,
}

pub struct FileSession {
    pub source_id: String,
    pub target_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub chunks: u64,          // 总块数
    pub current_chunk: u64,   // 当前块
    pub last_update: DateTime<Utc>,
}

impl FileRelayHandler {
    /// 开始文件传输会话
    pub async fn start_session(
        &self,
        source_id: &str,
        target_id: &str,
        file_name: &str,
        file_size: u64,
    ) -> Result<String> {
        let chunk_size = 64 * 1024; // 64KB
        let chunks = (file_size + chunk_size - 1) / chunk_size;

        let session_id = uuid::Uuid::new_v4().to_string();
        let session = FileSession {
            source_id: source_id.to_string(),
            target_id: target_id.to_string(),
            file_name: file_name.to_string(),
            file_size,
            chunks,
            current_chunk: 0,
            last_update: Utc::now(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    /// 中继文件块
    pub async fn relay_chunk(
        &self,
        session_id: &str,
        chunk_data: &[u8],
        offset: u64,
    ) -> Result<()> {
        // 应用带宽限制
        self.speed_limit.wait_if_needed().await;

        if let Some(session) = self.sessions.get(session_id) {
            // 找到目标连接并转发
            if let Some(target_conn) = self.get_connection(&session.target_id).await {
                let relay_msg = FileChunkMessage {
                    session_id: session_id.to_string(),
                    offset,
                    data: chunk_data.to_vec(),
                    timestamp: Utc::now().timestamp_millis(),
                };
                self.forward_to(&target_conn, &relay_msg).await?;
            }

            // 更新进度
            self.sessions.insert(session_id.to_string(), FileSession {
                current_chunk: offset / 64_1024 + 1,
                ..session.value().clone()
            });
        }

        Ok(())
    }

    /// 清理超时会话
    pub async fn cleanup_timeout_sessions(&self, timeout: Duration) {
        let now = Utc::now();
        let expired: Vec<String> = self.sessions
            .iter()
            .filter(|s| (now - s.last_update) > timeout)
            .map(|s| s.key().clone())
            .collect();

        for session_id in expired {
            self.sessions.remove(&session_id);
        }
    }
}
```

### 场景4：心跳保活机制

```rust
// hbbs 维护客户端在线状态，定期发送心跳

pub struct HeartbeatManager {
    // 客户端心跳 (client_id -> last_heartbeat)
    heartbeats: Arc<DashMap<String, DateTime<Utc>>>,

    // 心跳间隔
    heartbeat_interval: Duration,

    // 超时时间
    timeout: Duration,

    // 清理任务
    cleanup_task: JoinHandle<()>,
}

impl HeartbeatManager {
    pub fn new(heartbeat_interval: Duration, timeout: Duration) -> Self {
        let heartbeats = Arc::new(DashMap::new());
        let this = Self {
            heartbeats,
            heartbeat_interval,
            timeout,
            cleanup_task: tokio::spawn(Self::cleanup_loop(timeout)),
        };
        this
    }

    /// 更新心跳
    pub fn update_heartbeat(&self, client_id: &str) {
        self.heartbeats.insert(client_id.to_string(), Utc::now());
    }

    /// 检查客户端是否在线
    pub fn is_online(&self, client_id: &str) -> bool {
        if let Some(heartbeat) = self.heartbeats.get(client_id) {
            (Utc::now() - *heartbeat) < self.timeout
        } else {
            false
        }
    }

    /// 获取所有在线客户端
    pub fn get_online_clients(&self) -> Vec<String> {
        let now = Utc::now();
        self.heartbeats
            .iter()
            .filter(|(_, hb)| (now - *hb) < self.timeout)
            .map(|s| s.key().clone())
            .collect()
    }

    async fn cleanup_loop(timeout: Duration) {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            // 清理超时的客户端心跳记录
            // 这是一个简化实现，实际应该使用 ArcSwap 或其他原子操作
        }
    }
}
```

### 场景5：连接状态统计

```rust
// 统计客户端连接状态（用于 UI 显示）

pub struct ConnectionStats {
    // 总连接数
    total_connections: AtomicUsize,

    // P2P 连接数
    p2p_connections: AtomicUsize,

    // 中继连接数
    relay_connections: AtomicUsize,

    // 按 NAT 类型统计
    nat_type_stats: HashMap<String, AtomicUsize>,

    // 在线客户端列表
    online_clients: DashMap<String, ClientInfo>,
}

#[derive(Clone)]
pub struct ClientInfo {
    pub id: String,
    pub conn_type: ConnectionType,
    pub nat_type: String,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
}

impl ConnectionStats {
    /// 记录新连接
    pub fn record_connection(&self, client_id: &str, conn_type: ConnectionType, nat_type: &str) {
        self.total_connections.fetch_add(1, Ordering::SeqCst);

        match conn_type {
            ConnectionType::P2P => self.p2p_connections.fetch_add(1, Ordering::SeqCst),
            ConnectionType::Relay => self.relay_connections.fetch_add(1, Ordering::SeqCst),
            _ => {}
        }

        let stats = self.nat_type_stats.entry(nat_type.to_string()).or_insert_with(|| AtomicUsize::new(0));
        stats.fetch_add(1, Ordering::SeqCst);

        self.online_clients.insert(client_id.to_string(), ClientInfo {
            id: client_id.to_string(),
            conn_type,
            nat_type: nat_type.to_string(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
        });
    }

    /// 获取统计摘要
    pub fn get_summary(&self) -> ConnectionSummary {
        ConnectionSummary {
            total_online: self.online_clients.len(),
            p2p_count: self.p2p_connections.load(Ordering::SeqCst),
            relay_count: self.relay_connections.load(Ordering::SeqCst),
            nat_distribution: self.nat_type_stats
                .iter()
                .map(|(k, v)| (k.clone(), v.load(Ordering::SeqCst)))
                .collect(),
        }
    }
}
```

## 关键设计模式

1. **内存缓存 + SQLite 持久化**: PeerMap 使用 RwLock 内存缓存 + SQLite 持久化
2. **DashMap 并发管理**: ConnectionManager 使用 DashMap 管理在线节点
3. **心跳检测**: 定期检测连接活性，清理超时连接
4. **带宽限制**: 中继服务器使用滑动窗口进行带宽控制

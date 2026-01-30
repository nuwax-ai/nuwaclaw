//! 应用状态模块

use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::broadcast;
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};

use crate::rustdesk_bridge::RustDeskBridge;

/// 客户端信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    /// 客户端 ID (RustDesk ID)
    pub id: String,
    /// 客户端名称
    pub name: Option<String>,
    /// 操作系统
    pub os: String,
    /// 操作系统版本
    pub os_version: String,
    /// 架构
    pub arch: String,
    /// 客户端版本
    pub client_version: String,
    /// 是否在线
    pub online: bool,
    /// 最后心跳时间
    pub last_heartbeat: DateTime<Utc>,
    /// 连接时间
    pub connected_at: DateTime<Utc>,
    /// 连接模式
    pub connection_mode: String,
    /// 延迟 (ms)
    pub latency: Option<u32>,
    /// 管理服务器地址（客户端用于回连）
    pub admin_endpoint: Option<String>,
}

impl ClientInfo {
    /// 创建测试客户端
    pub fn mock(id: &str) -> Self {
        Self {
            id: id.to_string(),
            name: Some(format!("Client-{}", id)),
            os: "darwin".to_string(),
            os_version: "24.0.0".to_string(),
            arch: "aarch64".to_string(),
            client_version: "0.1.0".to_string(),
            online: true,
            last_heartbeat: Utc::now(),
            connected_at: Utc::now(),
            connection_mode: "P2P".to_string(),
            latency: Some(15),
            admin_endpoint: None,
        }
    }

    /// 从注册请求创建
    pub fn from_registration(req: &ClientRegistration) -> Self {
        Self {
            id: req.client_id.clone(),
            name: req.name.clone(),
            os: req.os.clone(),
            os_version: req.os_version.clone(),
            arch: req.arch.clone(),
            client_version: req.client_version.clone(),
            online: true,
            last_heartbeat: Utc::now(),
            connected_at: Utc::now(),
            connection_mode: "Registered".to_string(),
            latency: None,
            admin_endpoint: None,
        }
    }
}

/// 客户端注册请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientRegistration {
    /// RustDesk 客户端 ID
    pub client_id: String,
    /// 客户端名称
    pub name: Option<String>,
    /// 操作系统
    pub os: String,
    /// 操作系统版本
    pub os_version: String,
    /// 架构
    pub arch: String,
    /// 客户端版本
    pub client_version: String,
}

/// 待发送给客户端的消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingMessage {
    /// 消息 ID
    pub message_id: String,
    /// 消息类型
    pub message_type: String,
    /// 消息负载
    pub payload: serde_json::Value,
    /// 创建时间
    pub created_at: DateTime<Utc>,
}

/// 服务器事件
#[derive(Debug, Clone, Serialize)]
pub enum ServerEvent {
    /// 客户端上线
    ClientOnline(String),
    /// 客户端下线
    ClientOffline(String),
    /// 收到消息
    MessageReceived {
        client_id: String,
        message_type: String,
        payload: String,
    },
}

/// 应用状态
#[derive(Clone)]
pub struct AppState {
    /// 客户端列表
    pub clients: Arc<DashMap<String, ClientInfo>>,
    /// 待发送消息队列（按客户端 ID 分组）
    pub pending_messages: Arc<DashMap<String, Vec<PendingMessage>>>,
    /// 事件广播通道
    pub event_tx: broadcast::Sender<ServerEvent>,
    /// RustDesk 桥接层
    pub bridge: Arc<RustDeskBridge>,
    /// 管理服务器自身的监听地址
    pub admin_addr: String,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new() -> Self {
        Self::with_config("localhost:21116", "0.0.0.0:8080")
    }

    /// 使用指定配置创建
    pub fn with_config(hbbs_addr: &str, admin_addr: &str) -> Self {
        let (event_tx, _) = broadcast::channel(100);
        let clients = Arc::new(DashMap::new());
        let pending_messages = Arc::new(DashMap::new());
        let bridge = Arc::new(RustDeskBridge::new(hbbs_addr));

        Self {
            clients,
            pending_messages,
            event_tx,
            bridge,
            admin_addr: admin_addr.to_string(),
        }
    }

    /// 启动 RustDesk 桥接层
    pub async fn start_bridge(&self) -> anyhow::Result<()> {
        self.bridge.start().await
    }

    /// 注册客户端
    pub fn register_client(&self, registration: ClientRegistration) -> ClientInfo {
        let client = ClientInfo::from_registration(&registration);
        let id = client.id.clone();

        // 检查是否已存在
        let is_new = !self.clients.contains_key(&id);

        self.clients.insert(id.clone(), client.clone());

        if is_new {
            let _ = self.event_tx.send(ServerEvent::ClientOnline(id));
        }

        client
    }

    /// 获取客户端列表
    pub fn list_clients(&self) -> Vec<ClientInfo> {
        self.clients
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 获取在线客户端列表
    pub fn list_online_clients(&self) -> Vec<ClientInfo> {
        self.clients
            .iter()
            .filter(|entry| entry.value().online)
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 获取单个客户端
    pub fn get_client(&self, id: &str) -> Option<ClientInfo> {
        self.clients.get(id).map(|entry| entry.value().clone())
    }

    /// 添加客户端
    pub fn add_client(&self, client: ClientInfo) {
        let id = client.id.clone();
        self.clients.insert(id.clone(), client);
        let _ = self.event_tx.send(ServerEvent::ClientOnline(id));
    }

    /// 移除客户端
    pub fn remove_client(&self, id: &str) {
        if self.clients.remove(id).is_some() {
            let _ = self.event_tx.send(ServerEvent::ClientOffline(id.to_string()));
        }
    }

    /// 更新客户端心跳
    pub fn update_heartbeat(&self, id: &str) -> bool {
        if let Some(mut client) = self.clients.get_mut(id) {
            client.last_heartbeat = Utc::now();
            client.online = true;
            true
        } else {
            false
        }
    }

    /// 设置客户端离线
    pub fn set_client_offline(&self, id: &str) {
        if let Some(mut client) = self.clients.get_mut(id) {
            client.online = false;
            let _ = self.event_tx.send(ServerEvent::ClientOffline(id.to_string()));
        }
    }

    /// 添加待发送消息
    pub fn enqueue_message(&self, client_id: &str, message: PendingMessage) {
        self.pending_messages
            .entry(client_id.to_string())
            .or_insert_with(Vec::new)
            .push(message);
    }

    /// 获取并清空客户端的待发送消息
    pub fn drain_pending_messages(&self, client_id: &str) -> Vec<PendingMessage> {
        self.pending_messages
            .get_mut(client_id)
            .map(|mut entry| std::mem::take(entry.value_mut()))
            .unwrap_or_default()
    }

    /// 获取待发送消息数量
    pub fn pending_message_count(&self, client_id: &str) -> usize {
        self.pending_messages
            .get(client_id)
            .map(|entry| entry.value().len())
            .unwrap_or(0)
    }

    /// 订阅事件
    pub fn subscribe_events(&self) -> broadcast::Receiver<ServerEvent> {
        self.event_tx.subscribe()
    }

    /// 发送事件
    pub fn emit_event(&self, event: ServerEvent) {
        let _ = self.event_tx.send(event);
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

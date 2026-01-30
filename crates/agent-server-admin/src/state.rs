//! 应用状态模块

use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::broadcast;
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};

/// 客户端信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    /// 客户端 ID
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
        }
    }
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
    /// 事件广播通道
    pub event_tx: broadcast::Sender<ServerEvent>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(100);
        let clients = Arc::new(DashMap::new());

        // 添加一些测试客户端
        clients.insert("12345678".to_string(), ClientInfo::mock("12345678"));
        clients.insert("87654321".to_string(), ClientInfo::mock("87654321"));

        Self {
            clients,
            event_tx,
        }
    }

    /// 获取客户端列表
    pub fn list_clients(&self) -> Vec<ClientInfo> {
        self.clients
            .iter()
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
    pub fn update_heartbeat(&self, id: &str) {
        if let Some(mut client) = self.clients.get_mut(id) {
            client.last_heartbeat = Utc::now();
            client.online = true;
        }
    }

    /// 订阅事件
    pub fn subscribe_events(&self) -> broadcast::Receiver<ServerEvent> {
        self.event_tx.subscribe()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

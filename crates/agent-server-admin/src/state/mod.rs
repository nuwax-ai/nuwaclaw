//! 应用状态模块

mod client_store;
mod events;
mod models;
mod task_store;

pub use events::ServerEvent;
pub use models::{
    AgentStatus, ClientInfo, ClientRegistration, CreateTaskRequest, TaskInfo, TaskStatus,
};

use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info, warn};

use nuwax_agent_core::business_channel::BusinessMessageType;

use crate::dispatch::{MessageDispatcher, P2PDispatcher};
use crate::peer_connection::PeerConnectionManager;
use crate::rustdesk_bridge::{BridgeEvent, RustDeskBridge};

/// 应用状态
#[derive(Clone)]
pub struct AppState {
    /// 客户端列表
    pub clients: Arc<DashMap<String, ClientInfo>>,
    /// 事件广播通道
    pub event_tx: broadcast::Sender<ServerEvent>,
    /// RustDesk 桥接层
    pub bridge: Arc<RustDeskBridge>,
    /// 管理服务器自身的监听地址
    pub admin_addr: String,
    /// 桥接层自身的 RustDesk peer ID
    pub bridge_self_id: Arc<RwLock<Option<String>>>,
    /// P2P 连接管理器
    pub peer_connections: Arc<PeerConnectionManager>,
    /// 消息派发器（对业务层屏蔽传输方式）
    pub dispatcher: Arc<dyn MessageDispatcher>,
    // ========================================================================
    // 任务管理相关
    // ========================================================================
    /// 任务存储（key: task_id）
    pub tasks: Arc<DashMap<String, TaskInfo>>,
    /// session_id → task_id 映射（用于会话复用）
    pub session_tasks: Arc<DashMap<String, String>>,
    /// client_id → task_ids 映射（用于查询客户端的所有任务）
    pub client_tasks: Arc<DashMap<String, Vec<String>>>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new() -> Self {
        Self::with_config("47.109.204.125:21116", "0.0.0.0:8080")
    }

    /// 使用指定配置创建
    pub fn with_config(hbbs_addr: &str, admin_addr: &str) -> Self {
        let (event_tx, _) = broadcast::channel(100);
        let clients = Arc::new(DashMap::new());
        let bridge = Arc::new(RustDeskBridge::new(hbbs_addr));
        let peer_connections = Arc::new(PeerConnectionManager::with_rustdesk());
        let bridge_self_id = Arc::new(RwLock::new(None));
        let tasks = Arc::new(DashMap::new());
        let session_tasks = Arc::new(DashMap::new());
        let client_tasks = Arc::new(DashMap::new());

        let dispatcher: Arc<dyn MessageDispatcher> = Arc::new(P2PDispatcher::new(
            peer_connections.clone(),
            bridge_self_id.clone(),
        ));

        Self {
            clients,
            event_tx,
            bridge,
            admin_addr: admin_addr.to_string(),
            bridge_self_id,
            peer_connections,
            dispatcher,
            tasks,
            session_tasks,
            client_tasks,
        }
    }

    /// 启动 RustDesk 桥接层
    pub async fn start_bridge(&self) -> anyhow::Result<()> {
        self.bridge.start().await?;
        self.spawn_bridge_event_loop();
        Ok(())
    }

    /// 启动桥接事件处理循环
    ///
    /// 消费 RustDeskBridge 产生的事件，更新 AppState 并广播 ServerEvent。
    fn spawn_bridge_event_loop(&self) {
        let event_rx = self.bridge.event_receiver();
        let bridge_self_id = self.bridge_self_id.clone();
        let event_tx = self.event_tx.clone();

        tokio::spawn(async move {
            let mut rx = event_rx.lock().await;
            while let Some(event) = rx.recv().await {
                match event {
                    BridgeEvent::Connected { self_id } => {
                        info!("Bridge connected with self ID: {}", self_id);
                        *bridge_self_id.write().await = Some(self_id);
                    }
                    BridgeEvent::ClientDiscovered { client_id } => {
                        info!("Bridge discovered client: {}", client_id);
                        let _ = event_tx.send(ServerEvent::ClientOnline(client_id));
                    }
                    BridgeEvent::ClientLost { client_id } => {
                        info!("Bridge lost client: {}", client_id);
                        let _ = event_tx.send(ServerEvent::ClientOffline(client_id));
                    }
                    BridgeEvent::MessageReceived { client_id, payload } => {
                        info!("Bridge received message from client: {}", client_id);
                        let _ = event_tx.send(ServerEvent::MessageReceived {
                            client_id,
                            message_type: "bridge_message".to_string(),
                            payload: String::from_utf8_lossy(&payload).to_string(),
                        });
                    }
                    BridgeEvent::Disconnected { reason } => {
                        warn!("Bridge disconnected: {}", reason);
                        *bridge_self_id.write().await = None;
                    }
                    BridgeEvent::Error { message } => {
                        error!("Bridge error: {}", message);
                    }
                }
            }
        });
    }

    /// 获取桥接层的自身 peer ID
    pub async fn get_bridge_self_id(&self) -> Option<String> {
        self.bridge_self_id.read().await.clone()
    }

    /// 订阅事件
    pub fn subscribe_events(&self) -> broadcast::Receiver<ServerEvent> {
        self.event_tx.subscribe()
    }

    /// 发送事件
    pub fn emit_event(&self, event: ServerEvent) {
        let _ = self.event_tx.send(event);
    }

    // ========================================================================
    // P2P 连接相关方法
    // ========================================================================

    /// 建立到客户端的 P2P 连接
    ///
    /// 如果未提供密码，将使用客户端注册时上报的密码
    pub async fn connect_to_client(
        &self,
        client_id: &str,
        password: Option<String>,
    ) -> anyhow::Result<()> {
        let client = self
            .get_client(client_id)
            .ok_or_else(|| anyhow::anyhow!("Client not found: {}", client_id))?;

        let effective_password = password.or(client.p2p_password);
        self.peer_connections
            .connect(client_id, effective_password)
            .await
    }

    /// 断开与客户端的 P2P 连接
    pub async fn disconnect_from_client(&self, client_id: &str) {
        self.peer_connections.disconnect(client_id).await;
    }

    /// 通过 P2P 发送业务消息
    pub async fn send_p2p_message(
        &self,
        client_id: &str,
        message_type: BusinessMessageType,
        payload: Vec<u8>,
    ) -> anyhow::Result<String> {
        let self_id = self.get_bridge_self_id().await.unwrap_or_default();

        let envelope =
            self.peer_connections
                .create_envelope(message_type, payload, &self_id, client_id);

        let message_id = envelope.message_id.clone();
        self.peer_connections
            .send_message(client_id, envelope)
            .await?;
        Ok(message_id)
    }

    /// 检查是否有到客户端的 P2P 连接
    pub fn has_p2p_connection(&self, client_id: &str) -> bool {
        self.peer_connections.is_connected(client_id)
    }

    /// 获取 P2P 连接数量
    pub fn p2p_connection_count(&self) -> usize {
        self.peer_connections.connected_count()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

//! P2P 连接管理器
//!
//! 管理 admin-server 与 agent-client 之间的 P2P/Relay 连接。
//! 使用 Transport trait 抽象传输层，支持依赖注入和单元测试。

use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use nuwax_agent_core::business_channel::{BusinessEnvelope, BusinessMessageType};

use super::rustdesk_transport::RustDeskTransport;
use super::transport::{ConnectionInfo, Transport};

/// P2P 连接状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PeerConnectionState {
    /// 断开
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接
    Connected,
    /// 错误
    Error(String),
}

/// P2P 连接事件
#[derive(Debug, Clone)]
pub enum PeerConnectionEvent {
    /// 连接成功
    Connected { peer_id: String },
    /// 连接断开
    Disconnected { peer_id: String, reason: String },
    /// 收到业务消息
    BusinessMessageReceived {
        peer_id: String,
        envelope: BusinessEnvelope,
    },
    /// 发送消息失败
    SendFailed {
        peer_id: String,
        message_id: String,
        error: String,
    },
    /// 错误
    Error { peer_id: String, message: String },
}

/// 连接元数据（简化版，用于快速查询）
struct ConnectionMeta {
    /// 连接信息（来自 Transport）
    info: ConnectionInfo,
    /// 连接状态
    state: PeerConnectionState,
    /// 最后活跃时间
    last_active: std::time::Instant,
}

impl ConnectionMeta {
    fn new(info: ConnectionInfo) -> Self {
        Self {
            info,
            state: PeerConnectionState::Connected,
            last_active: std::time::Instant::now(),
        }
    }

    fn touch(&mut self) {
        self.last_active = std::time::Instant::now();
    }

    fn is_connected(&self) -> bool {
        matches!(self.state, PeerConnectionState::Connected)
    }
}

/// P2P 连接管理器
///
/// 管理所有到 agent-client 的 P2P 连接。
/// 使用泛型 Transport 支持依赖注入和测试。
///
/// # 类型参数
///
/// - `T`: 传输层实现，必须实现 `Transport` trait
///
/// # 示例
///
/// ```ignore
/// // 生产环境
/// let manager = PeerConnectionManager::with_rustdesk();
///
/// // 测试环境
/// let transport = MockTransport::new();
/// let manager = PeerConnectionManager::new(Arc::new(transport));
/// ```
pub struct PeerConnectionManager<T: Transport = RustDeskTransport> {
    /// 传输层
    transport: Arc<T>,
    /// 连接元数据（peer_id -> ConnectionMeta）
    connections: Arc<DashMap<String, ConnectionMeta>>,
    /// 本端 peer ID
    self_id: Arc<tokio::sync::RwLock<Option<String>>>,
    /// 事件发送通道
    event_tx: mpsc::Sender<PeerConnectionEvent>,
    /// 事件接收通道
    event_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<PeerConnectionEvent>>>,
    /// 连接超时时间
    connect_timeout: Duration,
}

impl PeerConnectionManager<RustDeskTransport> {
    /// 使用默认 RustDesk 传输层创建管理器（生产环境）
    pub fn with_rustdesk() -> Self {
        Self::new(Arc::new(RustDeskTransport::new()))
    }
}

impl<T: Transport + 'static> PeerConnectionManager<T> {
    /// 创建新的连接管理器
    pub fn new(transport: Arc<T>) -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            transport,
            connections: Arc::new(DashMap::new()),
            self_id: Arc::new(tokio::sync::RwLock::new(None)),
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
            connect_timeout: Duration::from_secs(30),
        }
    }

    /// 设置本端 peer ID
    pub async fn set_self_id(&self, id: String) {
        *self.self_id.write().await = Some(id);
    }

    /// 获取本端 peer ID
    pub async fn get_self_id(&self) -> Option<String> {
        self.self_id.read().await.clone()
    }

    /// 获取事件接收器
    pub fn event_receiver(&self) -> Arc<tokio::sync::Mutex<mpsc::Receiver<PeerConnectionEvent>>> {
        self.event_rx.clone()
    }

    /// 建立到目标 peer 的连接
    ///
    /// 如果连接已存在且处于连接状态，则复用现有连接
    pub async fn connect(&self, peer_id: &str, password: Option<String>) -> anyhow::Result<()> {
        // 检查是否已连接（使用 entry API 避免竞态条件）
        {
            if let Some(mut entry) = self.connections.get_mut(peer_id) {
                if entry.is_connected() {
                    info!("Reusing existing connection to {}", peer_id);
                    entry.touch();
                    return Ok(());
                }
            }
        }

        info!("Initiating connection to {} via Transport", peer_id);

        // 通过传输层建立连接
        let info = self.transport.connect(peer_id, password).await?;

        // 保存连接元数据
        self.connections
            .insert(peer_id.to_string(), ConnectionMeta::new(info));

        // 发送连接成功事件
        let _ = self
            .event_tx
            .send(PeerConnectionEvent::Connected {
                peer_id: peer_id.to_string(),
            })
            .await;

        Ok(())
    }

    /// 断开与目标 peer 的连接
    pub async fn disconnect(&self, peer_id: &str) {
        // 先从传输层断开
        if let Err(e) = self.transport.disconnect(peer_id).await {
            warn!("Error disconnecting transport for {}: {}", peer_id, e);
        }

        // 移除连接元数据
        if self.connections.remove(peer_id).is_some() {
            info!("Disconnected from {}", peer_id);

            let _ = self
                .event_tx
                .send(PeerConnectionEvent::Disconnected {
                    peer_id: peer_id.to_string(),
                    reason: "Manual disconnect".to_string(),
                })
                .await;
        }
    }

    /// 发送业务消息
    ///
    /// 通过传输层发送 BusinessEnvelope 消息到目标 peer
    pub async fn send_message(
        &self,
        peer_id: &str,
        envelope: BusinessEnvelope,
    ) -> anyhow::Result<()> {
        // 检查连接状态
        {
            let conn = self
                .connections
                .get(peer_id)
                .ok_or_else(|| anyhow::anyhow!("Connection not found for peer {}", peer_id))?;

            if !conn.is_connected() {
                return Err(anyhow::anyhow!(
                    "Not connected to peer {}, call connect() first",
                    peer_id
                ));
            }
        }

        // 通过传输层发送
        self.transport.send(peer_id, envelope.clone()).await?;

        // 更新连接活跃时间
        if let Some(mut conn) = self.connections.get_mut(peer_id) {
            conn.touch();
        }

        debug!(
            "Business message sent to {}: type={:?}",
            peer_id, envelope.type_
        );
        Ok(())
    }

    /// 创建业务消息信封
    pub fn create_envelope(
        &self,
        message_type: BusinessMessageType,
        payload: Vec<u8>,
        source_id: &str,
        target_id: &str,
    ) -> BusinessEnvelope {
        let mut envelope = BusinessEnvelope::new();
        envelope.message_id = uuid::Uuid::new_v4().to_string();
        envelope.type_ = message_type;
        envelope.payload = payload;
        envelope.timestamp = chrono::Utc::now().timestamp_millis();
        envelope.source_id = source_id.to_string();
        envelope.target_id = target_id.to_string();
        envelope
    }

    /// 获取连接状态
    pub fn get_connection_state(&self, peer_id: &str) -> Option<PeerConnectionState> {
        self.connections.get(peer_id).map(|c| c.state.clone())
    }

    /// 获取所有连接
    pub fn list_connections(&self) -> Vec<(String, PeerConnectionState)> {
        self.connections
            .iter()
            .map(|entry| (entry.key().clone(), entry.value().state.clone()))
            .collect()
    }

    /// 获取已连接的 peer 数量
    pub fn connected_count(&self) -> usize {
        self.connections
            .iter()
            .filter(|entry| entry.value().is_connected())
            .count()
    }

    /// 检查是否已连接到指定 peer
    pub fn is_connected(&self, peer_id: &str) -> bool {
        // 检查本地元数据
        let local_connected = self
            .connections
            .get(peer_id)
            .map(|c| c.is_connected())
            .unwrap_or(false);

        // 同时检查传输层状态
        local_connected && self.transport.is_connected(peer_id)
    }

    /// 获取连接是否为直连（P2P）
    ///
    /// 返回 `None` 表示未连接
    /// 返回 `Some(true)` 表示 P2P 直连
    /// 返回 `Some(false)` 表示 TCP Relay 中继
    pub fn is_direct_connection(&self, peer_id: &str) -> Option<bool> {
        if !self.is_connected(peer_id) {
            return None;
        }

        self.transport
            .get_connection_info(peer_id)
            .map(|info| info.is_direct)
    }

    /// 清理过期连接
    pub async fn cleanup_stale_connections(&self, max_idle: Duration) {
        let now = std::time::Instant::now();
        let stale_peers: Vec<String> = self
            .connections
            .iter()
            .filter(|entry| now.duration_since(entry.value().last_active) > max_idle)
            .map(|entry| entry.key().clone())
            .collect();

        for peer_id in stale_peers {
            warn!("Cleaning up stale connection to {}", peer_id);
            self.disconnect(&peer_id).await;
        }
    }

    /// 获取传输层引用（用于高级用例）
    pub fn transport(&self) -> &Arc<T> {
        &self.transport
    }
}

impl Default for PeerConnectionManager<RustDeskTransport> {
    fn default() -> Self {
        Self::with_rustdesk()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peer_connection::transport::mock::MockTransport;

    #[test]
    fn test_peer_connection_manager_new() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);
        assert_eq!(manager.connected_count(), 0);
    }

    #[tokio::test]
    async fn test_connect_p2p_sets_is_direct_true() {
        let transport = Arc::new(MockTransport::new()); // P2P 模式
        let manager = PeerConnectionManager::new(transport);

        manager
            .connect("peer-001", Some("pwd".into()))
            .await
            .unwrap();

        assert!(manager.is_connected("peer-001"));
        assert_eq!(manager.is_direct_connection("peer-001"), Some(true));
    }

    #[tokio::test]
    async fn test_connect_relay_sets_is_direct_false() {
        let transport = Arc::new(MockTransport::with_relay()); // Relay 模式
        let manager = PeerConnectionManager::new(transport);

        manager.connect("peer-001", None).await.unwrap();

        assert!(manager.is_connected("peer-001"));
        assert_eq!(manager.is_direct_connection("peer-001"), Some(false));
    }

    #[tokio::test]
    async fn test_connect_failure() {
        let transport = Arc::new(MockTransport::with_connect_failure());
        let manager = PeerConnectionManager::new(transport);

        let result = manager.connect("peer-001", None).await;

        assert!(result.is_err());
        assert!(!manager.is_connected("peer-001"));
    }

    #[tokio::test]
    async fn test_reuse_existing_connection() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        // 第一次连接
        manager.connect("peer-001", None).await.unwrap();
        assert_eq!(manager.connected_count(), 1);

        // 第二次连接应该复用
        manager.connect("peer-001", None).await.unwrap();
        assert_eq!(manager.connected_count(), 1);
    }

    #[tokio::test]
    async fn test_disconnect() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        manager.connect("peer-001", None).await.unwrap();
        assert!(manager.is_connected("peer-001"));

        manager.disconnect("peer-001").await;

        assert!(!manager.is_connected("peer-001"));
        assert_eq!(manager.connected_count(), 0);
    }

    #[tokio::test]
    async fn test_send_message_records_in_mock() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport.clone());

        manager.connect("peer-001", None).await.unwrap();

        let envelope = manager.create_envelope(
            BusinessMessageType::AgentTaskRequest,
            b"test payload".to_vec(),
            "admin-001",
            "peer-001",
        );

        manager
            .send_message("peer-001", envelope.clone())
            .await
            .unwrap();

        let sent = transport.get_sent_messages("peer-001");
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].message_id, envelope.message_id);
    }

    #[tokio::test]
    async fn test_send_message_without_connection() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        let envelope = manager.create_envelope(
            BusinessMessageType::AgentTaskRequest,
            b"test".to_vec(),
            "admin-001",
            "peer-001",
        );

        let result = manager.send_message("peer-001", envelope).await;

        assert!(result.is_err());
    }

    #[test]
    fn test_create_envelope() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        let envelope = manager.create_envelope(
            BusinessMessageType::AgentTaskRequest,
            b"test payload".to_vec(),
            "admin-001",
            "client-001",
        );

        assert!(!envelope.message_id.is_empty());
        assert_eq!(
            envelope.type_ as i32,
            BusinessMessageType::AgentTaskRequest as i32
        );
        assert_eq!(envelope.payload.as_slice(), b"test payload");
        assert_eq!(envelope.source_id, "admin-001");
        assert_eq!(envelope.target_id, "client-001");
    }

    #[tokio::test]
    async fn test_is_direct_connection_returns_none_when_not_connected() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        assert!(manager.is_direct_connection("peer-001").is_none());
    }

    #[tokio::test]
    async fn test_list_connections() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        manager.connect("peer-001", None).await.unwrap();
        manager.connect("peer-002", None).await.unwrap();

        let connections = manager.list_connections();

        assert_eq!(connections.len(), 2);
        assert!(connections
            .iter()
            .all(|(_, state)| matches!(state, PeerConnectionState::Connected)));
    }

    #[tokio::test]
    async fn test_get_connection_state() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        assert!(manager.get_connection_state("peer-001").is_none());

        manager.connect("peer-001", None).await.unwrap();

        assert_eq!(
            manager.get_connection_state("peer-001"),
            Some(PeerConnectionState::Connected)
        );
    }

    #[tokio::test]
    async fn test_self_id() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        assert!(manager.get_self_id().await.is_none());

        manager.set_self_id("admin-001".to_string()).await;

        assert_eq!(manager.get_self_id().await, Some("admin-001".to_string()));
    }

    #[tokio::test]
    async fn test_cleanup_stale_connections() {
        let transport = Arc::new(MockTransport::new());
        let manager = PeerConnectionManager::new(transport);

        manager.connect("peer-001", None).await.unwrap();

        // 使用 0 秒超时，所有连接都应该被清理
        manager
            .cleanup_stale_connections(Duration::from_secs(0))
            .await;

        assert!(!manager.is_connected("peer-001"));
    }
}

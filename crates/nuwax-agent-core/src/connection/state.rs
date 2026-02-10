//! 连接状态管理
//!
//! 管理与 data-server 的连接状态

use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};
use tracing::{debug, error, info, warn};

use super::adapter::{AdapterEvent, ConnectionAdapter, RustDeskAdapter};
use super::business_handler::BusinessMessageHandler;
use crate::business_channel::BusinessEnvelope;

/// 连接模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    /// P2P 直连
    P2P,
    /// 中继模式
    Relay,
}

/// 连接状态
#[derive(Debug, Clone, PartialEq, Default)]
pub enum ConnectionState {
    /// 已断开
    #[default]
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接（模式，延迟 ms）
    Connected {
        mode: ConnectionMode,
        latency_ms: u32,
        client_id: String,
    },
    /// 错误
    Error(String),
}

/// 连接状态变化事件
#[derive(Debug, Clone)]
pub enum ConnectionEvent {
    /// 状态变化
    StateChanged(ConnectionState),
    /// 延迟更新
    LatencyUpdated(u32),
}

/// 连接配置
#[derive(Debug, Clone)]
pub struct ConnectionConfig {
    /// 信令服务器地址
    pub hbbs_addr: String,
    /// 中继服务器地址
    pub hbbr_addr: String,
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            hbbs_addr: "47.109.204.125:21116".to_string(),
            hbbr_addr: "47.109.204.125:21117".to_string(),
        }
    }
}

/// 连接管理器
///
/// 泛型参数 A 是连接适配器类型，默认使用 RustDeskAdapter。
/// 测试时可以注入 MockAdapter 来模拟连接行为。
pub struct ConnectionManager<A: ConnectionAdapter = RustDeskAdapter> {
    /// 当前状态
    state: Arc<RwLock<ConnectionState>>,
    /// 事件广播
    event_tx: broadcast::Sender<ConnectionEvent>,
    /// 服务器配置
    config: ConnectionConfig,
    /// 连接适配层
    adapter: Arc<RwLock<Option<A>>>,
    /// 适配器工厂函数
    adapter_factory: Arc<dyn Fn() -> A + Send + Sync>,
    /// 业务消息处理器
    business_handler: Arc<RwLock<Option<Arc<BusinessMessageHandler>>>>,
    /// 业务消息接收通道（用于从外部注入消息）
    business_msg_tx: mpsc::Sender<BusinessEnvelope>,
    /// 业务消息接收通道（内部处理）
    business_msg_rx: Arc<Mutex<mpsc::Receiver<BusinessEnvelope>>>,
}

// 默认实现（生产环境）
impl ConnectionManager<RustDeskAdapter> {
    /// 创建新的连接管理器（生产环境，使用 RustDeskAdapter）
    pub fn new(config: ConnectionConfig) -> Self {
        Self::with_adapter_factory(config, RustDeskAdapter::new)
    }
}

// 泛型实现（支持依赖注入）
impl<A: ConnectionAdapter + 'static> ConnectionManager<A> {
    /// 创建带自定义适配器工厂的连接管理器（测试用）
    ///
    /// # Example
    ///
    /// ```ignore
    /// let manager = ConnectionManager::with_adapter_factory(
    ///     ConnectionConfig::default(),
    ///     || MockAdapter::with_client_id("test-001"),
    /// );
    /// ```
    pub fn with_adapter_factory<F>(config: ConnectionConfig, adapter_factory: F) -> Self
    where
        F: Fn() -> A + Send + Sync + 'static,
    {
        let (event_tx, _) = broadcast::channel(32);
        let (business_msg_tx, business_msg_rx) = mpsc::channel(64);
        Self {
            state: Arc::new(RwLock::new(ConnectionState::Disconnected)),
            event_tx,
            config,
            adapter: Arc::new(RwLock::new(None)),
            adapter_factory: Arc::new(adapter_factory),
            business_handler: Arc::new(RwLock::new(None)),
            business_msg_tx,
            business_msg_rx: Arc::new(Mutex::new(business_msg_rx)),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> ConnectionState {
        self.state.read().await.clone()
    }

    /// 订阅状态变化
    pub fn subscribe(&self) -> broadcast::Receiver<ConnectionEvent> {
        self.event_tx.subscribe()
    }

    /// 设置连接状态
    pub async fn set_state(&self, state: ConnectionState) {
        let mut current = self.state.write().await;
        if *current != state {
            info!("Connection state changed: {:?} -> {:?}", *current, state);
            *current = state.clone();
            let _ = self.event_tx.send(ConnectionEvent::StateChanged(state));
        }
    }

    /// 开始连接 — 通过适配器连接到 data-server
    pub async fn connect(&self) -> anyhow::Result<()> {
        self.set_state(ConnectionState::Connecting).await;

        // 使用工厂函数创建适配器
        let adapter = (self.adapter_factory)();
        adapter.configure_server(&self.config.hbbs_addr, &self.config.hbbr_addr);

        // 获取事件接收器（在 start 之前）
        let event_rx = adapter.event_receiver();

        // 启动适配层
        if let Err(e) = adapter.start().await {
            let msg = format!("Failed to start adapter: {}", e);
            error!("{}", msg);
            self.set_state(ConnectionState::Error(msg)).await;
            return Err(e);
        }

        // 保存适配层引用
        *self.adapter.write().await = Some(adapter);

        // 启动事件处理循环
        self.spawn_event_handler(event_rx);

        Ok(())
    }

    /// 启动事件处理循环
    fn spawn_event_handler(&self, event_rx: Arc<Mutex<mpsc::Receiver<AdapterEvent>>>) {
        let state = self.state.clone();
        let event_tx = self.event_tx.clone();

        tokio::spawn(async move {
            let mut rx = event_rx.lock().await;
            while let Some(event) = rx.recv().await {
                match event {
                    AdapterEvent::Registered { client_id } => {
                        info!("Registered with client_id: {}", client_id);
                        let new_state = ConnectionState::Connected {
                            mode: ConnectionMode::P2P,
                            latency_ms: 0,
                            client_id,
                        };
                        let mut current = state.write().await;
                        *current = new_state.clone();
                        let _ = event_tx.send(ConnectionEvent::StateChanged(new_state));
                    }
                    AdapterEvent::LatencyUpdated { latency_ms } => {
                        let mut current = state.write().await;
                        if let ConnectionState::Connected {
                            latency_ms: ref mut lat,
                            ..
                        } = *current
                        {
                            *lat = latency_ms;
                            let _ = event_tx.send(ConnectionEvent::LatencyUpdated(latency_ms));
                        }
                    }
                    AdapterEvent::Disconnected { reason } => {
                        warn!("Adapter disconnected: {}", reason);
                        let mut current = state.write().await;
                        *current = ConnectionState::Disconnected;
                        let _ = event_tx
                            .send(ConnectionEvent::StateChanged(ConnectionState::Disconnected));
                    }
                    AdapterEvent::Error { message } => {
                        error!("Adapter error: {}", message);
                        let new_state = ConnectionState::Error(message);
                        let mut current = state.write().await;
                        *current = new_state.clone();
                        let _ = event_tx.send(ConnectionEvent::StateChanged(new_state));
                    }
                    AdapterEvent::PunchHoleReceived { peer_id } => {
                        info!("Punch hole received from peer: {}", peer_id);
                    }
                }
            }
        });
    }

    /// 断开连接
    pub async fn disconnect(&self) {
        if let Some(adapter) = self.adapter.read().await.as_ref() {
            adapter.stop().await;
        }
        self.set_state(ConnectionState::Disconnected).await;
    }

    /// 更新延迟
    pub async fn update_latency(&self, latency_ms: u32) {
        let mut state = self.state.write().await;
        if let ConnectionState::Connected {
            latency_ms: ref mut lat,
            ..
        } = *state
        {
            *lat = latency_ms;
            let _ = self
                .event_tx
                .send(ConnectionEvent::LatencyUpdated(latency_ms));
        }
    }

    /// 获取客户端 ID
    pub async fn get_client_id(&self) -> Option<String> {
        if let ConnectionState::Connected { client_id, .. } = self.get_state().await {
            Some(client_id)
        } else {
            None
        }
    }

    /// 获取配置
    pub fn config(&self) -> &ConnectionConfig {
        &self.config
    }

    // ========================================================================
    // 业务消息处理相关方法
    // ========================================================================

    /// 设置业务消息处理器
    pub async fn set_business_handler(&self, handler: Arc<BusinessMessageHandler>) {
        // 设置 client ID
        if let Some(client_id) = self.get_client_id().await {
            handler.set_self_id(client_id).await;
        }

        *self.business_handler.write().await = Some(handler.clone());

        // 启动业务消息处理循环
        let handler_clone = handler;
        let msg_rx = self.business_msg_rx.clone();

        tokio::spawn(async move {
            let mut rx = msg_rx.lock().await;
            while let Some(envelope) = rx.recv().await {
                debug!(
                    "Processing business message: id={}, type={:?}",
                    envelope.message_id, envelope.type_
                );
                if let Err(e) = handler_clone.handle_message(envelope).await {
                    error!("Failed to handle business message: {}", e);
                }
            }
        });

        info!("Business message handler set and processing loop started");
    }

    /// 注入业务消息（供外部调用，将消息发送到处理队列）
    pub async fn inject_business_message(&self, envelope: BusinessEnvelope) -> anyhow::Result<()> {
        self.business_msg_tx
            .send(envelope)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to inject business message: {}", e))?;
        Ok(())
    }

    /// 获取业务消息发送通道（用于直接注入消息）
    pub fn business_message_sender(&self) -> mpsc::Sender<BusinessEnvelope> {
        self.business_msg_tx.clone()
    }

    /// 检查业务处理器是否已设置
    pub async fn has_business_handler(&self) -> bool {
        self.business_handler.read().await.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::super::adapter::mock::MockAdapter;
    use super::*;

    #[tokio::test]
    async fn test_connection_state_changes() {
        let manager = ConnectionManager::new(ConnectionConfig::default());

        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);

        manager.set_state(ConnectionState::Connecting).await;
        assert_eq!(manager.get_state().await, ConnectionState::Connecting);
    }

    #[tokio::test]
    async fn test_connection_manager_with_mock_adapter() {
        let manager = ConnectionManager::with_adapter_factory(ConnectionConfig::default(), || {
            MockAdapter::with_client_id("test-001")
        });

        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);
    }

    #[tokio::test]
    async fn test_connect_success() {
        let manager = ConnectionManager::with_adapter_factory(ConnectionConfig::default(), || {
            MockAdapter::with_client_id("test-connect-001")
        });

        // 订阅事件
        let mut rx = manager.subscribe();

        // 连接
        let result = manager.connect().await;
        assert!(result.is_ok());

        // 给事件处理一点时间
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        // 验证收到状态变化事件
        let mut found_connecting = false;
        let mut found_connected = false;

        while let Ok(event) = rx.try_recv() {
            match event {
                ConnectionEvent::StateChanged(ConnectionState::Connecting) => {
                    found_connecting = true;
                }
                ConnectionEvent::StateChanged(ConnectionState::Connected { client_id, .. }) => {
                    assert_eq!(client_id, "test-connect-001");
                    found_connected = true;
                }
                _ => {}
            }
        }

        assert!(found_connecting, "Should have received Connecting state");
        assert!(found_connected, "Should have received Connected state");

        // 验证最终状态
        let state = manager.get_state().await;
        match state {
            ConnectionState::Connected { client_id, .. } => {
                assert_eq!(client_id, "test-connect-001");
            }
            _ => panic!("Expected Connected state, got {:?}", state),
        }
    }

    #[tokio::test]
    async fn test_connect_failure() {
        let manager = ConnectionManager::with_adapter_factory(ConnectionConfig::default(), || {
            let mut adapter = MockAdapter::new();
            adapter.set_start_failure(true);
            adapter
        });

        let result = manager.connect().await;
        assert!(result.is_err());

        // 验证状态变为 Error
        let state = manager.get_state().await;
        match state {
            ConnectionState::Error(_) => {}
            _ => panic!("Expected Error state, got {:?}", state),
        }
    }

    #[tokio::test]
    async fn test_disconnect() {
        let manager = ConnectionManager::with_adapter_factory(ConnectionConfig::default(), || {
            MockAdapter::with_client_id("test-disconnect-001")
        });

        // 先连接
        manager.connect().await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        // 断开连接
        manager.disconnect().await;

        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);
    }

    #[tokio::test]
    async fn test_get_client_id() {
        let manager = ConnectionManager::with_adapter_factory(ConnectionConfig::default(), || {
            MockAdapter::with_client_id("test-client-id-001")
        });

        // 未连接时应返回 None
        assert!(manager.get_client_id().await.is_none());

        // 连接后应返回客户端 ID
        manager.connect().await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        let client_id = manager.get_client_id().await;
        assert_eq!(client_id, Some("test-client-id-001".to_string()));
    }

    #[tokio::test]
    async fn test_update_latency() {
        let manager = ConnectionManager::with_adapter_factory(ConnectionConfig::default(), || {
            MockAdapter::with_client_id("test-latency-001")
        });

        // 连接
        manager.connect().await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        // 订阅事件
        let mut rx = manager.subscribe();

        // 更新延迟
        manager.update_latency(100).await;

        // 验证收到延迟更新事件
        let event = rx.try_recv();
        match event {
            Ok(ConnectionEvent::LatencyUpdated(latency)) => {
                assert_eq!(latency, 100);
            }
            _ => panic!("Expected LatencyUpdated event"),
        }

        // 验证状态中的延迟
        let state = manager.get_state().await;
        match state {
            ConnectionState::Connected { latency_ms, .. } => {
                assert_eq!(latency_ms, 100);
            }
            _ => panic!("Expected Connected state"),
        }
    }

    #[tokio::test]
    async fn test_config() {
        let config = ConnectionConfig {
            hbbs_addr: "custom.hbbs:21116".to_string(),
            hbbr_addr: "custom.hbbr:21117".to_string(),
        };

        let manager = ConnectionManager::with_adapter_factory(config.clone(), MockAdapter::new);

        assert_eq!(manager.config().hbbs_addr, "custom.hbbs:21116");
        assert_eq!(manager.config().hbbr_addr, "custom.hbbr:21117");
    }
}

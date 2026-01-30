//! 连接状态管理
//!
//! 管理与 data-server 的连接状态

use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn, error};

use super::adapter::{RustDeskAdapter, AdapterEvent};

/// 连接模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    /// P2P 直连
    P2P,
    /// 中继模式
    Relay,
}

/// 连接状态
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    /// 已断开
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

impl Default for ConnectionState {
    fn default() -> Self {
        Self::Disconnected
    }
}

/// 连接状态变化事件
#[derive(Debug, Clone)]
pub enum ConnectionEvent {
    /// 状态变化
    StateChanged(ConnectionState),
    /// 延迟更新
    LatencyUpdated(u32),
}

/// 连接管理器
pub struct ConnectionManager {
    /// 当前状态
    state: Arc<RwLock<ConnectionState>>,
    /// 事件广播
    event_tx: broadcast::Sender<ConnectionEvent>,
    /// 服务器配置
    config: ConnectionConfig,
    /// RustDesk 适配层
    adapter: Arc<RwLock<Option<RustDeskAdapter>>>,
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
            hbbs_addr: "localhost:21116".to_string(),
            hbbr_addr: "localhost:21117".to_string(),
        }
    }
}

impl ConnectionManager {
    /// 创建新的连接管理器
    pub fn new(config: ConnectionConfig) -> Self {
        let (event_tx, _) = broadcast::channel(32);
        Self {
            state: Arc::new(RwLock::new(ConnectionState::Disconnected)),
            event_tx,
            config,
            adapter: Arc::new(RwLock::new(None)),
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

    /// 开始连接 — 通过 RustDeskAdapter 连接到 data-server
    pub async fn connect(&self) -> anyhow::Result<()> {
        self.set_state(ConnectionState::Connecting).await;

        // 创建并配置适配层
        let adapter = RustDeskAdapter::new();
        adapter.configure_server(&self.config.hbbs_addr, &self.config.hbbr_addr);

        // 获取事件接收器（在 start 之前）
        let event_rx = adapter.event_receiver();

        // 启动适配层
        if let Err(e) = adapter.start().await {
            let msg = format!("Failed to start RustDeskAdapter: {}", e);
            error!("{}", msg);
            self.set_state(ConnectionState::Error(msg)).await;
            return Err(e);
        }

        // 保存适配层引用
        *self.adapter.write().await = Some(adapter);

        // 启动事件处理循环
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
                            latency_ms: ref mut lat, ..
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
                        let _ = event_tx.send(ConnectionEvent::StateChanged(ConnectionState::Disconnected));
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

        Ok(())
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
            let _ = self.event_tx.send(ConnectionEvent::LatencyUpdated(latency_ms));
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connection_state_changes() {
        let manager = ConnectionManager::new(ConnectionConfig::default());

        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);

        manager.set_state(ConnectionState::Connecting).await;
        assert_eq!(manager.get_state().await, ConnectionState::Connecting);
    }
}

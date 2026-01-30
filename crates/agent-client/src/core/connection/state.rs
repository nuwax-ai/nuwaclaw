//! 连接状态管理
//!
//! 管理与 data-server 的连接状态

use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::info;

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

    /// 开始连接
    pub async fn connect(&self) -> anyhow::Result<()> {
        self.set_state(ConnectionState::Connecting).await;

        // TODO: 实际连接逻辑，需要集成 nuwax-rustdesk
        // 目前使用模拟实现
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // 模拟连接成功
        self.set_state(ConnectionState::Connected {
            mode: ConnectionMode::P2P,
            latency_ms: 25,
            client_id: "12345678".to_string(),
        })
        .await;

        Ok(())
    }

    /// 断开连接
    pub async fn disconnect(&self) {
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

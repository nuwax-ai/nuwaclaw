//! 消息派发抽象层
//!
//! 对业务层屏蔽底层传输方式（P2P / TcpRelay / WebSocket）。
//!
//! 层次关系（对照 RustDesk 底层）：
//!   RustDesk Stream enum (TCP/WebSocket/WebRTC)  <- 字节流层
//!   BusinessConnection (protobuf 编解码)          <- 协议层
//!   MessageDispatcher trait                       <- 业务派发层（本模块）
//!   API handlers                                  <- 业务逻辑层
//!
//! 注意：P2PDispatcher 支持 P2P 直连和 TCP Relay 两种传输方式。
//! 连接建立时 RustDesk 底层会自动选择可用通道（P2P 优先，失败则回退到 Relay）。
//! 上层通过 `DispatchResult.transport` 可知实际使用的传输方式。

use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use tokio::sync::RwLock;
use tracing::info;

use nuwax_agent_core::business_channel::BusinessMessageType;

use crate::peer_connection::{PeerConnectionManager, RustDeskTransport, Transport};

/// 消息派发结果
#[derive(Debug, Clone, Serialize)]
pub struct DispatchResult {
    /// 发送后的消息 ID
    pub message_id: String,
    /// 实际使用的传输方式
    pub transport: TransportKind,
}

/// 传输方式（对齐 RustDesk 底层 Stream 枚举支持的协议）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportKind {
    /// RustDesk P2P 直连（最优先）
    P2P,
    /// RustDesk TCP 中继（relay）
    TcpRelay,
    /// WebSocket 传输（浏览器远程桌面等场景，优先级最低）
    WebSocket,
}

/// 消息派发 trait — 对业务层屏蔽底层传输方式
///
/// 传输选择优先级：P2P > TcpRelay > WebSocket
/// 如果所有传输均不可用，Fail Fast 返回错误，不做离线队列。
#[async_trait]
pub trait MessageDispatcher: Send + Sync {
    /// 向客户端发送业务消息
    ///
    /// 实现者按优先级尝试可用传输：P2P > TcpRelay > WebSocket
    /// 所有传输均不可用时返回 Err，遵循 Fail Fast 原则
    async fn dispatch(
        &self,
        client_id: &str,
        message_type: BusinessMessageType,
        payload: serde_json::Value,
    ) -> anyhow::Result<DispatchResult>;

    /// 检查到客户端是否有活跃的实时连接
    fn has_realtime_connection(&self, client_id: &str) -> bool;
}

/// RustDesk 传输派发器
///
/// 支持 P2P 直连和 TCP Relay 两种传输方式。
/// 连接建立时 RustDesk 底层会自动选择可用通道（P2P 优先，失败则回退到 Relay）。
/// 如果没有已建立的连接，Fail Fast 返回错误。
///
/// # 类型参数
///
/// - `T`: 传输层实现，必须实现 `Transport` trait
pub struct P2PDispatcher<T: Transport = RustDeskTransport> {
    peer_connections: Arc<PeerConnectionManager<T>>,
    bridge_self_id: Arc<RwLock<Option<String>>>,
}

impl<T: Transport + 'static> P2PDispatcher<T> {
    pub fn new(
        peer_connections: Arc<PeerConnectionManager<T>>,
        bridge_self_id: Arc<RwLock<Option<String>>>,
    ) -> Self {
        Self {
            peer_connections,
            bridge_self_id,
        }
    }
}

#[async_trait]
impl<T: Transport + 'static> MessageDispatcher for P2PDispatcher<T> {
    async fn dispatch(
        &self,
        client_id: &str,
        message_type: BusinessMessageType,
        payload: serde_json::Value,
    ) -> anyhow::Result<DispatchResult> {
        // 检查连接是否可用（包括 P2P 直连和 TCP Relay）
        if !self.peer_connections.is_connected(client_id) {
            anyhow::bail!("No available transport to client {}", client_id);
        }

        // 序列化 payload
        let payload_bytes = serde_json::to_vec(&payload)
            .map_err(|e| anyhow::anyhow!("Failed to serialize payload: {}", e))?;

        // 创建信封并发送
        let self_id = self.bridge_self_id.read().await.clone().unwrap_or_default();

        let envelope =
            self.peer_connections
                .create_envelope(message_type, payload_bytes, &self_id, client_id);

        let message_id = envelope.message_id.clone();

        self.peer_connections
            .send_message(client_id, envelope)
            .await?;

        // 获取实际使用的传输方式
        let transport = if self
            .peer_connections
            .is_direct_connection(client_id)
            .unwrap_or(true)
        {
            TransportKind::P2P
        } else {
            TransportKind::TcpRelay
        };

        info!(
            "Message {} dispatched via {:?} to client {}: type={:?}",
            message_id, transport, client_id, message_type
        );

        Ok(DispatchResult {
            message_id,
            transport,
        })
    }

    fn has_realtime_connection(&self, client_id: &str) -> bool {
        self.peer_connections.is_connected(client_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peer_connection::MockTransport;

    #[test]
    fn test_transport_kind_serialization() {
        assert_eq!(
            serde_json::to_string(&TransportKind::P2P).unwrap(),
            "\"p2p\""
        );
        assert_eq!(
            serde_json::to_string(&TransportKind::TcpRelay).unwrap(),
            "\"tcp_relay\""
        );
        assert_eq!(
            serde_json::to_string(&TransportKind::WebSocket).unwrap(),
            "\"web_socket\""
        );
    }

    #[test]
    fn test_dispatch_result_serialization() {
        let result = DispatchResult {
            message_id: "test-id".to_string(),
            transport: TransportKind::P2P,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["message_id"], "test-id");
        assert_eq!(json["transport"], "p2p");
    }

    #[tokio::test]
    async fn test_dispatch_returns_p2p_for_direct_connection() {
        let transport = Arc::new(MockTransport::new()); // P2P 直连
        let manager = Arc::new(PeerConnectionManager::new(transport));
        manager.connect("client-001", None).await.unwrap();

        let bridge_self_id = Arc::new(RwLock::new(Some("admin-001".to_string())));
        let dispatcher = P2PDispatcher::new(manager, bridge_self_id);

        let result = dispatcher
            .dispatch(
                "client-001",
                BusinessMessageType::AgentTaskRequest,
                serde_json::json!({"task": "test"}),
            )
            .await
            .unwrap();

        assert_eq!(result.transport, TransportKind::P2P);
        assert!(!result.message_id.is_empty());
    }

    #[tokio::test]
    async fn test_dispatch_returns_relay_for_indirect_connection() {
        let transport = Arc::new(MockTransport::with_relay()); // Relay 模式
        let manager = Arc::new(PeerConnectionManager::new(transport));
        manager.connect("client-001", None).await.unwrap();

        let bridge_self_id = Arc::new(RwLock::new(Some("admin-001".to_string())));
        let dispatcher = P2PDispatcher::new(manager, bridge_self_id);

        let result = dispatcher
            .dispatch(
                "client-001",
                BusinessMessageType::AgentTaskRequest,
                serde_json::json!({"task": "test"}),
            )
            .await
            .unwrap();

        assert_eq!(result.transport, TransportKind::TcpRelay);
    }

    #[tokio::test]
    async fn test_dispatch_fails_when_not_connected() {
        let transport = Arc::new(MockTransport::new());
        let manager = Arc::new(PeerConnectionManager::new(transport));
        // 不连接

        let bridge_self_id = Arc::new(RwLock::new(Some("admin-001".to_string())));
        let dispatcher = P2PDispatcher::new(manager, bridge_self_id);

        let result = dispatcher
            .dispatch(
                "client-001",
                BusinessMessageType::AgentTaskRequest,
                serde_json::json!({}),
            )
            .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("No available transport"));
    }

    #[tokio::test]
    async fn test_has_realtime_connection() {
        let transport = Arc::new(MockTransport::new());
        let manager = Arc::new(PeerConnectionManager::new(transport));

        let bridge_self_id = Arc::new(RwLock::new(None));
        let dispatcher = P2PDispatcher::new(manager.clone(), bridge_self_id);

        assert!(!dispatcher.has_realtime_connection("client-001"));

        manager.connect("client-001", None).await.unwrap();

        assert!(dispatcher.has_realtime_connection("client-001"));
    }

    #[tokio::test]
    async fn test_dispatch_with_default_self_id() {
        let transport = Arc::new(MockTransport::new());
        let manager = Arc::new(PeerConnectionManager::new(transport));
        manager.connect("client-001", None).await.unwrap();

        // bridge_self_id 为 None
        let bridge_self_id = Arc::new(RwLock::new(None));
        let dispatcher = P2PDispatcher::new(manager, bridge_self_id);

        let result = dispatcher
            .dispatch(
                "client-001",
                BusinessMessageType::AgentTaskRequest,
                serde_json::json!({}),
            )
            .await;

        // 即使 self_id 为空，dispatch 也应该成功
        assert!(result.is_ok());
    }
}

//! 传输层抽象
//!
//! 定义可测试的传输层 trait，将 RustDesk 底层实现细节与业务逻辑解耦。
//! 遵循依赖倒置原则（DIP）：高层模块不依赖低层模块，二者依赖抽象。

use async_trait::async_trait;
use nuwax_agent_core::business_channel::BusinessEnvelope;

/// 连接信息
#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    /// 目标 peer ID
    pub peer_id: String,
    /// 是否为直连（P2P），false 表示 TCP Relay
    pub is_direct: bool,
}

/// 传输层 trait
///
/// 抽象消息发送/接收操作，使 `PeerConnectionManager` 可测试。
///
/// # 实现
/// - `RustDeskTransport`: 生产环境，使用真实 RustDesk 连接
/// - `MockTransport`: 测试环境，模拟连接行为
#[async_trait]
pub trait Transport: Send + Sync {
    /// 建立到目标 peer 的连接
    ///
    /// 返回连接信息（包含 is_direct 标识）
    async fn connect(
        &self,
        peer_id: &str,
        password: Option<String>,
    ) -> anyhow::Result<ConnectionInfo>;

    /// 发送业务消息
    async fn send(&self, peer_id: &str, envelope: BusinessEnvelope) -> anyhow::Result<()>;

    /// 关闭连接
    async fn disconnect(&self, peer_id: &str) -> anyhow::Result<()>;

    /// 检查是否已连接
    fn is_connected(&self, peer_id: &str) -> bool;

    /// 获取连接信息
    fn get_connection_info(&self, peer_id: &str) -> Option<ConnectionInfo>;
}

/// 连接工厂 trait
///
/// 用于创建传输层实例，支持依赖注入。
pub trait TransportFactory: Send + Sync {
    /// 创建传输层实例
    fn create(&self) -> Box<dyn Transport>;
}

#[cfg(test)]
pub mod mock {
    use super::*;
    use dashmap::DashMap;
    use std::sync::Arc;

    /// Mock 传输层 - 用于单元测试
    ///
    /// 模拟 P2P/Relay 连接行为，无需真实网络。
    pub struct MockTransport {
        /// 模拟的连接状态
        connections: Arc<DashMap<String, MockConnection>>,
        /// 发送的消息记录（用于断言）
        sent_messages: Arc<DashMap<String, Vec<BusinessEnvelope>>>,
        /// 强制使用 Relay（模拟 NAT 穿透失败）
        force_relay: bool,
        /// 模拟连接失败
        fail_connect: bool,
    }

    struct MockConnection {
        info: ConnectionInfo,
    }

    impl MockTransport {
        /// 创建默认 mock（P2P 直连）
        pub fn new() -> Self {
            Self {
                connections: Arc::new(DashMap::new()),
                sent_messages: Arc::new(DashMap::new()),
                force_relay: false,
                fail_connect: false,
            }
        }

        /// 创建强制 Relay 模式的 mock
        pub fn with_relay() -> Self {
            Self {
                force_relay: true,
                ..Self::new()
            }
        }

        /// 创建连接失败的 mock
        pub fn with_connect_failure() -> Self {
            Self {
                fail_connect: true,
                ..Self::new()
            }
        }

        /// 获取发送的消息（用于测试断言）
        pub fn get_sent_messages(&self, peer_id: &str) -> Vec<BusinessEnvelope> {
            self.sent_messages
                .get(peer_id)
                .map(|v| v.clone())
                .unwrap_or_default()
        }

        /// 模拟预建立连接（用于测试初始状态）
        pub fn simulate_connected(&self, peer_id: &str, is_direct: bool) {
            self.connections.insert(
                peer_id.to_string(),
                MockConnection {
                    info: ConnectionInfo {
                        peer_id: peer_id.to_string(),
                        is_direct,
                    },
                },
            );
        }
    }

    impl Default for MockTransport {
        fn default() -> Self {
            Self::new()
        }
    }

    #[async_trait]
    impl Transport for MockTransport {
        async fn connect(
            &self,
            peer_id: &str,
            _password: Option<String>,
        ) -> anyhow::Result<ConnectionInfo> {
            if self.fail_connect {
                anyhow::bail!("Simulated connection failure");
            }

            let is_direct = !self.force_relay;
            let info = ConnectionInfo {
                peer_id: peer_id.to_string(),
                is_direct,
            };

            self.connections
                .insert(peer_id.to_string(), MockConnection { info: info.clone() });

            Ok(info)
        }

        async fn send(&self, peer_id: &str, envelope: BusinessEnvelope) -> anyhow::Result<()> {
            if !self.is_connected(peer_id) {
                anyhow::bail!("Not connected to peer {}", peer_id);
            }

            self.sent_messages
                .entry(peer_id.to_string())
                .or_default()
                .push(envelope);

            Ok(())
        }

        async fn disconnect(&self, peer_id: &str) -> anyhow::Result<()> {
            self.connections.remove(peer_id);
            Ok(())
        }

        fn is_connected(&self, peer_id: &str) -> bool {
            self.connections.contains_key(peer_id)
        }

        fn get_connection_info(&self, peer_id: &str) -> Option<ConnectionInfo> {
            self.connections.get(peer_id).map(|c| c.info.clone())
        }
    }

    /// Mock 传输工厂
    pub struct MockTransportFactory {
        force_relay: bool,
        fail_connect: bool,
    }

    impl MockTransportFactory {
        pub fn new() -> Self {
            Self {
                force_relay: false,
                fail_connect: false,
            }
        }

        pub fn with_relay() -> Self {
            Self {
                force_relay: true,
                fail_connect: false,
            }
        }

        pub fn with_failure() -> Self {
            Self {
                force_relay: false,
                fail_connect: true,
            }
        }
    }

    impl Default for MockTransportFactory {
        fn default() -> Self {
            Self::new()
        }
    }

    impl TransportFactory for MockTransportFactory {
        fn create(&self) -> Box<dyn Transport> {
            let mut transport = MockTransport::new();
            transport.force_relay = self.force_relay;
            transport.fail_connect = self.fail_connect;
            Box::new(transport)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[tokio::test]
        async fn test_mock_transport_p2p_connect() {
            let transport = MockTransport::new();

            let info = transport
                .connect("peer-001", Some("password".to_string()))
                .await
                .unwrap();

            assert!(info.is_direct, "Default mock should be P2P direct");
            assert!(transport.is_connected("peer-001"));
        }

        #[tokio::test]
        async fn test_mock_transport_relay_connect() {
            let transport = MockTransport::with_relay();

            let info = transport.connect("peer-001", None).await.unwrap();

            assert!(!info.is_direct, "Relay mock should not be direct");
            assert!(transport.is_connected("peer-001"));
        }

        #[tokio::test]
        async fn test_mock_transport_connect_failure() {
            let transport = MockTransport::with_connect_failure();

            let result = transport.connect("peer-001", None).await;

            assert!(result.is_err());
            assert!(!transport.is_connected("peer-001"));
        }

        #[tokio::test]
        async fn test_mock_transport_send_message() {
            let transport = MockTransport::new();
            transport.connect("peer-001", None).await.unwrap();

            let mut envelope = BusinessEnvelope::new();
            envelope.message_id = "msg-001".to_string();

            transport.send("peer-001", envelope.clone()).await.unwrap();

            let sent = transport.get_sent_messages("peer-001");
            assert_eq!(sent.len(), 1);
            assert_eq!(sent[0].message_id, "msg-001");
        }

        #[tokio::test]
        async fn test_mock_transport_send_without_connect() {
            let transport = MockTransport::new();

            let envelope = BusinessEnvelope::new();
            let result = transport.send("peer-001", envelope).await;

            assert!(result.is_err());
        }

        #[tokio::test]
        async fn test_mock_transport_disconnect() {
            let transport = MockTransport::new();
            transport.connect("peer-001", None).await.unwrap();
            assert!(transport.is_connected("peer-001"));

            transport.disconnect("peer-001").await.unwrap();

            assert!(!transport.is_connected("peer-001"));
        }

        #[tokio::test]
        async fn test_mock_transport_get_connection_info() {
            let transport = MockTransport::new();
            transport.connect("peer-001", None).await.unwrap();

            let info = transport.get_connection_info("peer-001");

            assert!(info.is_some());
            assert!(info.unwrap().is_direct);
        }

        #[tokio::test]
        async fn test_simulate_connected() {
            let transport = MockTransport::new();

            // 模拟已建立的 Relay 连接
            transport.simulate_connected("peer-001", false);

            assert!(transport.is_connected("peer-001"));
            let info = transport.get_connection_info("peer-001").unwrap();
            assert!(!info.is_direct, "Should be Relay");
        }
    }
}

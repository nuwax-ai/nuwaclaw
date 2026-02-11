//! RustDesk 传输层实现
//!
//! 封装 RustDesk `Client::start()` 调用，实现 `Transport` trait。
//! 这是生产环境使用的真实传输层实现。

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use dashmap::DashMap;
use tokio::sync::mpsc;
use tracing::{debug, error, info};

use librustdesk::client_api::Client;
use librustdesk::hbb_common::rendezvous_proto::ConnType;
use librustdesk::hbb_common::Stream;
use nuwax_agent_core::business_channel::BusinessEnvelope;

use crate::business_connection::{BusinessConnection, BusinessConnectionEvent, BusinessInterface};

use super::transport::{ConnectionInfo, Transport};

/// 安全 spawn 包装器 — 捕获 panic 并记录日志
macro_rules! spawn_safe {
    ($task_name:expr, $future:expr) => {
        tokio::spawn(async move {
            if let Err(e) = tokio::panic::catch_unwind(|| {
                futures::executor::block_on($future)
            }).await {
                error!("Task '{}' panicked: {:?}", $task_name, e);
            }
        })
    };
    ($future:expr) => {
        tokio::spawn(async move {
            if let Err(e) = tokio::panic::catch_unwind(|| {
                futures::executor::block_on($future)
            }).await {
                error!("Anonymous task panicked: {:?}", e);
            }
        })
    };
}

/// 真实连接元数据
struct RealConnection {
    /// 连接信息
    info: ConnectionInfo,
    /// 业务连接
    business_conn: Arc<BusinessConnection>,
    /// 底层流（用于消息发送）
    #[allow(dead_code)]
    stream: Option<Arc<tokio::sync::RwLock<Stream>>>,
}

/// RustDesk 传输层
///
/// 生产环境使用的传输层实现，基于 RustDesk P2P/Relay 网络。
pub struct RustDeskTransport {
    /// 已建立的连接
    connections: Arc<DashMap<String, RealConnection>>,
    /// 连接超时时间
    connect_timeout: Duration,
    /// 连接事件发送通道（可选）
    event_tx: Option<mpsc::Sender<TransportEvent>>,
}

/// 传输层事件
#[derive(Debug, Clone)]
pub enum TransportEvent {
    /// 连接成功
    Connected { peer_id: String, is_direct: bool },
    /// 连接断开
    Disconnected { peer_id: String, reason: String },
    /// 收到业务消息
    MessageReceived {
        peer_id: String,
        envelope: BusinessEnvelope,
    },
    /// 错误
    Error { peer_id: String, message: String },
}

impl RustDeskTransport {
    /// 创建新的 RustDesk 传输层
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            connect_timeout: Duration::from_secs(30),
            event_tx: None,
        }
    }

    /// 创建带事件通道的传输层
    pub fn with_event_channel(event_tx: mpsc::Sender<TransportEvent>) -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            connect_timeout: Duration::from_secs(30),
            event_tx: Some(event_tx),
        }
    }

    /// 设置连接超时
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.connect_timeout = timeout;
        self
    }

    /// 获取事件发送器
    pub fn event_sender(&self) -> Option<mpsc::Sender<TransportEvent>> {
        self.event_tx.clone()
    }
}

impl Default for RustDeskTransport {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Transport for RustDeskTransport {
    async fn connect(
        &self,
        peer_id: &str,
        password: Option<String>,
    ) -> anyhow::Result<ConnectionInfo> {
        // 检查是否已连接
        if let Some(conn) = self.connections.get(peer_id) {
            debug!("Reusing existing connection to {}", peer_id);
            return Ok(conn.info.clone());
        }

        info!("Initiating P2P connection to {}", peer_id);

        // 创建业务连接事件通道
        let (biz_event_tx, mut biz_event_rx) = mpsc::channel::<BusinessConnectionEvent>(32);

        // 创建业务连接
        let business_conn = Arc::new(BusinessConnection::new(
            peer_id,
            password.clone(),
            biz_event_tx,
        ));

        // 创建 BusinessInterface 用于 RustDesk Client
        let (interface_event_tx, mut interface_event_rx) =
            mpsc::channel::<BusinessConnectionEvent>(32);
        let (interface, mut data_rx) =
            BusinessInterface::new(peer_id, password, interface_event_tx);

        let peer_id_str = peer_id.to_string();
        let connections = self.connections.clone();
        let event_tx = self.event_tx.clone();
        let business_conn_clone = business_conn.clone();
        let timeout = self.connect_timeout;

        // 用于通知连接结果的通道
        let (result_tx, result_rx) = tokio::sync::oneshot::channel();

        // 启动事件转发任务（带 panic 捕获）
        let peer_id_for_events = peer_id.to_string();
        let event_tx_for_events = self.event_tx.clone();
        spawn_safe!("event_forwarder", async move {
            while let Some(event) = biz_event_rx.recv().await {
                if let Some(tx) = &event_tx_for_events {
                    let transport_event = match event {
                        BusinessConnectionEvent::Connected { peer_id } => {
                            TransportEvent::Connected {
                                peer_id,
                                is_direct: true,
                            }
                        }
                        BusinessConnectionEvent::MessageReceived { envelope } => {
                            TransportEvent::MessageReceived {
                                peer_id: peer_id_for_events.clone(),
                                envelope,
                            }
                        }
                        BusinessConnectionEvent::Disconnected { peer_id, reason } => {
                            TransportEvent::Disconnected { peer_id, reason }
                        }
                        BusinessConnectionEvent::Error { peer_id, message } => {
                            TransportEvent::Error { peer_id, message }
                        }
                        _ => continue,
                    };
                    let _ = tx.send(transport_event).await;
                }
            }
        });

        // 启动 Interface 事件处理任务（带 panic 捕获）
        let peer_id_for_interface = peer_id.to_string();
        let event_tx_for_interface = self.event_tx.clone();
        spawn_safe!("interface_events", async move {
            while let Some(event) = interface_event_rx.recv().await {
                match event {
                    BusinessConnectionEvent::Authenticated { peer_id } => {
                        info!("P2P authentication successful for {}", peer_id);
                        if let Some(tx) = &event_tx_for_interface {
                            let _ = tx
                                .send(TransportEvent::Connected {
                                    peer_id,
                                    is_direct: true,
                                })
                                .await;
                        }
                    }
                    BusinessConnectionEvent::Error { peer_id, message } => {
                        error!("P2P authentication error for {}: {}", peer_id, message);
                        if let Some(tx) = &event_tx_for_interface {
                            let _ = tx.send(TransportEvent::Error { peer_id, message }).await;
                        }
                    }
                    _ => {}
                }
            }
            debug!("Interface event loop ended for {}", peer_id_for_interface);
        });

        // 启动 P2P 连接任务（带 panic 捕获）
        spawn_safe!("p2p_connect", async move {
            info!("Starting P2P connection to {}", peer_id_str);

            let key = String::new();
            let token = String::new();

            let connect_result = tokio::time::timeout(
                timeout,
                Client::start(
                    &peer_id_str,
                    &key,
                    &token,
                    ConnType::DEFAULT_CONN,
                    interface,
                ),
            )
            .await;

            match connect_result {
                Ok(Ok(((stream, direct, _switch_uuid, _kcp, _relay_server), _info))) => {
                    info!(
                        "P2P connection established to {} (direct: {})",
                        peer_id_str, direct
                    );

                    // 设置流到 BusinessConnection
                    business_conn_clone.set_stream(stream, direct).await;

                    // 启动消息接收循环（带 panic 捕获）
                    let recv_handle = business_conn_clone.clone().spawn_receive_loop();

                    // 创建连接信息
                    let info = ConnectionInfo {
                        peer_id: peer_id_str.clone(),
                        is_direct: direct,
                    };

                    // 保存连接
                    connections.insert(
                        peer_id_str.clone(),
                        RealConnection {
                            info: info.clone(),
                            business_conn: business_conn_clone.clone(),
                            stream: None,
                        },
                    );

                    // 发送成功事件
                    if let Some(tx) = &event_tx {
                        let _ = tx
                            .send(TransportEvent::Connected {
                                peer_id: peer_id_str.clone(),
                                is_direct: direct,
                            })
                            .await;
                    }

                    // 通知连接结果
                    let _ = result_tx.send(Ok(info));

                    // 处理 Data 消息（带 panic 捕获）
                    spawn_safe!("data_handler", async move {
                        while data_rx.recv().await.is_some() {}
                    });
                }
                Ok(Err(err)) => {
                    error!("Failed to connect to {}: {}", peer_id_str, err);

                    if let Some(tx) = &event_tx {
                        let _ = tx
                            .send(TransportEvent::Error {
                                peer_id: peer_id_str.clone(),
                                message: err.to_string(),
                            })
                            .await;
                    }

                    let _ = result_tx.send(Err(anyhow::anyhow!("Connection failed: {}", err)));
                }
                Err(_) => {
                    error!("Connection to {} timed out", peer_id_str);

                    if let Some(tx) = &event_tx {
                        let _ = tx
                            .send(TransportEvent::Error {
                                peer_id: peer_id_str.clone(),
                                message: "Connection timeout".to_string(),
                            })
                            .await;
                    }

                    let _ = result_tx.send(Err(anyhow::anyhow!("Connection timeout")));
                }
            }
        });

        // 等待连接结果
        // 注意：这里使用较短的超时，因为实际连接可能需要更长时间
        // 在生产环境中，可能需要异步处理连接建立
        match tokio::time::timeout(self.connect_timeout, result_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(anyhow::anyhow!("Connection channel closed unexpectedly")),
            Err(_) => Err(anyhow::anyhow!("Connection timeout waiting for result")),
        }
    }

    async fn send(&self, peer_id: &str, envelope: BusinessEnvelope) -> anyhow::Result<()> {
        let conn = self
            .connections
            .get(peer_id)
            .ok_or_else(|| anyhow::anyhow!("Not connected to peer {}", peer_id))?;

        conn.business_conn.send_message(envelope).await
    }

    async fn disconnect(&self, peer_id: &str) -> anyhow::Result<()> {
        if let Some((_, conn)) = self.connections.remove(peer_id) {
            info!("Disconnecting from {}", peer_id);
            conn.business_conn.close().await;

            if let Some(tx) = &self.event_tx {
                let _ = tx
                    .send(TransportEvent::Disconnected {
                        peer_id: peer_id.to_string(),
                        reason: "Manual disconnect".to_string(),
                    })
                    .await;
            }
        }
        Ok(())
    }

    fn is_connected(&self, peer_id: &str) -> bool {
        self.connections.contains_key(peer_id)
    }

    fn get_connection_info(&self, peer_id: &str) -> Option<ConnectionInfo> {
        self.connections.get(peer_id).map(|c| c.info.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rustdesk_transport_new() {
        let transport = RustDeskTransport::new();
        assert!(!transport.is_connected("some-peer"));
    }

    #[test]
    fn test_rustdesk_transport_with_timeout() {
        let transport = RustDeskTransport::new().with_timeout(Duration::from_secs(60));
        assert_eq!(transport.connect_timeout, Duration::from_secs(60));
    }

    #[tokio::test]
    async fn test_rustdesk_transport_not_connected() {
        let transport = RustDeskTransport::new();
        assert!(transport.get_connection_info("peer-001").is_none());
    }
}

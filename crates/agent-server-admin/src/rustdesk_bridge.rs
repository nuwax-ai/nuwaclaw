//! RustDesk 通信桥接层（管理端）
//!
//! 管理端通过 nuwax-rustdesk 与客户端建立连接和通信

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};

use librustdesk::hbb_common::config::Config as RustDeskConfig;

/// 管理端桥接事件
#[derive(Debug, Clone)]
#[allow(dead_code)] // 保留用于未来事件处理
pub enum BridgeEvent {
    /// 连接到 data-server 成功
    Connected,
    /// 发现在线客户端
    ClientDiscovered { client_id: String },
    /// 客户端下线
    ClientLost { client_id: String },
    /// 收到客户端消息
    MessageReceived {
        client_id: String,
        payload: Vec<u8>,
    },
    /// 连接断开
    Disconnected { reason: String },
    /// 错误
    Error { message: String },
}

/// 管理端 RustDesk 桥接层
pub struct RustDeskBridge {
    /// 是否已启动
    running: Arc<AtomicBool>,
    /// data-server (hbbs) 地址
    hbbs_addr: String,
    /// 事件发送
    event_tx: mpsc::Sender<BridgeEvent>,
    /// 事件接收（外部消费，保留用于未来事件监听）
    #[allow(dead_code)]
    event_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<BridgeEvent>>>,
    /// 已连接的客户端 peer ID 列表（保留用于未来 peer 追踪）
    #[allow(dead_code)]
    connected_peers: Arc<RwLock<Vec<String>>>,
}

impl RustDeskBridge {
    /// 创建新的桥接层
    pub fn new(hbbs_addr: &str) -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            running: Arc::new(AtomicBool::new(false)),
            hbbs_addr: hbbs_addr.to_string(),
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
            connected_peers: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 启动桥接层，连接到 data-server
    pub async fn start(&self) -> anyhow::Result<()> {
        if self.running.load(Ordering::SeqCst) {
            warn!("RustDeskBridge already running");
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);
        info!("Starting RustDeskBridge, connecting to hbbs: {}", self.hbbs_addr);

        // 配置 rendezvous server
        RustDeskConfig::set_option(
            "custom-rendezvous-server".to_string(),
            self.hbbs_addr.clone(),
        );

        let running = self.running.clone();
        let event_tx = self.event_tx.clone();

        // 启动 RendezvousMediator 用于发现客户端
        tokio::spawn(async move {
            let _ = event_tx.send(BridgeEvent::Connected).await;

            // 启动 rendezvous mediator
            librustdesk::RendezvousMediator::start_all().await;

            if running.load(Ordering::SeqCst) {
                running.store(false, Ordering::SeqCst);
                let _ = event_tx
                    .send(BridgeEvent::Disconnected {
                        reason: "RendezvousMediator exited".to_string(),
                    })
                    .await;
            }
        });

        Ok(())
    }

    /// 停止桥接层（保留用于优雅关闭）
    #[allow(dead_code)]
    pub async fn stop(&self) {
        if self.running.load(Ordering::SeqCst) {
            info!("Stopping RustDeskBridge");
            self.running.store(false, Ordering::SeqCst);
            librustdesk::RendezvousMediator::restart();
        }
    }

    /// 是否正在运行
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// 获取事件接收器（保留用于未来事件监听）
    #[allow(dead_code)]
    pub fn event_receiver(&self) -> Arc<tokio::sync::Mutex<mpsc::Receiver<BridgeEvent>>> {
        self.event_rx.clone()
    }

    /// 获取本端 ID（保留用于未来管理端标识）
    #[allow(dead_code)]
    pub fn get_self_id(&self) -> String {
        RustDeskConfig::get_id()
    }

    /// 获取已连接的 peer 列表（保留用于未来连接管理）
    #[allow(dead_code)]
    pub async fn get_connected_peers(&self) -> Vec<String> {
        self.connected_peers.read().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bridge_creation() {
        let bridge = RustDeskBridge::new("localhost:21116");
        assert!(!bridge.is_running());
    }
}

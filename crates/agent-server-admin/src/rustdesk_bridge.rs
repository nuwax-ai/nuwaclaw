//! RustDesk 通信桥接层（管理端）
//!
//! 管理端通过 nuwax-rustdesk 连接到 data-server，注册自身为一个 peer，
//! 从而可以与其他客户端建立 P2P/Relay 连接。
//!
//! 当前架构中，admin-server 与 agent-client 的主要通信通道是 HTTP 轮询机制：
//! - 客户端通过 HTTP 注册、心跳、轮询消息
//! - admin-server 将消息放入队列，客户端轮询获取
//!
//! RustDesk 桥接层的职责是：
//! 1. 将 admin-server 注册到 data-server（获取自身 peer ID）
//! 2. 提供 P2P/Relay 连接能力（未来用于远程桌面等场景）
//! 3. 监控连接状态并发送事件

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info, warn};

use librustdesk::hbb_common::config::Config as RustDeskConfig;

/// 自身 ID 轮询间隔
const ID_POLL_INTERVAL: Duration = Duration::from_secs(2);
/// 自身 ID 最大轮询次数
const ID_POLL_MAX_ATTEMPTS: u32 = 30;

/// 管理端桥接事件
#[derive(Debug, Clone)]
pub enum BridgeEvent {
    /// 连接到 data-server 成功，获取到自身 ID
    Connected { self_id: String },
    /// 发现在线客户端
    ClientDiscovered { client_id: String },
    /// 客户端下线
    ClientLost { client_id: String },
    /// 收到客户端消息
    MessageReceived { client_id: String, payload: Vec<u8> },
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
    /// 本端在 data-server 上的 ID
    self_id: Arc<RwLock<Option<String>>>,
    /// 事件发送通道
    event_tx: mpsc::Sender<BridgeEvent>,
    /// 事件接收通道（供外部消费）
    event_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<BridgeEvent>>>,
}

impl RustDeskBridge {
    /// 创建新的桥接层
    pub fn new(hbbs_addr: &str) -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            running: Arc::new(AtomicBool::new(false)),
            hbbs_addr: hbbs_addr.to_string(),
            self_id: Arc::new(RwLock::new(None)),
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
        }
    }

    /// 启动桥接层，连接到 data-server
    ///
    /// 启动流程：
    /// 1. 配置 rendezvous server 地址
    /// 2. 启动 RendezvousMediator（后台任务）
    /// 3. 轮询获取自身 ID
    /// 4. 发送 Connected 事件
    pub async fn start(&self) -> anyhow::Result<()> {
        if self.running.load(Ordering::SeqCst) {
            warn!("RustDeskBridge already running");
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);
        info!(
            "Starting RustDeskBridge, connecting to hbbs: {}",
            self.hbbs_addr
        );

        // 配置 rendezvous server 地址
        RustDeskConfig::set_option(
            "custom-rendezvous-server".to_string(),
            self.hbbs_addr.clone(),
        );

        let running = self.running.clone();
        let event_tx = self.event_tx.clone();
        let self_id = self.self_id.clone();

        // 启动 RendezvousMediator 后台任务（带 panic 捕获）
        let bridge_event_tx = self.event_tx.clone();
        let bridge_running = self.running.clone();
        tokio::spawn(async move {
            // 启动 ID 轮询任务（带 panic 捕获）
            let id_running = running.clone();
            let id_event_tx = event_tx.clone();
            let id_self_id = self_id.clone();
            let id_abort_handle = tokio::spawn(async move {
                if let Err(e) = tokio::panic::catch_unwind(|| {
                    futures::executor::block_on(async {
                        Self::poll_self_id(id_running.clone(), id_event_tx.clone(), id_self_id.clone()).await;
                    })
                }).await {
                    error!("ID polling task panicked: {:?}", e);
                }
            }).abort_handle();

            // 启动 rendezvous mediator（阻塞直到连接断开）
            let mediator_result = librustdesk::RendezvousMediator::start_all().await;

            // mediator 退出意味着连接断开
            if bridge_running.load(Ordering::SeqCst) {
                bridge_running.store(false, Ordering::SeqCst);
                *self_id.write().await = None;
                let _ = bridge_event_tx
                    .send(BridgeEvent::Disconnected {
                        reason: "RendezvousMediator exited".to_string(),
                    })
                    .await;
            }

            // 清理 ID 轮询任务
            let _ = id_abort_handle.abort();
        });

        Ok(())
    }

    /// 轮询获取自身 ID
    ///
    /// RustDesk 在连接到 rendezvous server 后才会分配/确认 ID，
    /// 因此需要定时轮询 Config::get_id() 直到获得有效 ID。
    async fn poll_self_id(
        running: Arc<AtomicBool>,
        event_tx: mpsc::Sender<BridgeEvent>,
        self_id: Arc<RwLock<Option<String>>>,
    ) {
        for attempt in 1..=ID_POLL_MAX_ATTEMPTS {
            if !running.load(Ordering::SeqCst) {
                return;
            }

            tokio::time::sleep(ID_POLL_INTERVAL).await;

            let id = RustDeskConfig::get_id();
            if !id.is_empty() {
                info!(
                    "RustDeskBridge obtained self ID: {} (attempt {})",
                    id, attempt
                );
                *self_id.write().await = Some(id.clone());
                let _ = event_tx.send(BridgeEvent::Connected { self_id: id }).await;
                return;
            }

            debug!(
                "Waiting for self ID... (attempt {}/{})",
                attempt, ID_POLL_MAX_ATTEMPTS
            );
        }

        error!(
            "Failed to obtain self ID after {} attempts",
            ID_POLL_MAX_ATTEMPTS
        );
        let _ = event_tx
            .send(BridgeEvent::Error {
                message: "Failed to obtain self ID from rendezvous server".to_string(),
            })
            .await;
    }

    /// 停止桥接层
    pub async fn stop(&self) {
        if self.running.load(Ordering::SeqCst) {
            info!("Stopping RustDeskBridge");
            self.running.store(false, Ordering::SeqCst);
            *self.self_id.write().await = None;
            librustdesk::RendezvousMediator::restart();
        }
    }

    /// 是否正在运行
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// 获取事件接收通道
    pub fn event_receiver(&self) -> Arc<tokio::sync::Mutex<mpsc::Receiver<BridgeEvent>>> {
        self.event_rx.clone()
    }

    /// 获取本端 ID
    pub async fn get_self_id(&self) -> Option<String> {
        self.self_id.read().await.clone()
    }

    /// 同步获取本端 ID（直接从 RustDesk Config 读取）
    pub fn get_self_id_sync(&self) -> String {
        RustDeskConfig::get_id()
    }

    /// 获取 hbbs 地址
    pub fn hbbs_addr(&self) -> &str {
        &self.hbbs_addr
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

    #[tokio::test]
    async fn test_bridge_self_id_initially_none() {
        let bridge = RustDeskBridge::new("localhost:21116");
        assert!(bridge.get_self_id().await.is_none());
    }
}

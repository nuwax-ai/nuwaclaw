//! RustDesk 适配层
//!
//! 隔离 nuwax-rustdesk 的复杂 API，为 ConnectionManager 提供简洁接口

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::{info, warn};

use librustdesk::hbb_common::config::Config as RustDeskConfig;

/// 适配层事件
#[derive(Debug, Clone)]
pub enum AdapterEvent {
    /// 注册成功，获取到客户端 ID
    Registered { client_id: String },
    /// 延迟更新
    LatencyUpdated { latency_ms: u32 },
    /// 收到打洞请求
    PunchHoleReceived { peer_id: String },
    /// 连接断开
    Disconnected { reason: String },
    /// 错误
    Error { message: String },
}

/// RustDesk 适配层 - 隔离 nuwax-rustdesk 的复杂 API
pub struct RustDeskAdapter {
    /// 是否已启动
    running: Arc<AtomicBool>,
    /// 客户端 ID（从 Config 获取）
    client_id: Arc<RwLock<String>>,
    /// 连接事件发送
    event_tx: mpsc::Sender<AdapterEvent>,
    /// 连接事件接收（外部消费）
    event_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<AdapterEvent>>>,
}

impl RustDeskAdapter {
    /// 创建新的适配层实例
    pub fn new() -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            running: Arc::new(AtomicBool::new(false)),
            client_id: Arc::new(RwLock::new(String::new())),
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
        }
    }

    /// 配置 RustDesk 服务器地址
    pub fn configure_server(&self, hbbs_addr: &str, _hbbr_addr: &str) {
        // 设置 rendezvous server 地址到 RustDesk Config
        RustDeskConfig::set_option("custom-rendezvous-server".to_string(), hbbs_addr.to_string());
        info!("Configured RustDesk server: hbbs={}", hbbs_addr);
    }

    /// 启动 RendezvousMediator，连接到 data-server
    pub async fn start(&self) -> anyhow::Result<()> {
        if self.running.load(Ordering::SeqCst) {
            warn!("RustDeskAdapter already running");
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);
        info!("Starting RustDeskAdapter...");

        let running = self.running.clone();
        let client_id = self.client_id.clone();
        let event_tx = self.event_tx.clone();

        // 在后台 tokio task 中启动 RendezvousMediator
        tokio::spawn(async move {
            // 获取分配的客户端 ID
            let id = RustDeskConfig::get_id();
            if !id.is_empty() {
                *client_id.write().await = id.clone();
                let _ = event_tx.send(AdapterEvent::Registered {
                    client_id: id,
                }).await;
            }

            // 启动所有 rendezvous 服务
            librustdesk::RendezvousMediator::start_all().await;

            // start_all 返回意味着已断开
            if running.load(Ordering::SeqCst) {
                running.store(false, Ordering::SeqCst);
                let _ = event_tx.send(AdapterEvent::Disconnected {
                    reason: "RendezvousMediator exited".to_string(),
                }).await;
            }
        });

        // 启动 ID 轮询任务（等待 Config 分配 ID）
        let client_id = self.client_id.clone();
        let event_tx = self.event_tx.clone();
        let running = self.running.clone();
        tokio::spawn(async move {
            // 短暂等待让 mediator 启动
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

            let mut poll_count = 0u32;
            loop {
                if !running.load(Ordering::SeqCst) {
                    break;
                }

                let id = RustDeskConfig::get_id();
                let current_id = client_id.read().await.clone();

                if !id.is_empty() && id != current_id {
                    info!("RustDesk client ID obtained: {}", id);
                    *client_id.write().await = id.clone();
                    let _ = event_tx.send(AdapterEvent::Registered {
                        client_id: id,
                    }).await;
                }

                poll_count += 1;
                // 前 10 次每秒轮询，之后每 10 秒轮询一次
                let interval = if poll_count < 10 { 1 } else { 10 };
                tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;
            }
        });

        Ok(())
    }

    /// 停止适配层
    pub async fn stop(&self) {
        if self.running.load(Ordering::SeqCst) {
            info!("Stopping RustDeskAdapter...");
            self.running.store(false, Ordering::SeqCst);
            // 触发 mediator 重启（会导致它退出当前循环）
            librustdesk::RendezvousMediator::restart();
        }
    }

    /// 是否正在运行
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// 获取客户端 ID
    pub async fn get_client_id(&self) -> String {
        self.client_id.read().await.clone()
    }

    /// 获取事件接收器
    pub fn event_receiver(&self) -> Arc<tokio::sync::Mutex<mpsc::Receiver<AdapterEvent>>> {
        self.event_rx.clone()
    }

    /// 获取当前延迟（从 RustDesk Config 间接读取）
    pub fn get_latency(&self) -> Option<u32> {
        let server = RustDeskConfig::get_rendezvous_server();
        if server.is_empty() {
            return None;
        }
        // RustDesk 存储延迟在 option 中，格式为 "latency_{host}"
        let latency_key = format!("latency_{}", server);
        let latency_str = RustDeskConfig::get_option(&latency_key);
        latency_str.parse::<i64>().ok().map(|v| v as u32)
    }
}

impl Default for RustDeskAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adapter_creation() {
        let adapter = RustDeskAdapter::new();
        assert!(!adapter.is_running());
    }
}

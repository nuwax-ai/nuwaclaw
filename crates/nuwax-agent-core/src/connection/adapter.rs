//! RustDesk 适配层
//!
//! 隔离 nuwax-rustdesk 的复杂 API，为 ConnectionManager 提供简洁接口

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{info, warn};

use async_trait::async_trait;
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

/// 连接适配器 trait
///
/// 定义连接适配器的抽象接口，用于解耦 ConnectionManager 与具体实现。
/// 生产环境使用 RustDeskAdapter，测试使用 MockAdapter。
#[async_trait]
pub trait ConnectionAdapter: Send + Sync {
    /// 配置服务器地址
    fn configure_server(&self, hbbs_addr: &str, hbbr_addr: &str);

    /// 启动连接
    async fn start(&self) -> anyhow::Result<()>;

    /// 停止连接
    async fn stop(&self);

    /// 是否运行中
    fn is_running(&self) -> bool;

    /// 获取客户端 ID
    async fn get_client_id(&self) -> String;

    /// 获取事件接收器
    fn event_receiver(&self) -> Arc<Mutex<mpsc::Receiver<AdapterEvent>>>;

    /// 获取当前延迟
    fn get_latency(&self) -> Option<u32>;
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
    event_rx: Arc<Mutex<mpsc::Receiver<AdapterEvent>>>,
}

impl RustDeskAdapter {
    /// 创建新的适配层实例
    pub fn new() -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            running: Arc::new(AtomicBool::new(false)),
            client_id: Arc::new(RwLock::new(String::new())),
            event_tx,
            event_rx: Arc::new(Mutex::new(event_rx)),
        }
    }
}

impl Default for RustDeskAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ConnectionAdapter for RustDeskAdapter {
    fn configure_server(&self, hbbs_addr: &str, _hbbr_addr: &str) {
        // 设置 rendezvous server 地址到 RustDesk Config
        RustDeskConfig::set_option(
            "custom-rendezvous-server".to_string(),
            hbbs_addr.to_string(),
        );
        info!("Configured RustDesk server: hbbs={}", hbbs_addr);
    }

    async fn start(&self) -> anyhow::Result<()> {
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
                let _ = event_tx
                    .send(AdapterEvent::Registered { client_id: id })
                    .await;
            }

            // 启动所有 rendezvous 服务
            librustdesk::RendezvousMediator::start_all().await;

            // start_all 返回意味着已断开
            if running.load(Ordering::SeqCst) {
                running.store(false, Ordering::SeqCst);
                let _ = event_tx
                    .send(AdapterEvent::Disconnected {
                        reason: "RendezvousMediator exited".to_string(),
                    })
                    .await;
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
                    let _ = event_tx
                        .send(AdapterEvent::Registered { client_id: id })
                        .await;
                }

                poll_count += 1;
                // 前 10 次每秒轮询，之后每 10 秒轮询一次
                let interval = if poll_count < 10 { 1 } else { 10 };
                tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;
            }
        });

        Ok(())
    }

    async fn stop(&self) {
        if self.running.load(Ordering::SeqCst) {
            info!("Stopping RustDeskAdapter...");
            self.running.store(false, Ordering::SeqCst);
            // 触发 mediator 重启（会导致它退出当前循环）
            librustdesk::RendezvousMediator::restart();
        }
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    async fn get_client_id(&self) -> String {
        self.client_id.read().await.clone()
    }

    fn event_receiver(&self) -> Arc<Mutex<mpsc::Receiver<AdapterEvent>>> {
        self.event_rx.clone()
    }

    fn get_latency(&self) -> Option<u32> {
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

// ============================================================================
// Mock Adapter for Testing
// ============================================================================

/// Mock 适配器，用于单元测试
///
/// 提供可控的测试行为，无需真实的 RustDesk 依赖。
#[cfg(test)]
pub mod mock {
    use super::*;

    /// Mock 连接适配器
    pub struct MockAdapter {
        /// 是否运行中
        running: AtomicBool,
        /// 预设的客户端 ID
        client_id: String,
        /// 预设延迟
        latency: Option<u32>,
        /// 事件发送器
        event_tx: mpsc::Sender<AdapterEvent>,
        /// 事件接收器
        event_rx: Arc<Mutex<mpsc::Receiver<AdapterEvent>>>,
        /// 模拟启动是否成功
        start_should_fail: bool,
        /// 服务器配置记录
        configured_server: Arc<RwLock<Option<(String, String)>>>,
    }

    impl MockAdapter {
        /// 创建新的 Mock 适配器
        #[must_use]
        pub fn new() -> Self {
            let (event_tx, event_rx) = mpsc::channel(64);
            Self {
                running: AtomicBool::new(false),
                client_id: String::new(),
                latency: None,
                event_tx,
                event_rx: Arc::new(Mutex::new(event_rx)),
                start_should_fail: false,
                configured_server: Arc::new(RwLock::new(None)),
            }
        }

        /// 创建带有预设客户端 ID 的 Mock 适配器
        #[must_use]
        pub fn with_client_id(client_id: &str) -> Self {
            let (event_tx, event_rx) = mpsc::channel(64);
            Self {
                running: AtomicBool::new(false),
                client_id: client_id.to_string(),
                latency: None,
                event_tx,
                event_rx: Arc::new(Mutex::new(event_rx)),
                start_should_fail: false,
                configured_server: Arc::new(RwLock::new(None)),
            }
        }

        /// 设置启动时是否失败
        pub fn set_start_failure(&mut self, should_fail: bool) {
            self.start_should_fail = should_fail;
        }

        /// 设置预设延迟
        pub fn set_latency(&mut self, latency: Option<u32>) {
            self.latency = latency;
        }

        /// 模拟发送事件
        pub async fn simulate_event(&self, event: AdapterEvent) {
            let _ = self.event_tx.send(event).await;
        }

        /// 获取配置的服务器地址
        pub async fn get_configured_server(&self) -> Option<(String, String)> {
            self.configured_server.read().await.clone()
        }
    }

    impl Default for MockAdapter {
        fn default() -> Self {
            Self::new()
        }
    }

    #[async_trait]
    impl ConnectionAdapter for MockAdapter {
        fn configure_server(&self, hbbs_addr: &str, hbbr_addr: &str) {
            // 使用 try_write 避免在同步上下文中阻塞
            // 在测试中如果获取锁失败应该 panic，表示测试设计有问题
            let mut server = self
                .configured_server
                .try_write()
                .expect("MockAdapter: failed to acquire write lock in configure_server");
            *server = Some((hbbs_addr.to_string(), hbbr_addr.to_string()));
        }

        async fn start(&self) -> anyhow::Result<()> {
            if self.start_should_fail {
                return Err(anyhow::anyhow!("Mock adapter start failed"));
            }

            self.running.store(true, Ordering::SeqCst);

            // 如果有预设客户端 ID，立即发送注册事件
            if !self.client_id.is_empty() {
                let _ = self
                    .event_tx
                    .send(AdapterEvent::Registered {
                        client_id: self.client_id.clone(),
                    })
                    .await;
            }

            Ok(())
        }

        async fn stop(&self) {
            self.running.store(false, Ordering::SeqCst);
            let _ = self
                .event_tx
                .send(AdapterEvent::Disconnected {
                    reason: "Mock adapter stopped".to_string(),
                })
                .await;
        }

        fn is_running(&self) -> bool {
            self.running.load(Ordering::SeqCst)
        }

        async fn get_client_id(&self) -> String {
            self.client_id.clone()
        }

        fn event_receiver(&self) -> Arc<Mutex<mpsc::Receiver<AdapterEvent>>> {
            self.event_rx.clone()
        }

        fn get_latency(&self) -> Option<u32> {
            self.latency
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mock::MockAdapter;
    use super::*;

    #[test]
    fn test_rustdesk_adapter_creation() {
        let adapter = RustDeskAdapter::new();
        assert!(!adapter.is_running());
    }

    #[tokio::test]
    async fn test_mock_adapter_creation() {
        let adapter = MockAdapter::new();
        assert!(!adapter.is_running());
        assert_eq!(adapter.get_client_id().await, "");
        assert_eq!(adapter.get_latency(), None);
    }

    #[tokio::test]
    async fn test_mock_adapter_with_client_id() {
        let adapter = MockAdapter::with_client_id("test-123");
        assert_eq!(adapter.get_client_id().await, "test-123");
    }

    #[tokio::test]
    async fn test_mock_adapter_start_success() {
        let adapter = MockAdapter::with_client_id("test-456");
        assert!(!adapter.is_running());

        let result = adapter.start().await;
        assert!(result.is_ok());
        assert!(adapter.is_running());

        // 验证注册事件被发送
        let event_rx = adapter.event_receiver();
        let mut rx = event_rx.lock().await;
        if let Some(event) = rx.recv().await {
            match event {
                AdapterEvent::Registered { client_id } => {
                    assert_eq!(client_id, "test-456");
                }
                _ => panic!("Expected Registered event"),
            }
        }
    }

    #[tokio::test]
    async fn test_mock_adapter_start_failure() {
        let mut adapter = MockAdapter::new();
        adapter.set_start_failure(true);

        let result = adapter.start().await;
        assert!(result.is_err());
        assert!(!adapter.is_running());
    }

    #[tokio::test]
    async fn test_mock_adapter_stop() {
        let adapter = MockAdapter::with_client_id("test-789");
        adapter.start().await.unwrap();
        assert!(adapter.is_running());

        adapter.stop().await;
        assert!(!adapter.is_running());
    }

    #[tokio::test]
    async fn test_mock_adapter_configure_server() {
        let adapter = MockAdapter::new();
        adapter.configure_server("hbbs.example.com", "hbbr.example.com");

        let config = adapter.get_configured_server().await;
        assert!(config.is_some());
        let (hbbs, hbbr) = config.unwrap();
        assert_eq!(hbbs, "hbbs.example.com");
        assert_eq!(hbbr, "hbbr.example.com");
    }

    #[tokio::test]
    async fn test_mock_adapter_latency() {
        let mut adapter = MockAdapter::new();
        assert_eq!(adapter.get_latency(), None);

        adapter.set_latency(Some(50));
        assert_eq!(adapter.get_latency(), Some(50));
    }

    #[tokio::test]
    async fn test_mock_adapter_simulate_event() {
        let adapter = MockAdapter::new();
        adapter.start().await.unwrap();

        // 模拟延迟更新事件
        adapter
            .simulate_event(AdapterEvent::LatencyUpdated { latency_ms: 100 })
            .await;

        let event_rx = adapter.event_receiver();
        let mut rx = event_rx.lock().await;
        if let Some(event) = rx.recv().await {
            match event {
                AdapterEvent::LatencyUpdated { latency_ms } => {
                    assert_eq!(latency_ms, 100);
                }
                _ => panic!("Expected LatencyUpdated event"),
            }
        }
    }
}

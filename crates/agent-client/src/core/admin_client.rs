//! 管理服务器客户端模块
//!
//! 用于与 agent-server-admin 通信，包括：
//! - 客户端注册
//! - 心跳发送
//! - 消息轮询
//! - 消息上报

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::{RwLock, broadcast};
use tracing::{debug, info, warn};

use super::http_client::{HttpClient, ReqwestClient};

/// 管理服务器配置
#[derive(Debug, Clone)]
pub struct AdminConfig {
    /// 管理服务器地址 (例如: http://localhost:8080)
    pub admin_url: String,
    /// 心跳间隔（秒）
    pub heartbeat_interval_secs: u64,
    /// 轮询间隔（秒）
    pub poll_interval_secs: u64,
    /// 请求超时（秒）
    pub request_timeout_secs: u64,
}

impl Default for AdminConfig {
    fn default() -> Self {
        Self {
            admin_url: "http://localhost:8080".to_string(),
            heartbeat_interval_secs: 30,
            poll_interval_secs: 5,
            request_timeout_secs: 10,
        }
    }
}

/// 客户端注册请求
#[derive(Debug, Clone, Serialize)]
pub struct RegistrationRequest {
    pub client_id: String,
    pub name: Option<String>,
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub client_version: String,
}

/// 注册响应
#[derive(Debug, Clone, Deserialize)]
pub struct RegistrationResponse {
    pub success: bool,
    pub message: String,
}

/// 心跳请求
#[derive(Debug, Clone, Serialize)]
struct HeartbeatRequest {
    client_id: String,
    latency_ms: Option<u32>,
}

/// 心跳响应
#[derive(Debug, Clone, Deserialize)]
struct HeartbeatResponse {
    success: bool,
    pending_messages: usize,
}

/// 轮询请求
#[derive(Debug, Clone, Serialize)]
struct PollRequest {
    client_id: String,
    max_messages: Option<usize>,
}

/// 待处理消息
#[derive(Debug, Clone, Deserialize)]
pub struct PendingMessage {
    pub message_id: String,
    pub message_type: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

/// 轮询响应
#[derive(Debug, Clone, Deserialize)]
struct PollResponse {
    messages: Vec<PendingMessage>,
}

/// 上报请求
#[derive(Debug, Clone, Serialize)]
struct ReportRequest {
    client_id: String,
    message_type: String,
    payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    in_reply_to: Option<String>,
}

/// 上报响应
#[derive(Debug, Clone, Deserialize)]
struct ReportResponse {
    success: bool,
    message_id: String,
}

/// 管理客户端事件
#[derive(Debug, Clone)]
pub enum AdminClientEvent {
    /// 注册成功
    Registered,
    /// 注册失败
    RegistrationFailed(String),
    /// 收到消息
    MessageReceived(PendingMessage),
    /// 连接断开
    Disconnected(String),
}

/// 管理服务器客户端
///
/// 泛型参数 H 是 HTTP 客户端类型，默认使用 ReqwestClient。
/// 测试时可以注入 MockHttpClient 来模拟 HTTP 请求。
pub struct AdminClient<H: HttpClient = ReqwestClient> {
    /// 配置
    config: AdminConfig,
    /// HTTP 客户端
    http_client: H,
    /// 客户端 ID
    client_id: Arc<RwLock<Option<String>>>,
    /// 是否已注册
    registered: Arc<RwLock<bool>>,
    /// 是否正在运行
    running: Arc<AtomicBool>,
    /// 事件发送
    event_tx: broadcast::Sender<AdminClientEvent>,
}

// 默认实现（生产环境）
impl AdminClient<ReqwestClient> {
    /// 创建新的管理客户端（生产环境，使用 ReqwestClient）
    pub fn new(config: AdminConfig) -> Self {
        let http_client = ReqwestClient::new(config.request_timeout_secs);
        Self::with_http_client(config, http_client)
    }
}

// 泛型实现（支持依赖注入）
impl<H: HttpClient + 'static> AdminClient<H> {
    /// 创建带自定义 HTTP 客户端的管理客户端（测试用）
    ///
    /// # Example
    ///
    /// ```ignore
    /// let http_client = MockHttpClient::new()
    ///     .expect_response(MockResponse::ok(&RegistrationResponse { success: true, message: "ok".into() }));
    /// let client = AdminClient::with_http_client(AdminConfig::default(), http_client);
    /// ```
    pub fn with_http_client(config: AdminConfig, http_client: H) -> Self {
        let (event_tx, _) = broadcast::channel(64);

        Self {
            config,
            http_client,
            client_id: Arc::new(RwLock::new(None)),
            registered: Arc::new(RwLock::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            event_tx,
        }
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<AdminClientEvent> {
        self.event_tx.subscribe()
    }

    /// 设置客户端 ID
    pub async fn set_client_id(&self, id: String) {
        *self.client_id.write().await = Some(id);
    }

    /// 获取客户端 ID
    pub async fn get_client_id(&self) -> Option<String> {
        self.client_id.read().await.clone()
    }

    /// 是否已注册
    pub async fn is_registered(&self) -> bool {
        *self.registered.read().await
    }

    /// 注册到管理服务器
    pub async fn register(&self, req: RegistrationRequest) -> Result<(), String> {
        let url = format!("{}/api/register", self.config.admin_url);

        info!("Registering with admin server: {}", url);

        let response = self
            .http_client
            .post(&url, &req)
            .await
            .map_err(|e| format!("Registration request failed: {}", e))?;

        if !response.is_success() {
            let body = response.text();
            return Err(format!(
                "Registration failed: {} - {}",
                response.status, body
            ));
        }

        let resp: RegistrationResponse = response
            .json()
            .map_err(|e| format!("Failed to parse registration response: {}", e))?;

        if resp.success {
            *self.client_id.write().await = Some(req.client_id);
            *self.registered.write().await = true;
            let _ = self.event_tx.send(AdminClientEvent::Registered);
            info!("Successfully registered with admin server");
            Ok(())
        } else {
            let _ = self
                .event_tx
                .send(AdminClientEvent::RegistrationFailed(resp.message.clone()));
            Err(resp.message)
        }
    }

    /// 发送心跳
    pub async fn send_heartbeat(&self, latency_ms: Option<u32>) -> Result<usize, String> {
        let client_id = self
            .client_id
            .read()
            .await
            .clone()
            .ok_or_else(|| "Client ID not set".to_string())?;

        let url = format!("{}/api/heartbeat", self.config.admin_url);

        let req = HeartbeatRequest {
            client_id,
            latency_ms,
        };

        let response = self
            .http_client
            .post(&url, &req)
            .await
            .map_err(|e| format!("Heartbeat request failed: {}", e))?;

        if response.status == 404 {
            // 需要重新注册
            *self.registered.write().await = false;
            return Err("Client not registered, need to re-register".to_string());
        }

        if !response.is_success() {
            return Err(format!("Heartbeat failed: {}", response.status));
        }

        let resp: HeartbeatResponse = response
            .json()
            .map_err(|e| format!("Failed to parse heartbeat response: {}", e))?;

        Ok(resp.pending_messages)
    }

    /// 轮询消息
    pub async fn poll_messages(
        &self,
        max_messages: Option<usize>,
    ) -> Result<Vec<PendingMessage>, String> {
        let client_id = self
            .client_id
            .read()
            .await
            .clone()
            .ok_or_else(|| "Client ID not set".to_string())?;

        let url = format!("{}/api/poll", self.config.admin_url);

        let req = PollRequest {
            client_id,
            max_messages,
        };

        let response = self
            .http_client
            .post(&url, &req)
            .await
            .map_err(|e| format!("Poll request failed: {}", e))?;

        if !response.is_success() {
            return Err(format!("Poll failed: {}", response.status));
        }

        let resp: PollResponse = response
            .json()
            .map_err(|e| format!("Failed to parse poll response: {}", e))?;

        // 发送收到的消息事件
        for msg in &resp.messages {
            let _ = self
                .event_tx
                .send(AdminClientEvent::MessageReceived(msg.clone()));
        }

        Ok(resp.messages)
    }

    /// 上报消息
    pub async fn report_message(
        &self,
        message_type: &str,
        payload: serde_json::Value,
        in_reply_to: Option<String>,
    ) -> Result<String, String> {
        let client_id = self
            .client_id
            .read()
            .await
            .clone()
            .ok_or_else(|| "Client ID not set".to_string())?;

        let url = format!("{}/api/report", self.config.admin_url);

        let req = ReportRequest {
            client_id,
            message_type: message_type.to_string(),
            payload,
            in_reply_to,
        };

        let response = self
            .http_client
            .post(&url, &req)
            .await
            .map_err(|e| format!("Report request failed: {}", e))?;

        if !response.is_success() {
            return Err(format!("Report failed: {}", response.status));
        }

        let resp: ReportResponse = response
            .json()
            .map_err(|e| format!("Failed to parse report response: {}", e))?;

        Ok(resp.message_id)
    }

    /// 停止后台任务
    pub fn stop_background_tasks(&self) {
        self.running.store(false, Ordering::SeqCst);
        info!("Stopped AdminClient background tasks");
    }

    /// 获取配置
    pub fn config(&self) -> &AdminConfig {
        &self.config
    }
}

// 后台任务实现（仅对 ReqwestClient）
impl AdminClient<ReqwestClient> {
    /// 启动后台任务（心跳和轮询）
    pub async fn start_background_tasks(&self) {
        if self.running.load(Ordering::SeqCst) {
            warn!("AdminClient background tasks already running");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("Starting AdminClient background tasks");

        // 启动心跳任务
        let running = self.running.clone();
        let client_id = self.client_id.clone();
        let registered = self.registered.clone();
        let config = self.config.clone();
        let event_tx = self.event_tx.clone();

        // 创建新的 HTTP 客户端用于后台任务
        let http_client = ReqwestClient::new(config.request_timeout_secs);

        tokio::spawn(async move {
            let interval = Duration::from_secs(config.heartbeat_interval_secs);

            loop {
                if !running.load(Ordering::SeqCst) {
                    break;
                }

                tokio::time::sleep(interval).await;

                if !*registered.read().await {
                    continue;
                }

                let cid = client_id.read().await.clone();
                if let Some(id) = cid {
                    let url = format!("{}/api/heartbeat", config.admin_url);
                    let req = HeartbeatRequest {
                        client_id: id,
                        latency_ms: None,
                    };

                    match http_client.post(&url, &req).await {
                        Ok(resp) if resp.is_success() => {
                            debug!("Heartbeat sent successfully");
                        }
                        Ok(resp) if resp.status == 404 => {
                            warn!("Client not registered on server, need to re-register");
                            *registered.write().await = false;
                        }
                        Ok(resp) => {
                            warn!("Heartbeat failed: {}", resp.status);
                        }
                        Err(e) => {
                            warn!("Heartbeat request failed: {}", e);
                            let _ = event_tx.send(AdminClientEvent::Disconnected(e.to_string()));
                        }
                    }
                }
            }

            debug!("Heartbeat task stopped");
        });

        // 启动轮询任务
        let running = self.running.clone();
        let client_id = self.client_id.clone();
        let registered = self.registered.clone();
        let config = self.config.clone();
        let event_tx = self.event_tx.clone();

        let http_client = ReqwestClient::new(config.request_timeout_secs);

        tokio::spawn(async move {
            let interval = Duration::from_secs(config.poll_interval_secs);

            loop {
                if !running.load(Ordering::SeqCst) {
                    break;
                }

                tokio::time::sleep(interval).await;

                if !*registered.read().await {
                    continue;
                }

                let cid = client_id.read().await.clone();
                if let Some(id) = cid {
                    let url = format!("{}/api/poll", config.admin_url);
                    let req = PollRequest {
                        client_id: id,
                        max_messages: Some(10),
                    };

                    match http_client.post(&url, &req).await {
                        Ok(resp) if resp.is_success() => {
                            if let Ok(poll_resp) = resp.json::<PollResponse>() {
                                for msg in poll_resp.messages {
                                    debug!("Received message: type={}", msg.message_type);
                                    let _ = event_tx.send(AdminClientEvent::MessageReceived(msg));
                                }
                            }
                        }
                        Ok(resp) => {
                            debug!("Poll response: {}", resp.status);
                        }
                        Err(e) => {
                            debug!("Poll request failed: {}", e);
                        }
                    }
                }
            }

            debug!("Poll task stopped");
        });
    }
}

impl<H: HttpClient> Drop for AdminClient<H> {
    fn drop(&mut self) {
        self.stop_background_tasks();
    }
}

#[cfg(test)]
mod tests {
    use super::super::http_client::mock::{MockHttpClient, MockResponse};
    use super::*;

    #[test]
    fn test_admin_config_default() {
        let config = AdminConfig::default();
        assert_eq!(config.admin_url, "http://localhost:8080");
        assert_eq!(config.heartbeat_interval_secs, 30);
        assert_eq!(config.poll_interval_secs, 5);
    }

    #[test]
    fn test_admin_client_creation() {
        let config = AdminConfig::default();
        let _client = AdminClient::new(config);
        // Should not panic
    }

    #[tokio::test]
    async fn test_client_id_management() {
        let http_client = MockHttpClient::new();
        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);

        assert!(client.get_client_id().await.is_none());

        client.set_client_id("test-123".to_string()).await;
        assert_eq!(client.get_client_id().await, Some("test-123".to_string()));
    }

    #[tokio::test]
    async fn test_register_success() {
        let response = RegistrationResponse {
            success: true,
            message: "ok".to_string(),
        };

        let http_client = MockHttpClient::new().expect_response(MockResponse::ok(&response));

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);

        let req = RegistrationRequest {
            client_id: "test-001".to_string(),
            name: Some("Test Client".to_string()),
            os: "linux".to_string(),
            os_version: "5.0".to_string(),
            arch: "x86_64".to_string(),
            client_version: "1.0.0".to_string(),
        };

        let result = client.register(req).await;
        assert!(result.is_ok());
        assert!(client.is_registered().await);
        assert_eq!(client.get_client_id().await, Some("test-001".to_string()));
    }

    #[tokio::test]
    async fn test_register_failure() {
        let response = RegistrationResponse {
            success: false,
            message: "Invalid client".to_string(),
        };

        let http_client = MockHttpClient::new().expect_response(MockResponse::ok(&response));

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);

        let req = RegistrationRequest {
            client_id: "test-002".to_string(),
            name: None,
            os: "linux".to_string(),
            os_version: "5.0".to_string(),
            arch: "x86_64".to_string(),
            client_version: "1.0.0".to_string(),
        };

        let result = client.register(req).await;
        assert!(result.is_err());
        assert!(!client.is_registered().await);
    }

    #[tokio::test]
    async fn test_register_http_error() {
        let http_client =
            MockHttpClient::new().expect_response(MockResponse::error(500, "Server Error"));

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);

        let req = RegistrationRequest {
            client_id: "test-003".to_string(),
            name: None,
            os: "linux".to_string(),
            os_version: "5.0".to_string(),
            arch: "x86_64".to_string(),
            client_version: "1.0.0".to_string(),
        };

        let result = client.register(req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("500"));
    }

    #[tokio::test]
    async fn test_send_heartbeat_success() {
        let response = HeartbeatResponse {
            success: true,
            pending_messages: 5,
        };

        let http_client = MockHttpClient::new().expect_response(MockResponse::ok(&response));

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);
        client.set_client_id("test-heartbeat".to_string()).await;

        let result = client.send_heartbeat(Some(50)).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 5);
    }

    #[tokio::test]
    async fn test_send_heartbeat_not_registered() {
        let http_client = MockHttpClient::new().expect_response(MockResponse::not_found());

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);
        client.set_client_id("test-heartbeat-2".to_string()).await;
        *client.registered.write().await = true;

        let result = client.send_heartbeat(None).await;
        assert!(result.is_err());
        assert!(!client.is_registered().await);
    }

    #[tokio::test]
    async fn test_send_heartbeat_no_client_id() {
        let http_client = MockHttpClient::new();

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);

        let result = client.send_heartbeat(None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Client ID not set"));
    }

    #[tokio::test]
    async fn test_poll_messages() {
        let messages = vec![
            PendingMessage {
                message_id: "msg-001".to_string(),
                message_type: "task".to_string(),
                payload: serde_json::json!({"action": "run"}),
                created_at: "2024-01-01T00:00:00Z".to_string(),
            },
            PendingMessage {
                message_id: "msg-002".to_string(),
                message_type: "config".to_string(),
                payload: serde_json::json!({"key": "value"}),
                created_at: "2024-01-01T00:00:01Z".to_string(),
            },
        ];

        let response = PollResponse {
            messages: messages.clone(),
        };

        let http_client = MockHttpClient::new().expect_response(MockResponse::ok(&response));

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);
        client.set_client_id("test-poll".to_string()).await;

        let result = client.poll_messages(Some(10)).await;
        assert!(result.is_ok());

        let msgs = result.unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].message_id, "msg-001");
        assert_eq!(msgs[1].message_type, "config");
    }

    #[tokio::test]
    async fn test_report_message() {
        let response = ReportResponse {
            success: true,
            message_id: "report-001".to_string(),
        };

        let http_client = MockHttpClient::new().expect_response(MockResponse::ok(&response));

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);
        client.set_client_id("test-report".to_string()).await;

        let result = client
            .report_message(
                "status",
                serde_json::json!({"status": "running"}),
                Some("original-msg".to_string()),
            )
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "report-001");
    }

    #[tokio::test]
    async fn test_event_subscription() {
        let response = RegistrationResponse {
            success: true,
            message: "ok".to_string(),
        };

        let http_client = MockHttpClient::new().expect_response(MockResponse::ok(&response));

        let client = AdminClient::with_http_client(AdminConfig::default(), http_client);
        let mut rx = client.subscribe();

        let req = RegistrationRequest {
            client_id: "test-event".to_string(),
            name: None,
            os: "linux".to_string(),
            os_version: "5.0".to_string(),
            arch: "x86_64".to_string(),
            client_version: "1.0.0".to_string(),
        };

        client.register(req).await.unwrap();

        // 验证收到注册事件
        let event = rx.try_recv();
        assert!(matches!(event, Ok(AdminClientEvent::Registered)));
    }

    #[tokio::test]
    async fn test_config_access() {
        let config = AdminConfig {
            admin_url: "http://custom:9090".to_string(),
            heartbeat_interval_secs: 60,
            poll_interval_secs: 10,
            request_timeout_secs: 20,
        };

        let http_client = MockHttpClient::new();
        let client = AdminClient::with_http_client(config.clone(), http_client);

        assert_eq!(client.config().admin_url, "http://custom:9090");
        assert_eq!(client.config().heartbeat_interval_secs, 60);
    }
}

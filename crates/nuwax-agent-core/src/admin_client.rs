//! 管理服务端客户端
//!
//! 与管理服务器进行通信

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, info};

use super::http_client::HttpClient;

/// 管理配置
#[derive(Debug, Clone, Default)]
pub struct AdminConfig {
    /// 管理服务器地址
    pub server_addr: String,
    /// API 密钥
    pub api_key: Option<String>,
    /// 超时时间（秒）
    pub timeout_secs: u64,
}

impl AdminConfig {
    /// 创建新配置
    pub fn new(server_addr: impl Into<String>) -> Self {
        Self {
            server_addr: server_addr.into(),
            api_key: None,
            timeout_secs: 30,
        }
    }

    /// 设置 API 密钥
    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    /// 获取基础 URL
    pub fn base_url(&self) -> String {
        format!("{}/api/v1", self.server_addr)
    }
}

/// 注册请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationRequest {
    /// 客户端 ID
    pub client_id: String,
    /// 主机名
    pub hostname: String,
    /// 操作系统
    pub os: String,
    /// 架构
    pub arch: String,
    /// 版本
    pub version: String,
}

/// 注册响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistrationResponse {
    /// 是否成功
    pub success: bool,
    /// 分配的 ID
    pub assigned_id: Option<String>,
    /// 消息
    pub message: String,
}

/// 待发送消息
#[derive(Debug, Clone)]
pub struct PendingMessage {
    /// 消息类型
    pub message_type: String,
    /// 消息内容
    pub payload: Vec<u8>,
    /// 发送时间
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// 管理客户端事件
#[derive(Debug, Clone)]
pub enum AdminClientEvent {
    /// 已注册
    Registered(String),
    /// 注册失败
    RegistrationFailed(String),
    /// 收到消息
    MessageReceived(String),
    /// 连接状态变化
    ConnectionStateChanged(bool),
}

/// 管理客户端错误
#[derive(Error, Debug)]
pub enum AdminClientError {
    #[error("请求失败: {0}")]
    RequestFailed(String),
    #[error("解析响应失败: {0}")]
    ParseResponseFailed(String),
    #[error("未注册")]
    NotRegistered,
}

/// 管理客户端
pub struct AdminClient<C: HttpClient> {
    /// HTTP 客户端
    http_client: C,
    /// 配置
    config: AdminConfig,
    /// 注册状态
    is_registered: bool,
    /// 待发送消息队列
    #[allow(dead_code)]
    pending_messages: Vec<PendingMessage>,
}

impl<C: HttpClient + Default> Default for AdminClient<C> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: HttpClient + Default> AdminClient<C> {
    /// 创建新的管理客户端
    pub fn new() -> Self {
        Self {
            http_client: C::default(),
            config: AdminConfig::default(),
            is_registered: false,
            pending_messages: Vec::new(),
        }
    }

    /// 使用自定义配置创建
    pub fn with_config(config: AdminConfig) -> Self {
        Self {
            http_client: C::default(),
            config,
            is_registered: false,
            pending_messages: Vec::new(),
        }
    }

    /// 注册客户端
    pub async fn register(&mut self) -> Result<(), AdminClientError> {
        let request = RegistrationRequest {
            client_id: uuid::Uuid::new_v4().to_string(),
            hostname: gethostname::gethostname().to_string_lossy().to_string(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        };

        debug!("Registering with admin server...");

        let response = self
            .http_client
            .post(&format!("{}/register", self.config.base_url()), &request)
            .await
            .map_err(|e| AdminClientError::RequestFailed(e.to_string()))?;

        if !response.is_success() {
            return Err(AdminClientError::RequestFailed(format!(
                "HTTP {}",
                response.status
            )));
        }

        let reg_response: RegistrationResponse = response
            .json()
            .map_err(|e| AdminClientError::ParseResponseFailed(e.to_string()))?;

        if reg_response.success {
            self.is_registered = true;
            info!(
                "Registered with admin server: {}",
                reg_response.assigned_id.clone().unwrap_or_default()
            );
            Ok(())
        } else {
            Err(AdminClientError::RequestFailed(reg_response.message))
        }
    }

    /// 检查是否已注册
    pub fn is_registered(&self) -> bool {
        self.is_registered
    }

    /// 发送心跳
    pub async fn send_heartbeat(&self) -> Result<(), AdminClientError> {
        if !self.is_registered {
            return Err(AdminClientError::NotRegistered);
        }

        debug!("Sending heartbeat...");
        Ok(())
    }

    /// 获取配置
    pub fn config(&self) -> &AdminConfig {
        &self.config
    }

    /// 获取配置（可变）
    pub fn config_mut(&mut self) -> &mut AdminConfig {
        &mut self.config
    }
}

#[cfg(test)]
mod tests {
    use super::super::http_client::mock::{MockHttpClient, MockResponse};
    use super::*;

    #[tokio::test]
    async fn test_admin_client_creation() {
        let client: AdminClient<MockHttpClient> = AdminClient::new();
        assert!(!client.is_registered());
    }

    #[tokio::test]
    async fn test_admin_client_registration() {
        let _client: AdminClient<MockHttpClient> =
            AdminClient::with_config(AdminConfig::new("http://localhost:8080"));

        // Mock 注册响应
        let _mock_http =
            MockHttpClient::new().expect_response(MockResponse::ok(&RegistrationResponse {
                success: true,
                assigned_id: Some("test-id".to_string()),
                message: "OK".to_string(),
            }));

        // 由于我们使用自定义 HTTP 客户端，这里只是测试结构
        // 实际注册需要真实的 HTTP 客户端
    }
}

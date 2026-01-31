//! HTTP 客户端抽象
//!
//! 定义 HTTP 客户端的抽象接口，用于解耦 AdminClient 与具体实现

use async_trait::async_trait;
use serde::Serialize;
use std::time::Duration;
use thiserror::Error;

/// HTTP 错误
#[derive(Error, Debug, Clone)]
pub enum HttpError {
    #[error("请求失败: {0}")]
    RequestFailed(String),
    #[error("响应解析失败: {0}")]
    ParseError(String),
    #[error("超时")]
    Timeout,
    #[error("连接失败: {0}")]
    ConnectionFailed(String),
}

/// HTTP 响应
#[derive(Debug, Clone)]
pub struct HttpResponse {
    /// 状态码
    pub status: u16,
    /// 响应体
    pub body: Vec<u8>,
}

impl HttpResponse {
    /// 创建新的响应
    pub fn new(status: u16, body: Vec<u8>) -> Self {
        Self { status, body }
    }

    /// 检查状态码是否成功
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// 获取响应体文本
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }

    /// 解析 JSON 响应
    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T, HttpError> {
        serde_json::from_slice(&self.body).map_err(|e| HttpError::ParseError(e.to_string()))
    }
}

/// HTTP 客户端 trait
///
/// 定义 HTTP 客户端的抽象接口，用于解耦 AdminClient 与具体实现。
/// 生产环境使用 ReqwestClient，测试使用 MockHttpClient。
#[async_trait]
pub trait HttpClient: Send + Sync {
    /// 发送 POST 请求
    async fn post<T: Serialize + Send + Sync>(
        &self,
        url: &str,
        body: &T,
    ) -> Result<HttpResponse, HttpError>;

    /// 发送 GET 请求
    async fn get(&self, url: &str) -> Result<HttpResponse, HttpError>;
}

/// 基于 reqwest 的 HTTP 客户端实现
pub struct ReqwestClient {
    inner: reqwest::Client,
}

impl ReqwestClient {
    /// 创建新的 reqwest 客户端
    pub fn new(timeout_secs: u64) -> Self {
        let inner = reqwest::Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .expect("Failed to create HTTP client");

        Self { inner }
    }
}

impl Default for ReqwestClient {
    fn default() -> Self {
        Self::new(10)
    }
}

#[async_trait]
impl HttpClient for ReqwestClient {
    async fn post<T: Serialize + Send + Sync>(
        &self,
        url: &str,
        body: &T,
    ) -> Result<HttpResponse, HttpError> {
        let response = self.inner.post(url).json(body).send().await.map_err(|e| {
            if e.is_timeout() {
                HttpError::Timeout
            } else if e.is_connect() {
                HttpError::ConnectionFailed(e.to_string())
            } else {
                HttpError::RequestFailed(e.to_string())
            }
        })?;

        let status = response.status().as_u16();
        let body = response
            .bytes()
            .await
            .map_err(|e| HttpError::ParseError(e.to_string()))?
            .to_vec();

        Ok(HttpResponse::new(status, body))
    }

    async fn get(&self, url: &str) -> Result<HttpResponse, HttpError> {
        let response = self.inner.get(url).send().await.map_err(|e| {
            if e.is_timeout() {
                HttpError::Timeout
            } else if e.is_connect() {
                HttpError::ConnectionFailed(e.to_string())
            } else {
                HttpError::RequestFailed(e.to_string())
            }
        })?;

        let status = response.status().as_u16();
        let body = response
            .bytes()
            .await
            .map_err(|e| HttpError::ParseError(e.to_string()))?
            .to_vec();

        Ok(HttpResponse::new(status, body))
    }
}

// ============================================================================
// Mock HTTP Client for Testing
// ============================================================================

#[cfg(test)]
pub mod mock {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Mock 请求记录
    #[derive(Debug, Clone)]
    pub struct MockRequest {
        pub method: String,
        pub url: String,
        pub body: Option<String>,
    }

    /// Mock 响应配置
    #[derive(Debug, Clone)]
    pub struct MockResponse {
        pub status: u16,
        pub body: Vec<u8>,
    }

    impl MockResponse {
        /// 创建成功响应
        pub fn ok<T: Serialize>(body: &T) -> Self {
            Self {
                status: 200,
                body: serde_json::to_vec(body).unwrap_or_default(),
            }
        }

        /// 创建错误响应
        pub fn error(status: u16, message: &str) -> Self {
            Self {
                status,
                body: message.as_bytes().to_vec(),
            }
        }

        /// 创建 404 响应
        pub fn not_found() -> Self {
            Self::error(404, "Not Found")
        }

        /// 创建 500 响应
        pub fn server_error() -> Self {
            Self::error(500, "Internal Server Error")
        }
    }

    /// Mock HTTP 客户端
    pub struct MockHttpClient {
        /// 预设的响应队列
        responses: Mutex<VecDeque<MockResponse>>,
        /// 请求记录
        requests: Mutex<Vec<MockRequest>>,
        /// 默认响应（当队列为空时使用）
        default_response: MockResponse,
    }

    impl MockHttpClient {
        /// 创建新的 Mock 客户端
        #[must_use]
        pub fn new() -> Self {
            Self {
                responses: Mutex::new(VecDeque::new()),
                requests: Mutex::new(Vec::new()),
                default_response: MockResponse::ok(&serde_json::json!({"success": true})),
            }
        }

        /// 添加预设响应
        #[must_use]
        pub fn expect_response(self, response: MockResponse) -> Self {
            self.responses.lock().unwrap().push_back(response);
            self
        }

        /// 设置默认响应
        #[must_use]
        pub fn with_default_response(mut self, response: MockResponse) -> Self {
            self.default_response = response;
            self
        }

        /// 获取所有请求记录
        pub fn get_requests(&self) -> Vec<MockRequest> {
            self.requests.lock().unwrap().clone()
        }

        /// 获取最后一个请求
        pub fn last_request(&self) -> Option<MockRequest> {
            self.requests.lock().unwrap().last().cloned()
        }

        /// 清除请求记录
        pub fn clear_requests(&self) {
            self.requests.lock().unwrap().clear();
        }

        /// 获取下一个响应
        fn next_response(&self) -> MockResponse {
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| self.default_response.clone())
        }
    }

    impl Default for MockHttpClient {
        fn default() -> Self {
            Self::new()
        }
    }

    #[async_trait]
    impl HttpClient for MockHttpClient {
        async fn post<T: Serialize + Send + Sync>(
            &self,
            url: &str,
            body: &T,
        ) -> Result<HttpResponse, HttpError> {
            let body_str = serde_json::to_string(body).ok();

            self.requests.lock().unwrap().push(MockRequest {
                method: "POST".to_string(),
                url: url.to_string(),
                body: body_str,
            });

            let mock_response = self.next_response();
            Ok(HttpResponse::new(mock_response.status, mock_response.body))
        }

        async fn get(&self, url: &str) -> Result<HttpResponse, HttpError> {
            self.requests.lock().unwrap().push(MockRequest {
                method: "GET".to_string(),
                url: url.to_string(),
                body: None,
            });

            let mock_response = self.next_response();
            Ok(HttpResponse::new(mock_response.status, mock_response.body))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mock::*;
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, Debug, PartialEq)]
    struct TestRequest {
        name: String,
        value: i32,
    }

    #[derive(Serialize, Deserialize, Debug, PartialEq)]
    struct TestResponse {
        success: bool,
        message: String,
    }

    #[tokio::test]
    async fn test_mock_http_client_post() {
        let expected_response = TestResponse {
            success: true,
            message: "ok".to_string(),
        };

        let client = MockHttpClient::new().expect_response(MockResponse::ok(&expected_response));

        let request = TestRequest {
            name: "test".to_string(),
            value: 42,
        };

        let response = client
            .post("http://localhost/api/test", &request)
            .await
            .unwrap();
        assert!(response.is_success());

        let parsed: TestResponse = response.json().unwrap();
        assert_eq!(parsed, expected_response);

        // 验证请求被记录
        let requests = client.get_requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].url, "http://localhost/api/test");
    }

    #[tokio::test]
    async fn test_mock_http_client_get() {
        let client = MockHttpClient::new()
            .expect_response(MockResponse::ok(&serde_json::json!({"data": "test"})));

        let response = client.get("http://localhost/api/data").await.unwrap();
        assert!(response.is_success());

        let requests = client.get_requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "GET");
    }

    #[tokio::test]
    async fn test_mock_http_client_error_response() {
        let client = MockHttpClient::new().expect_response(MockResponse::not_found());

        let response = client.get("http://localhost/api/missing").await.unwrap();
        assert!(!response.is_success());
        assert_eq!(response.status, 404);
    }

    #[tokio::test]
    async fn test_mock_http_client_multiple_responses() {
        let client = MockHttpClient::new()
            .expect_response(MockResponse::ok(&serde_json::json!({"id": 1})))
            .expect_response(MockResponse::ok(&serde_json::json!({"id": 2})))
            .expect_response(MockResponse::error(500, "Error"));

        // 第一个请求
        let r1 = client.get("http://localhost/api/1").await.unwrap();
        assert!(r1.is_success());

        // 第二个请求
        let r2 = client.get("http://localhost/api/2").await.unwrap();
        assert!(r2.is_success());

        // 第三个请求
        let r3 = client.get("http://localhost/api/3").await.unwrap();
        assert!(!r3.is_success());
        assert_eq!(r3.status, 500);
    }

    #[tokio::test]
    async fn test_mock_http_client_default_response() {
        let client = MockHttpClient::new()
            .with_default_response(MockResponse::ok(&serde_json::json!({"default": true})));

        // 没有预设响应时使用默认响应
        let response = client.get("http://localhost/api/any").await.unwrap();
        assert!(response.is_success());
        assert!(response.text().contains("default"));
    }

    #[test]
    fn test_http_response_helpers() {
        let response = HttpResponse::new(200, b"test body".to_vec());
        assert!(response.is_success());
        assert_eq!(response.text(), "test body");

        let error_response = HttpResponse::new(404, b"not found".to_vec());
        assert!(!error_response.is_success());
    }
}

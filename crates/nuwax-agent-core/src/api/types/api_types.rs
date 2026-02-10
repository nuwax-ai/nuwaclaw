//! API 响应类型
//!
//! 统一的 API 响应格式，用于 Tauri 命令返回 JSON 序列化数据

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// API 响应结构
///
/// 统一的 API 响应格式，包含成功/失败状态、数据和错误信息。
///
/// ## 示例
///
/// ```rust
/// use crate::api::types::api_types::ApiResponse;
///
/// // 成功响应
/// let response = ApiResponse::success(data);
///
/// // 错误响应
/// let response = ApiResponse::error("Something went wrong".to_string());
/// ```
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T: Serialize> {
    /// 是否成功
    pub success: bool,
    /// 响应数据（成功时使用）
    pub data: Option<T>,
    /// 错误信息（失败时使用）
    pub error: Option<String>,
    /// 响应时间戳
    pub timestamp: DateTime<Utc>,
}

impl<T: Serialize> ApiResponse<T> {
    /// 创建成功响应
    ///
    /// # Arguments
    ///
    /// * `data` - 响应数据
    ///
    /// # Returns
    ///
    /// 包含数据和成功状态的 ApiResponse
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            timestamp: Utc::now(),
        }
    }

    /// 创建错误响应
    ///
    /// # Arguments
    ///
    /// * `message` - 错误信息
    ///
    /// # Returns
    ///
    /// 包含错误信息的 ApiResponse
    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
            timestamp: Utc::now(),
        }
    }

    /// 创建空成功响应（无数据）
    ///
    /// # Returns
    ///
    /// 空的成功响应
    pub fn empty_success() -> Self {
        Self {
            success: true,
            data: None,
            error: None,
            timestamp: Utc::now(),
        }
    }

    /// 检查响应是否成功
    pub fn is_success(&self) -> bool {
        self.success
    }

    /// 获取数据引用（如果成功）
    pub fn data(&self) -> Option<&T> {
        self.data.as_ref()
    }

    /// 获取错误信息（如果失败）
    pub fn error_message(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// 从 Result 转换
    ///
    /// # Arguments
    ///
    /// * `result` - Result 类型
    ///
    /// # Returns
    ///
    /// 成功时返回包含数据的 ApiResponse，失败时返回错误响应
    pub fn from_result(result: Result<T, String>) -> Self {
        match result {
            Ok(data) => Self::success(data),
            Err(msg) => Self::error(msg),
        }
    }

    /// 转换为 JSON 字符串
    ///
    /// # Returns
    ///
    /// JSON 序列化结果
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// 转换为 JSON 字符串（美化格式）
    ///
    /// # Returns
    ///
    /// 美化后的 JSON 序列化结果
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// 获取数据并消费（如果成功）
    ///
    /// # Returns
    ///
    /// Some(data) 如果成功，None 如果失败
    pub fn into_data(self) -> Option<T> {
        self.data
    }

    /// 获取错误信息并消费（如果失败）
    ///
    /// # Returns
    ///
    /// Some(message) 如果失败，None 如果成功
    pub fn into_error(self) -> Option<String> {
        self.error
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_response_success() {
        let response = ApiResponse::success("test data".to_string());

        assert!(response.is_success());
        assert_eq!(response.data(), Some(&"test data".to_string()));
        assert!(response.error_message().is_none());
    }

    #[test]
    fn test_api_response_error() {
        let response: ApiResponse<String> = ApiResponse::error("error message".to_string());

        assert!(!response.is_success());
        assert!(response.data().is_none());
        assert_eq!(response.error_message(), Some("error message"));
    }

    #[test]
    fn test_api_response_empty_success() {
        let response: ApiResponse<()> = ApiResponse::empty_success();

        assert!(response.is_success());
        assert!(response.data().is_none());
        assert!(response.error_message().is_none());
    }

    #[test]
    fn test_api_response_from_result_success() {
        let response = ApiResponse::from_result(Ok("success data".to_string()));

        assert!(response.is_success());
        assert_eq!(response.data(), Some(&"success data".to_string()));
    }

    #[test]
    fn test_api_response_from_result_error() {
        let response: ApiResponse<String> =
            ApiResponse::from_result(Err("error from result".to_string()));

        assert!(!response.is_success());
        assert_eq!(response.error_message(), Some("error from result"));
    }

    #[test]
    fn test_api_response_to_json() {
        let response = ApiResponse::success("test".to_string());
        let json = response.to_json().unwrap();

        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"data\":\"test\""));
    }

    #[test]
    fn test_api_response_into_data() {
        let response = ApiResponse::success("data".to_string());
        let data = response.into_data();

        assert_eq!(data, Some("data".to_string()));
    }

    #[test]
    fn test_api_response_into_error() {
        let response: ApiResponse<()> = ApiResponse::error("error msg".to_string());
        let error = response.into_error();

        assert_eq!(error, Some("error msg".to_string()));
    }
}

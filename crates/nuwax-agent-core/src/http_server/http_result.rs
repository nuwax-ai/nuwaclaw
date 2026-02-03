//! HTTP 响应包装类型
//!
//! 提供统一的 HTTP 响应包装器，支持成功/失败状态码

use axum::response::IntoResponse;
use axum::http::StatusCode;
use serde::Serialize;

/// HTTP 响应包装器
///
/// 用于统一 HTTP API 的响应格式
#[derive(Debug, Serialize)]
pub struct HttpResult<T> {
    /// 业务数据
    pub data: T,

    /// 状态码 (0 表示成功，非 0 表示错误)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,

    /// 状态消息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl<T> HttpResult<T> {
    /// 创建成功响应
    pub fn success(data: T) -> Self {
        Self {
            data,
            code: Some(0),
            message: None,
        }
    }

    /// 创建带消息的成功响应
    pub fn success_with_message(data: T, message: impl Into<String>) -> Self {
        Self {
            data,
            code: Some(0),
            message: Some(message.into()),
        }
    }
}

impl<T: Serialize> IntoResponse for HttpResult<T> {
    fn into_response(self) -> axum::response::Response {
        (StatusCode::OK, axum::Json(self)).into_response()
    }
}

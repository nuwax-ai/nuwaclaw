//! 统一错误类型定义
//!
//! 参照 rcoder 项目的错误处理模式，提供结构化的错误类型

use axum::response::IntoResponse;
use axum::http::StatusCode;
use serde::Serialize;
use thiserror::Error;

/// 应用错误类型
#[derive(Debug, Error, Serialize)]
pub enum AppError {
    /// 业务验证错误 (400)
    #[error("Validation error: {message}")]
    Validation { message: String },

    /// 资源未找到 (404)
    #[error("Not found: {resource}")]
    NotFound { resource: String },

    /// 内部服务器错误 (500)
    #[error("Internal error: {message}")]
    Internal { message: String },

    /// 业务操作失败 (422)
    #[error("Business error: {message}")]
    Business { message: String },

    /// 状态冲突错误 (409)
    #[error("Conflict: {message}")]
    Conflict { message: String },
}

impl AppError {
    /// 创建验证错误
    pub fn validation_error(message: impl Into<String>) -> Self {
        Self::Validation {
            message: message.into(),
        }
    }

    /// 创建未找到错误
    pub fn not_found(resource: impl Into<String>) -> Self {
        Self::NotFound {
            resource: resource.into(),
        }
    }

    /// 创建内部错误
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    /// 创建业务错误
    pub fn business(message: impl Into<String>) -> Self {
        Self::Business {
            message: message.into(),
        }
    }

    /// 创建冲突错误
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict {
            message: message.into(),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        Self::internal(e.to_string())
    }
}

impl From<String> for AppError {
    fn from(e: String) -> Self {
        Self::Business { message: e }
    }
}

impl From<&str> for AppError {
    fn from(e: &str) -> Self {
        Self::Business {
            message: e.to_string(),
        }
    }
}

impl From<axum::http::Error> for AppError {
    fn from(e: axum::http::Error) -> Self {
        Self::internal(e.to_string())
    }
}

/// 错误响应结构
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub code: u16,
    pub message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status_code, error_message) = match self {
            AppError::Validation { message } => (StatusCode::BAD_REQUEST, message),
            AppError::NotFound { resource } => (StatusCode::NOT_FOUND, resource),
            AppError::Internal { message } => (StatusCode::INTERNAL_SERVER_ERROR, message),
            AppError::Business { message } => (StatusCode::UNPROCESSABLE_ENTITY, message),
            AppError::Conflict { message } => (StatusCode::CONFLICT, message),
        };

        tracing::error!(status = %status_code, error = %error_message, "HTTP request failed");

        let response = ErrorResponse {
            code: status_code.as_u16(),
            message: error_message,
        };

        (status_code, axum::Json(response)).into_response()
    }
}

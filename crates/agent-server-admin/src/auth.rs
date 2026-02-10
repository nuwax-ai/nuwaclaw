//! API 认证中间件模块
//!
//! 提供基于 API Key 的认证机制：
//! - 管理端 API：使用 `X-API-Key` Header
//! - 客户端 API：使用 `X-Client-Token` Header
//! - SSE 端点：使用 `?token=xxx` Query 参数

use std::sync::Arc;

use axum::{
    extract::{Query, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use serde::Deserialize;

/// 认证配置
#[derive(Debug, Clone, Default)]
pub struct AuthConfig {
    /// 管理端 API Key（用于 /api/clients, /api/status, /api/tasks 等）
    pub admin_api_key: Option<String>,
    /// 客户端 Token（用于 /api/register, /api/heartbeat, /api/poll, /api/report）
    pub client_token: Option<String>,
    /// 是否启用认证（开发环境可关闭）
    pub enabled: bool,
}

impl AuthConfig {
    /// 从环境变量加载配置
    pub fn from_env() -> Self {
        let admin_api_key = std::env::var("ADMIN_API_KEY").ok();
        let client_token = std::env::var("CLIENT_API_TOKEN").ok();

        // 如果设置了任一 key，则启用认证
        let enabled = admin_api_key.is_some() || client_token.is_some();

        Self {
            admin_api_key,
            client_token,
            enabled,
        }
    }

    /// 验证管理端 API Key
    pub fn validate_admin_key(&self, key: &str) -> bool {
        match &self.admin_api_key {
            Some(expected) => key == expected,
            None => true, // 未配置则允许所有请求
        }
    }

    /// 验证客户端 Token
    pub fn validate_client_token(&self, token: &str) -> bool {
        match &self.client_token {
            Some(expected) => token == expected,
            None => true, // 未配置则允许所有请求
        }
    }
}

/// 共享的认证配置状态
pub type SharedAuthConfig = Arc<AuthConfig>;

/// SSE Token 查询参数
#[derive(Debug, Deserialize)]
pub struct SseTokenQuery {
    pub token: Option<String>,
}

/// 管理端 API 认证中间件
///
/// 检查 `X-API-Key` Header
pub async fn admin_auth_middleware(
    State(auth_config): State<SharedAuthConfig>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 如果认证未启用，直接放行
    if !auth_config.enabled {
        return Ok(next.run(request).await);
    }

    // 如果未配置 admin_api_key，则放行
    if auth_config.admin_api_key.is_none() {
        return Ok(next.run(request).await);
    }

    // 提取 X-API-Key header
    let api_key = request
        .headers()
        .get("X-API-Key")
        .and_then(|v| v.to_str().ok());

    match api_key {
        Some(key) if auth_config.validate_admin_key(key) => Ok(next.run(request).await),
        Some(_) => {
            tracing::warn!("Invalid admin API key");
            Err(StatusCode::UNAUTHORIZED)
        }
        None => {
            tracing::warn!("Missing X-API-Key header");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

/// 客户端 API 认证中间件
///
/// 检查 `X-Client-Token` Header
pub async fn client_auth_middleware(
    State(auth_config): State<SharedAuthConfig>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 如果认证未启用，直接放行
    if !auth_config.enabled {
        return Ok(next.run(request).await);
    }

    // 如果未配置 client_token，则放行
    if auth_config.client_token.is_none() {
        return Ok(next.run(request).await);
    }

    // 提取 X-Client-Token header
    let token = request
        .headers()
        .get("X-Client-Token")
        .and_then(|v| v.to_str().ok());

    match token {
        Some(t) if auth_config.validate_client_token(t) => Ok(next.run(request).await),
        Some(_) => {
            tracing::warn!("Invalid client token");
            Err(StatusCode::UNAUTHORIZED)
        }
        None => {
            tracing::warn!("Missing X-Client-Token header");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

/// SSE 认证中间件
///
/// 检查 `?token=xxx` Query 参数或 `X-API-Key` Header
pub async fn sse_auth_middleware(
    State(auth_config): State<SharedAuthConfig>,
    Query(query): Query<SseTokenQuery>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 如果认证未启用，直接放行
    if !auth_config.enabled {
        return Ok(next.run(request).await);
    }

    // 如果未配置 admin_api_key，则放行
    if auth_config.admin_api_key.is_none() {
        return Ok(next.run(request).await);
    }

    // 首先检查 query 参数
    if let Some(token) = &query.token {
        if auth_config.validate_admin_key(token) {
            return Ok(next.run(request).await);
        }
    }

    // 然后检查 X-API-Key header
    let api_key = request
        .headers()
        .get("X-API-Key")
        .and_then(|v| v.to_str().ok());

    match api_key {
        Some(key) if auth_config.validate_admin_key(key) => Ok(next.run(request).await),
        _ => {
            tracing::warn!("SSE authentication failed");
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_config_default_disabled() {
        let config = AuthConfig::default();
        assert!(!config.enabled);
        assert!(config.admin_api_key.is_none());
        assert!(config.client_token.is_none());
    }

    #[test]
    fn test_validate_admin_key_when_not_configured() {
        let config = AuthConfig::default();
        // 未配置时，任何 key 都有效
        assert!(config.validate_admin_key("any_key"));
    }

    #[test]
    fn test_validate_admin_key_when_configured() {
        let config = AuthConfig {
            admin_api_key: Some("secret_key".to_string()),
            client_token: None,
            enabled: true,
        };
        assert!(config.validate_admin_key("secret_key"));
        assert!(!config.validate_admin_key("wrong_key"));
    }

    #[test]
    fn test_validate_client_token() {
        let config = AuthConfig {
            admin_api_key: None,
            client_token: Some("client_secret".to_string()),
            enabled: true,
        };
        assert!(config.validate_client_token("client_secret"));
        assert!(!config.validate_client_token("wrong_token"));
    }
}

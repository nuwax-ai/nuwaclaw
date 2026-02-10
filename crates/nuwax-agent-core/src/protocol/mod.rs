//! 协议版本管理模块
//!
//! 处理客户端与服务器之间的协议版本协商

use semver::Version;
use thiserror::Error;
use tracing::{info, warn};

/// 当前协议版本
pub const PROTOCOL_VERSION: &str = "1.0.0";

/// 最低兼容版本
pub const MIN_COMPATIBLE_VERSION: &str = "1.0.0";

/// 协议错误
#[derive(Error, Debug)]
pub enum ProtocolError {
    #[error("协议版本不兼容: 服务器版本 {server}, 客户端版本 {client}")]
    VersionIncompatible { server: String, client: String },
    #[error("版本解析失败: {0}")]
    ParseError(String),
    #[error("握手失败: {0}")]
    HandshakeFailed(String),
}

/// 版本协商结果
#[derive(Debug, Clone)]
pub struct NegotiationResult {
    /// 协商后使用的版本
    pub negotiated_version: Version,
    /// 服务器版本
    pub server_version: Version,
    /// 客户端版本
    pub client_version: Version,
    /// 是否需要升级
    pub upgrade_recommended: bool,
}

/// 协议版本管理器
pub struct ProtocolManager {
    /// 当前版本
    current_version: Version,
    /// 最低兼容版本
    min_compatible: Version,
}

impl Default for ProtocolManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ProtocolManager {
    /// 创建新的协议管理器
    pub fn new() -> Self {
        Self {
            current_version: Version::parse(PROTOCOL_VERSION).unwrap(),
            min_compatible: Version::parse(MIN_COMPATIBLE_VERSION).unwrap(),
        }
    }

    /// 获取当前协议版本
    pub fn version(&self) -> &Version {
        &self.current_version
    }

    /// 获取版本字符串
    pub fn version_string(&self) -> String {
        self.current_version.to_string()
    }

    /// 检查服务器版本是否兼容
    pub fn check_compatibility(
        &self,
        server_version: &str,
    ) -> Result<NegotiationResult, ProtocolError> {
        let server_ver = Version::parse(server_version)
            .map_err(|_| ProtocolError::ParseError(server_version.to_string()))?;

        // 检查服务器版本是否满足最低要求
        if server_ver < self.min_compatible {
            return Err(ProtocolError::VersionIncompatible {
                server: server_version.to_string(),
                client: self.current_version.to_string(),
            });
        }

        // 选择较低的版本作为协商版本
        let negotiated = if server_ver < self.current_version {
            server_ver.clone()
        } else {
            self.current_version.clone()
        };

        // 检查是否建议升级
        let upgrade_recommended = server_ver > self.current_version;

        if upgrade_recommended {
            info!(
                "Server version {} is newer than client version {}",
                server_ver, self.current_version
            );
        }

        Ok(NegotiationResult {
            negotiated_version: negotiated,
            server_version: server_ver,
            client_version: self.current_version.clone(),
            upgrade_recommended,
        })
    }

    /// 协商协议版本
    pub fn negotiate(&self, server_version: &str) -> Result<NegotiationResult, ProtocolError> {
        info!(
            "Negotiating protocol version with server v{}",
            server_version
        );

        let result = self.check_compatibility(server_version)?;

        info!(
            "Protocol negotiation successful: using v{}",
            result.negotiated_version
        );

        if result.upgrade_recommended {
            warn!("Client upgrade recommended to match server version");
        }

        Ok(result)
    }

    /// 生成握手请求数据
    pub fn create_handshake_request(&self) -> HandshakeRequest {
        HandshakeRequest {
            protocol_version: self.version_string(),
            min_compatible_version: self.min_compatible.to_string(),
            client_info: ClientInfo::new(),
        }
    }

    /// 处理握手响应
    pub fn process_handshake_response(
        &self,
        response: &HandshakeResponse,
    ) -> Result<NegotiationResult, ProtocolError> {
        if !response.accepted {
            return Err(ProtocolError::HandshakeFailed(
                response
                    .reason
                    .clone()
                    .unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        self.negotiate(&response.server_version)
    }
}

/// 握手请求
#[derive(Debug, Clone)]
pub struct HandshakeRequest {
    /// 协议版本
    pub protocol_version: String,
    /// 最低兼容版本
    pub min_compatible_version: String,
    /// 客户端信息
    pub client_info: ClientInfo,
}

/// 握手响应
#[derive(Debug, Clone)]
pub struct HandshakeResponse {
    /// 是否接受
    pub accepted: bool,
    /// 服务器版本
    pub server_version: String,
    /// 拒绝原因
    pub reason: Option<String>,
    /// 分配的客户端 ID
    pub client_id: Option<String>,
}

/// 客户端信息
#[derive(Debug, Clone)]
pub struct ClientInfo {
    /// 操作系统
    pub os: String,
    /// 操作系统版本
    pub os_version: String,
    /// 架构
    pub arch: String,
    /// 客户端版本
    pub client_version: String,
}

impl ClientInfo {
    /// 创建客户端信息
    pub fn new() -> Self {
        Self {
            os: std::env::consts::OS.to_string(),
            os_version: os_info::get().version().to_string(),
            arch: std::env::consts::ARCH.to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

impl Default for ClientInfo {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protocol_version() {
        let manager = ProtocolManager::new();
        assert_eq!(manager.version_string(), PROTOCOL_VERSION);
    }

    #[test]
    fn test_compatibility_check() {
        let manager = ProtocolManager::new();

        // Same version should be compatible
        let result = manager.check_compatibility("1.0.0").unwrap();
        assert!(!result.upgrade_recommended);

        // Newer server version should suggest upgrade
        let result = manager.check_compatibility("1.1.0").unwrap();
        assert!(result.upgrade_recommended);
    }

    #[test]
    fn test_incompatible_version() {
        let manager = ProtocolManager::new();

        // Very old version should be incompatible
        let result = manager.check_compatibility("0.1.0");
        assert!(result.is_err());
    }
}

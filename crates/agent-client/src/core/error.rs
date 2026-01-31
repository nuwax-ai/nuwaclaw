//! 核心模块统一错误类型
//!
//! 聚合各子模块的错误类型，提供统一的错误处理接口。

use thiserror::Error;

pub use super::agent::error::AgentError;
pub use super::permissions::PermissionError;
pub use super::http_client::HttpError;

/// 核心错误枚举
///
/// 聚合 agent-client 核心模块的所有错误类型。
#[derive(Debug, Error)]
#[allow(clippy::enum_variant_names)]
pub enum CoreError {
    /// Agent 相关错误
    #[error(transparent)]
    AgentError(#[from] AgentError),

    /// 权限相关错误
    #[error(transparent)]
    PermissionError(#[from] PermissionError),

    /// HTTP 客户端错误
    #[error(transparent)]
    HttpError(#[from] HttpError),

    /// IO 错误
    #[error(transparent)]
    IoError(#[from] std::io::Error),

    /// 配置文件错误
    #[cfg(feature = "config")]
    #[error(transparent)]
    ConfigError(#[from] super::config::ConfigError),

    /// 加密相关错误
    #[cfg(feature = "crypto")]
    #[error(transparent)]
    CryptoError(#[from] super::crypto::CryptoError),

    /// 协议相关错误
    #[cfg(feature = "protocol")]
    #[error(transparent)]
    ProtocolError(#[from] super::protocol::ProtocolError),

    /// 文件传输错误
    #[cfg(feature = "file-transfer")]
    #[error(transparent)]
    FileTransferError(#[from] super::file_transfer::FileTransferError),

    /// 自动启动错误
    #[cfg(feature = "auto-launch")]
    #[error(transparent)]
    AutoLaunchError(#[from] super::auto_launch::AutoLaunchError),

    /// 业务通道错误
    #[cfg(feature = "business-channel")]
    #[error(transparent)]
    BusinessChannelError(#[from] super::business_channel::BusinessChannelError),

    /// 升级相关错误
    #[cfg(feature = "upgrade")]
    #[error(transparent)]
    UpgradeError(#[from] super::upgrade::UpgradeError),

    /// 密码管理错误
    #[cfg(feature = "password")]
    #[error(transparent)]
    PasswordError(#[from] super::password::PasswordError),

    /// 日志相关错误
    #[cfg(feature = "logger")]
    #[error(transparent)]
    LoggerError(#[from] super::logger::LoggerError),
}

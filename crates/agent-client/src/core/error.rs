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

    /// 文件传输错误
    #[cfg(feature = "file-transfer")]
    #[error(transparent)]
    FileTransferError(#[from] super::file_transfer::FileTransferError),

    /// 自动启动错误
    #[cfg(feature = "auto-launch")]
    #[error(transparent)]
    AutoLaunchError(#[from] super::auto_launch::AutoLaunchError),

    /// 升级相关错误
    #[cfg(feature = "remote-desktop")]
    #[error(transparent)]
    UpgradeError(#[from] super::upgrade::UpgradeError),
}

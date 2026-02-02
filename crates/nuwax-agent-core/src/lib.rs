//! nuwax-agent-core - 跨平台 Agent 核心库
//!
//! 无 UI 依赖的纯业务逻辑库，可被不同 UI 框架复用
//!
//! ## 模块结构
//!
//! - `config` - 配置管理
//! - `crypto` - 加密工具
//! - `password` - 密码管理
//! - `agent` - Agent 任务管理
//! - `connection` - 连接管理
//! - `business_channel` - 业务通道通信
//! - `protocol` - 协议版本管理
//! - `http_client` - HTTP 客户端抽象
//! - `logger` - 日志系统
//! - `upgrade` - 版本升级
//! - `platform` - 平台适配
//! - `dependency` - 依赖管理
//! - `message` - 消息协议
//! - `utils` - 工具函数
//! - `i18n` - 国际化
//! - `viewmodels` - ViewModel 层

// ============================================================================
// 核心模块
// ============================================================================

pub mod config;
pub mod crypto;
pub mod password;
pub mod agent;
pub mod connection;
pub mod business_channel;
pub mod protocol;
pub mod http_client;
pub mod logger;
pub mod upgrade;
pub mod platform;
pub mod dependency;

// 重导出类型
pub use config::{AppConfig, ConfigManager, ConfigError};
pub use crypto::{CryptoManager, CryptoError};
pub use password::{PasswordManager, PasswordError, PasswordStrength};
pub use agent::{AgentManager, AgentTask, TaskStatus, TaskProgress, TaskResult, AgentEvent, AgentError};
pub use connection::{ConnectionManager, ConnectionState, ConnectionMode};
pub use business_channel::{BusinessChannel, BusinessMessage, BusinessEnvelope, BusinessMessageType};
pub use protocol::{ProtocolManager, ClientInfo, HandshakeRequest, HandshakeResponse};
pub use http_client::{HttpClient, HttpError, HttpResponse, ReqwestClient};
pub use logger::{Logger, LogLevel, LogConfig, LogError};
pub use upgrade::{UpgradeManager, UpdateStatus, VersionInfo};
pub use dependency::{DependencyManager, DependencyStatus, ToolInfo};

// ============================================================================
// 可选模块（根据 feature 条件导出）
// ============================================================================

#[cfg(feature = "auto-launch")]
pub mod auto_launch;
#[cfg(feature = "auto-launch")]
pub use auto_launch::AutoLaunchManager;

#[cfg(feature = "file-transfer")]
pub mod file_transfer;
#[cfg(feature = "file-transfer")]
pub use file_transfer::FileTransferManager;

// ============================================================================
// 通用模块
// ============================================================================

pub mod message;
pub mod utils;
pub mod i18n;
pub mod api;
pub mod viewmodels;

pub use message::*;
pub use utils::*;
pub use i18n::{I18nManager, Language, I18nError};
pub use api::*;
pub use viewmodels::*;

// ============================================================================
// 管理客户端模块
// ============================================================================

pub mod admin_client;
pub use admin_client::{AdminClient, AdminConfig, AdminClientEvent};

// ============================================================================
// 权限管理模块
// ============================================================================

pub mod permissions;
pub use permissions::PermissionManager;

// ============================================================================
// JSON 配置模块
// ============================================================================

pub mod json_config;
pub use json_config::{JsonConfigManager, JsonConfigError, EditableConfig};

// ============================================================================
// 统一错误类型
// ============================================================================

/// 核心错误枚举
#[derive(thiserror::Error, Debug)]
#[allow(clippy::enum_variant_names)]
pub enum CoreError {
    #[error(transparent)]
    ConfigError(#[from] ConfigError),

    #[error(transparent)]
    CryptoError(#[from] CryptoError),

    #[error(transparent)]
    PasswordError(#[from] PasswordError),

    #[error(transparent)]
    AgentError(#[from] AgentError),

    #[error(transparent)]
    PermissionError(#[from] permissions::PermissionError),

    #[error(transparent)]
    HttpError(#[from] HttpError),

    #[error(transparent)]
    IoError(#[from] std::io::Error),

    #[cfg(feature = "file-transfer")]
    #[error(transparent)]
    FileTransferError(#[from] file_transfer::FileTransferError),

    #[cfg(feature = "auto-launch")]
    #[error(transparent)]
    AutoLaunchError(#[from] auto_launch::AutoLaunchError),
}

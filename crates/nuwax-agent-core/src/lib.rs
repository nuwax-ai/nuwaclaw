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

pub mod agent;
pub mod business_channel;
pub mod config;
#[cfg(feature = "p2p-connection")]
pub mod connection;
pub mod crypto;
pub mod dependency;
pub mod http_client;
pub mod logger;
pub mod password;
pub mod platform;
pub mod preflight;
pub mod protocol;
pub mod upgrade;

// 重导出类型
pub use agent::{
    AgentError, AgentEvent, AgentManager, AgentTask, TaskProgress, TaskResult, TaskStatus,
};
pub use business_channel::{
    BusinessChannel, BusinessEnvelope, BusinessMessage, BusinessMessageType,
};
pub use config::{AppConfig, ConfigError, ConfigManager};
#[cfg(feature = "p2p-connection")]
pub use connection::{ConnectionManager, ConnectionMode, ConnectionState};
pub use crypto::{CryptoError, CryptoManager};
pub use dependency::{DependencyManager, DependencyStatus, ToolInfo};
pub use http_client::{HttpClient, HttpError, HttpResponse, ReqwestClient};
pub use logger::{LogConfig, LogError, LogLevel, Logger};
pub use password::{PasswordError, PasswordManager, PasswordStrength};
pub use protocol::{ClientInfo, HandshakeRequest, HandshakeResponse, ProtocolManager};
pub use upgrade::{UpdateStatus, UpgradeManager, VersionInfo};

// ============================================================================
// 可选模块（根据 feature 条件导出）
// ============================================================================

#[cfg(feature = "auto-launch")]
pub mod auto_launch;
#[cfg(feature = "auto-launch")]
pub use auto_launch::AutoLaunchManager;

#[cfg(any(feature = "file-transfer", feature = "remote-desktop"))]
pub mod file_transfer;
#[cfg(any(feature = "file-transfer", feature = "remote-desktop"))]
pub use file_transfer::FileTransferManager;

/// Agent Runner 模块（可选，用于 rcoder 集成）
#[cfg(feature = "rcoder")]
pub mod agent_runner;

// ============================================================================
// 测试模块（仅在测试模式下编译）
// ============================================================================

// 独立测试 - 不依赖任何特性
#[cfg(test)]
mod standalone_tests;

// 文件传输测试 - 需要 file-transfer 或 remote-desktop 特性
#[cfg(all(test, any(feature = "file-transfer", feature = "remote-desktop")))]
mod file_transfer_tests;

// 业务通道测试 - 需要 async-trait 特性
#[cfg(all(test, feature = "async-trait"))]
mod business_channel_tests;

// ============================================================================
// 通用模块
// ============================================================================

pub mod api;
pub mod i18n;
pub mod message;
pub mod utils;
pub mod viewmodels;

pub use api::*;
pub use i18n::{I18nError, I18nManager, Language};
pub use message::*;
pub use utils::*;
pub use viewmodels::*;

// ============================================================================
// 管理客户端模块
// ============================================================================

pub mod admin_client;
pub use admin_client::{AdminClient, AdminClientEvent, AdminConfig};

// ============================================================================
// 权限管理模块
// ============================================================================

pub mod permissions;
pub use permissions::PermissionManager;

// ============================================================================
// JSON 配置模块
// ============================================================================

pub mod json_config;
pub use json_config::{EditableConfig, JsonConfigError, JsonConfigManager};

// ============================================================================
// 服务管理模块
// ============================================================================

pub mod service;
pub use service::{
    McpProxyConfig, NuwaxFileServerConfig, NuwaxLanproxyConfig, ServiceInfo, ServiceManager,
    ServiceState, ServiceType, DEFAULT_MCP_PROXY_BIN, DEFAULT_MCP_PROXY_HOST,
    DEFAULT_MCP_PROXY_PORT,
};

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

    #[cfg(any(feature = "file-transfer", feature = "remote-desktop"))]
    #[error(transparent)]
    FileTransferError(#[from] file_transfer::FileTransferManagerError),

    #[cfg(feature = "auto-launch")]
    #[error(transparent)]
    AutoLaunchError(#[from] auto_launch::AutoLaunchError),
}

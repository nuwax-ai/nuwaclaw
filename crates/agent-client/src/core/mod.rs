//! 核心逻辑模块

pub mod admin_client;
pub mod agent;
#[cfg(feature = "auto-launch")]
pub mod auto_launch;
pub mod business_channel;
pub mod config;
pub mod connection;
pub mod crypto;
#[cfg(feature = "dependency-management")]
pub mod dependency;
#[cfg(feature = "file-transfer")]
pub mod file_transfer;
pub mod logger;
pub mod password;
pub mod permissions;
pub mod platform;
pub mod protocol;
pub mod remote_input;
pub mod theme;
pub mod upgrade;

pub use admin_client::{AdminClient, AdminConfig, AdminClientEvent, PendingMessage, RegistrationRequest};
pub use agent::{AgentManager, AgentTask, TaskStatus, TaskProgress, TaskResult, AgentEvent};
#[cfg(feature = "auto-launch")]
pub use auto_launch::AutoLaunchManager;

pub use business_channel::BusinessChannel;
pub use connection::{ConnectionManager, ConnectionState, ConnectionMode};
pub use config::{ConfigManager, AppConfig};
#[cfg(feature = "file-transfer")]
pub use file_transfer::FileTransferManager;
pub use logger::Logger;
pub use password::PasswordManager;
pub use permissions::PermissionManager;
pub use protocol::ProtocolManager;
pub use theme::ThemeManager;
pub use upgrade::UpgradeManager;

#[cfg(feature = "dependency-management")]
pub use dependency::DependencyManager;

//! API Trait 模块
//!
//! 定义每个 ViewModel 的 Trait 接口，UI 层可清晰看到每个 ViewModel 的所有可用操作。

pub mod agent_runner;
pub mod agent_status;
pub mod client_info;
pub mod connection_status;
pub mod dependency;
pub mod permissions;
#[cfg(feature = "remote-desktop")]
pub mod remote_desktop;
pub mod settings;
pub mod status_bar;

// 导出类型别名，方便使用
pub use agent_runner::{
    AgentRunnerApi, AgentStatus, AgentStatusResult, Attachment, ChatAgentConfig, ChatRequest,
    ChatResponse, ModelProviderConfig, ProgressMessage, ServiceType,
};
pub use agent_status::AgentStatusApi;
pub use client_info::ClientInfoApi;
pub use connection_status::ConnectionStatusApi;
pub use dependency::DependencyApi;
pub use permissions::PermissionsApi;
#[cfg(feature = "remote-desktop")]
pub use remote_desktop::RemoteDesktopApi;
pub use settings::{
    AppearanceSettingsApi, GeneralSettingsApi, JsonConfigApi, ServerConfigApi, SettingsApi,
};
pub use status_bar::StatusBarApi;

//! ViewModel 层
//!
//! 从 nuwax-agent-core 重新导出所有 ViewModel

// 从 nuwax-agent-core 重新导出所有 ViewModel
pub use nuwax_agent_core::viewmodels::*;

// 连接状态
pub use nuwax_agent_core::viewmodels::connection_status::{
    ConnectionStatusAction, ConnectionStatusViewModel, ConnectionStatusViewModelState,
    UIConnectionMode, UIConnectionState,
};

// Agent 状态
pub use nuwax_agent_core::viewmodels::agent_status::{
    AgentStatusAction, AgentStatusViewModel, AgentStatusViewModelState, UIAgentState,
};

pub use nuwax_agent_core::viewmodels::client_info::{
    ClientInfoAction, ClientInfoViewModel, ClientInfoViewModelState,
};

pub use nuwax_agent_core::viewmodels::dependency::{
    DependencyAction, DependencyViewModel, DependencyViewModelState, UIDependencyItem,
    UIDependencyStatus,
};

pub use nuwax_agent_core::viewmodels::permissions::{
    PermissionsAction, PermissionsSummary, PermissionsViewModel, PermissionsViewModelState,
    UIPermissionItem, UIPermissionStatus,
};

#[cfg(feature = "remote-desktop")]
pub use nuwax_agent_core::viewmodels::remote_desktop::{
    RemoteDesktopAction, RemoteDesktopViewModel, RemoteDesktopViewModelState,
};

pub use nuwax_agent_core::viewmodels::settings::{
    AppearanceSettingsViewModel, GeneralSettingsViewModel, ServerConfigViewModel, SettingsAction,
    SettingsViewModel, UISettingsPage,
};

pub use nuwax_agent_core::viewmodels::status_bar::{
    StatusBarAction, StatusBarViewModel, StatusBarViewModelState,
};

//! ViewModel 层
//!
//! 负责将业务数据转换为 UI 友好的格式，实现 UI 与业务逻辑的解耦。
//!
//! ## 架构设计
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                   UI 层 (View)                          │
//! │  components/*.rs - 只负责渲染和用户交互                  │
//! └────────────────────┬────────────────────────────────────┘
//!                      │ 单向数据流
//!                      ↓
//! ┌─────────────────────────────────────────────────────────┐
//! │                ViewModel 层                              │
//! │  viewmodels/*.rs - 数据转换 + 状态管理                   │
//! └────────────────────┬────────────────────────────────────┘
//!                      │
//!                      ↓
//! ┌─────────────────────────────────────────────────────────┐
//! │                  业务逻辑层 (Model)                       │
//! │  core/*.rs - 纯业务逻辑                                   │
//! └─────────────────────────────────────────────────────────┘
//! ```

pub mod agent_status;
pub mod client_info;
pub mod connection_status;
pub mod dependency;
pub mod permissions;
#[cfg(feature = "remote-desktop")]
pub mod remote_desktop;
pub mod settings;
pub mod status_bar;

// 连接状态
pub use connection_status::{
    ConnectionStatusAction, ConnectionStatusViewModel, ConnectionStatusViewModelState,
    UIConnectionMode, UIConnectionState,
};

// Agent 状态
pub use agent_status::{
    AgentStatusAction, AgentStatusViewModel, AgentStatusViewModelState, UIAgentState,
};

pub use client_info::{ClientInfoAction, ClientInfoViewModel, ClientInfoViewModelState};
pub use dependency::{
    DependencyAction, DependencyViewModel, DependencyViewModelState, UIDependencyItem,
    UIDependencyStatus,
};
pub use permissions::{
    PermissionsAction, PermissionsSummary, PermissionsViewModel, PermissionsViewModelState,
    UIPermissionItem, UIPermissionStatus,
};

#[cfg(feature = "remote-desktop")]
pub use remote_desktop::{
    RemoteDesktopAction, RemoteDesktopUIState, RemoteDesktopViewModel,
    RemoteDesktopViewModelState,
};

#[cfg(not(feature = "remote-desktop"))]
/// 占位类型，当 remote-desktop feature 未启用时
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum RemoteDesktopUIState {
    /// 未连接
    #[default]
    Disconnected,
}

pub use settings::{
    AppearanceSettingsViewModel, GeneralSettingsViewModel, ServerConfigViewModel,
    SettingsAction, SettingsViewModel, UISettingsPage,
};
pub use status_bar::{
    StatusBarAction, StatusBarViewModel, StatusBarViewModelState,
};

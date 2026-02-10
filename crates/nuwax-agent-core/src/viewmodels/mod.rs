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

// 导出 API traits（由 API 层重新导出，这里也导出方便使用）
pub use super::api::traits::{
    AgentStatusApi, AppearanceSettingsApi, ClientInfoApi, ConnectionStatusApi, DependencyApi,
    GeneralSettingsApi, JsonConfigApi, PermissionsApi, ServerConfigApi, SettingsApi, StatusBarApi,
};

// 导出共享类型（从子模块重新导出）
pub use super::api::traits::connection_status::ConnectionStatusViewModelState as ConnectionStatusState;
pub use super::api::traits::status_bar::StatusBarViewModelState as StatusBarState;

// 从 connection_status 重新导出类型（供外部使用）
pub use connection_status::{
    ConnectionStatusAction, ConnectionStatusViewModel, ConnectionStatusViewModelState,
    UIConnectionMode, UIConnectionState,
};

// 从 agent_status 重新导出类型（供外部使用）
pub use agent_status::{
    AgentStatusAction, AgentStatusViewModel, AgentStatusViewModelState, UIAgentState,
};

// 导出图标名称类型
pub use settings::UIIconName as IconName;

pub mod agent_status;
pub mod client_info;
pub mod connection_status;
pub mod dependency;
pub mod permissions;
#[cfg(feature = "remote-desktop")]
pub mod remote_desktop;
pub mod settings;
pub mod status_bar;

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
pub use super::api::traits::RemoteDesktopApi;

#[cfg(feature = "remote-desktop")]
pub use remote_desktop::{
    RemoteDesktopAction, RemoteDesktopViewModel, RemoteDesktopViewModelState,
};

#[cfg(not(feature = "remote-desktop"))]
/// 占位状态，当 remote-desktop feature 未启用时
pub type RemoteDesktopViewModelState = ();

#[cfg(not(feature = "remote-desktop"))]
/// 占位类型，当 remote-desktop feature 未启用时
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RemoteDesktopViewModel;

#[cfg(not(feature = "remote-desktop"))]
/// 占位操作，当 remote-desktop feature 未启用时
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RemoteDesktopAction;

pub use settings::{
    AppearanceSettingsViewModel, GeneralSettingsViewModel, ServerConfigViewModel, SettingsAction,
    SettingsViewModel, UISettingsPage,
};
pub use status_bar::{StatusBarAction, StatusBarViewModel};

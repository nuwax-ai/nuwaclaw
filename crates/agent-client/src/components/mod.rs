//! UI 组件模块

pub mod about;
#[cfg(feature = "chat-ui")]
pub mod chat;
pub mod client_info;
pub mod dependency_manager;
/// Feature 标志集中管理
pub mod features;
pub mod permissions;
#[cfg(feature = "remote-desktop")]
pub mod remote_desktop;
pub mod root;
pub mod settings;
pub mod status_bar;

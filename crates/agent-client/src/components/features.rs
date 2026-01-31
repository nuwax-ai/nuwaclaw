//! Feature 标志集中管理
//!
//! 提供统一的 feature 导出，便于在代码中使用条件编译。
//! 这样可以将条件编译集中在一处，避免散布在多个文件中。

/// Chat UI 功能是否启用
#[cfg(feature = "chat-ui")]
pub const CHAT_UI_ENABLED: bool = true;

/// Chat UI 功能是否启用（常量，用于非条件编译场景）
#[cfg(not(feature = "chat-ui"))]
pub const CHAT_UI_ENABLED: bool = false;

/// 远程桌面功能是否启用
#[cfg(feature = "remote-desktop")]
pub const REMOTE_DESKTOP_ENABLED: bool = true;

/// 远程桌面功能是否启用（常量，用于非条件编译场景）
#[cfg(not(feature = "remote-desktop"))]
pub const REMOTE_DESKTOP_ENABLED: bool = false;

/// 自动启动功能是否启用
#[cfg(feature = "auto-launch")]
pub const AUTO_LAUNCH_ENABLED: bool = true;

/// 自动启动功能是否启用（常量，用于非条件编译场景）
#[cfg(not(feature = "auto-launch"))]
pub const AUTO_LAUNCH_ENABLED: bool = false;

/// 文件传输功能是否启用
#[cfg(feature = "file-transfer")]
pub const FILE_TRANSFER_ENABLED: bool = true;

/// 文件传输功能是否启用（常量，用于非条件编译场景）
#[cfg(not(feature = "file-transfer"))]
pub const FILE_TRANSFER_ENABLED: bool = false;

/// 依赖管理功能是否启用
#[cfg(feature = "dependency-management")]
pub const DEPENDENCY_MANAGEMENT_ENABLED: bool = true;

/// 依赖管理功能是否启用（常量，用于非条件编译场景）
#[cfg(not(feature = "dependency-management"))]
pub const DEPENDENCY_MANAGEMENT_ENABLED: bool = false;

/// 平台特定的 UI 模块导出
#[cfg(feature = "remote-desktop")]
pub use super::remote_desktop as remote_desktop_ui;

/// 平台特定的 UI 模块导出
#[cfg(feature = "chat-ui")]
pub use super::chat as chat_ui;

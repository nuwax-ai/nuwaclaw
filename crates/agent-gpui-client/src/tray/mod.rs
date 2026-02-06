//! 系统托盘模块
//!
//! 使用 nuwax-platform 提供统一托盘类型定义

#[cfg(feature = "tray")]
pub mod manager;

#[cfg(feature = "tray")]
pub use manager::TrayManager;

// 重新导出 nuwax-platform 的托盘类型以保持 API 一致性
#[cfg(feature = "tray")]
pub use nuwax_platform::tray::{TrayEvent, TrayMenu, TrayMenuItem};
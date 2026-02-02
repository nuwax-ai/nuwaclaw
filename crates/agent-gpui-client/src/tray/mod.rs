//! 系统托盘模块

#[cfg(feature = "tray")]
pub mod manager;

#[cfg(feature = "tray")]
pub use manager::TrayManager;

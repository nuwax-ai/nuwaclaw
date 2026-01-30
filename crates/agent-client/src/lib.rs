//! nuwax-agent - 跨平台 Agent 客户端
//!
//! 支持远程桌面、文件传输、Agent 任务执行等功能

pub mod app;
pub mod components;
pub mod core;
pub mod i18n;
pub mod message;
pub mod tray;
pub mod utils;

// 导出公共 API
pub use app::App;
pub use core::config::AppConfig;

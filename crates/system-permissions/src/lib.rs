//! 跨平台系统权限管理库
//!
//! 提供统一接口获取 macOS/Windows/Linux 系统权限
//!
//! # 功能
//!
//! - 检查系统权限状态 (麦克风、相机、屏幕录制、位置等)
//! - 请求用户授权权限
//! - 打开系统设置页面
//!
//! # 支持的平台
//!
//! | 权限类型 | macOS | Windows | Linux |
//! |---------|-------|---------|-------|
//! | Accessibility | ✓ | ✓ (UAC) | ✓ (AT-SPI) |
//! | ScreenRecording | ✓ | - | ✓ (PipeWire) |
//! | Microphone | ✓ | ✓ | ✓ |
//! | Camera | ✓ | ✓ | ✓ |
//! | Notifications | ✓ | ✓ | - |
//! | SpeechRecognition | ✓ | - | - |
//! | Location | ✓ | ✓ | ✓ |
//! | AppleScript | ✓ | - | - |
//!
//! # 使用示例
//!
//! ```rust
//! use system_permissions::{create_permission_manager, SystemPermission, RequestOptions};
//!
//! #[tokio::main]
//! async fn main() {
//!     // 创建权限管理器 (自动根据当前平台)
//!     let manager = create_permission_manager();
//!
//!     // 检查权限状态
//!     let state = manager.check(SystemPermission::Microphone).await;
//!     println!("Microphone status: {:?}", state.status);
//!
//!     // 请求权限 (交互式)
//!     let result = manager.request(
//!         SystemPermission::Microphone,
//!         RequestOptions::interactive().with_reason("Need microphone for voice input"),
//!     ).await;
//!
//!     if result.granted {
//!         println!("Permission granted!");
//!     } else if let Some(guide) = result.settings_guide {
//!         println!("Please enable manually: {}", guide);
//!     }
//! }
//! ```

// 重新导出公共 API
pub use crate::error::{PermissionError, PermissionResult};
pub use crate::factory::{create_permission_manager, create_permission_monitor};
pub use crate::monitor::PollingPermissionMonitor;
pub use crate::permissions_trait::{
    PermissionChangeCallback, PermissionManager, PermissionMonitor, RequestBuilder,
};
pub use crate::types::{
    CheckResult, LocationMode, PermissionState, PermissionStatus, RequestOptions, RequestResult,
    SystemPermission,
};

// 模块声明（按平台条件编译）
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod monitor;
#[cfg(target_os = "windows")]
pub mod windows;

// 内部模块
mod error;
mod factory;
mod permissions_trait;
mod types;

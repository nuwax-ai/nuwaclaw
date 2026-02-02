//! 工厂模块
//!
//! 提供创建权限管理器的便捷函数

use std::sync::Arc;

#[cfg(target_os = "macos")]
use crate::macos::MacOSPermissionManager;

#[cfg(target_os = "windows")]
use crate::windows::WindowsPermissionManager;

#[cfg(target_os = "linux")]
use crate::linux::LinuxPermissionManager;

use crate::PermissionManager;

/// 根据当前平台创建权限管理器
///
/// 返回一个 Arc 包装的 Trait 对象，可以在应用程序中共享使用
///
/// # 示例
///
/// ```rust
/// use system_permissions::{create_permission_manager, SystemPermission};
///
/// #[tokio::main]
/// async fn main() {
///     let manager = create_permission_manager();
///     let state = manager.check(SystemPermission::Microphone).await;
///     println!("Microphone status: {:?}", state.status);
/// }
/// ```
#[cfg(target_os = "macos")]
pub fn create_permission_manager() -> Arc<dyn PermissionManager> {
    Arc::new(MacOSPermissionManager::new())
}

#[cfg(target_os = "windows")]
pub fn create_permission_manager() -> Arc<dyn PermissionManager> {
    Arc::new(WindowsPermissionManager::new())
}

#[cfg(target_os = "linux")]
pub fn create_permission_manager() -> Arc<dyn PermissionManager> {
    Arc::new(LinuxPermissionManager::new())
}

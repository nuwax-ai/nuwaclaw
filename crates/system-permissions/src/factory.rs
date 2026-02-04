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

// 权限监控器工厂函数

use crate::monitor::PollingPermissionMonitor;
use crate::PermissionMonitor;

/// 创建权限监控器
///
/// 返回一个 Arc 包装的 PermissionMonitor Trait 对象
///
/// # 示例
///
/// ```rust
/// use system_permissions::{create_permission_monitor, SystemPermission};
///
/// #[tokio::main]
/// async fn main() {
///     let monitor = create_permission_monitor();
///     monitor.start().await.expect("Failed to start monitor");
///     
///     let mut rx = monitor.subscribe();
///     // 监听权限变化事件
///     while let Ok((permission, state)) = rx.recv().await {
///         println!("{:?} changed to {:?}", permission, state.status);
///     }
/// }
/// ```
pub fn create_permission_monitor() -> Arc<dyn PermissionMonitor> {
    let manager = create_permission_manager();
    Arc::new(PollingPermissionMonitor::new(manager))
}

use std::sync::Arc;
use system_permissions::PermissionMonitor;
use tokio::sync::Mutex;

/// 权限监控状态(使用延迟初始化)
pub struct MonitorState {
    pub monitor: Mutex<Option<Arc<dyn PermissionMonitor>>>,
    pub task_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Default for MonitorState {
    fn default() -> Self {
        Self {
            monitor: Mutex::new(None),
            task_handle: Mutex::new(None),
        }
    }
}

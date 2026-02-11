use std::sync::Arc;
use system_permissions::{create_permission_manager, PermissionManager};
use tokio::sync::Mutex;

/// 权限管理状态(使用延迟初始化避免启动时崩溃)
pub struct PermissionsState {
    manager: Mutex<Option<Arc<dyn PermissionManager + Send + Sync>>>,
}

impl Default for PermissionsState {
    fn default() -> Self {
        Self {
            manager: Mutex::new(None), // 延迟初始化
        }
    }
}

impl PermissionsState {
    pub async fn get_manager(&self) -> Arc<dyn PermissionManager + Send + Sync> {
        let mut guard = self.manager.lock().await;
        if guard.is_none() {
            *guard = Some(create_permission_manager());
        }
        guard.as_ref().unwrap().clone()
    }
}

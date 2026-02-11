use serde::{Deserialize, Serialize};
use system_permissions::{PermissionState, SystemPermission};

// 可序列化的权限状态（用于 Tauri IPC）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionStateDto {
    pub permission: String,
    pub status: String,
    pub can_request: bool,
    pub granted_at: Option<String>,
}

// 可序列化的请求结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestResultDto {
    pub permission: String,
    pub granted: bool,
    pub status: String,
    pub error_message: Option<String>,
    pub settings_guide: Option<String>,
}

/// 权限变化事件 DTO（用于 Tauri 事件）
#[derive(Debug, Clone, Serialize)]
pub struct PermissionChangeEvent {
    pub permission: String,
    pub status: String,
    pub can_request: bool,
}

impl From<(SystemPermission, PermissionState)> for PermissionChangeEvent {
    fn from((perm, state): (SystemPermission, PermissionState)) -> Self {
        Self {
            permission: perm.name().to_lowercase(),
            status: format!("{:?}", state.status),
            can_request: state.can_request,
        }
    }
}

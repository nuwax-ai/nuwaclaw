//! 权限管理模块
//!
//! 跨平台权限检测和管理

pub mod detector;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::debug;

/// 权限错误
#[derive(Error, Debug)]
pub enum PermissionError {
    #[error("权限检测失败: {0}")]
    DetectionFailed(String),
    #[error("无法打开系统设置: {0}")]
    OpenSettingsFailed(String),
    #[error("不支持的平台")]
    UnsupportedPlatform,
}

/// 权限类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PermissionType {
    /// 辅助功能
    Accessibility,
    /// 屏幕录制
    ScreenRecording,
    /// 完整磁盘访问
    FullDiskAccess,
    /// 文件系统访问
    FileAccess,
    /// 网络访问
    NetworkAccess,
}

impl PermissionType {
    /// 获取描述
    pub fn description(&self) -> &'static str {
        match self {
            Self::Accessibility => "辅助功能",
            Self::ScreenRecording => "屏幕录制",
            Self::FullDiskAccess => "完整磁盘访问",
            Self::FileAccess => "文件系统访问",
            Self::NetworkAccess => "网络访问",
        }
    }

    /// 是否需要此权限
    pub fn is_required(&self) -> bool {
        matches!(self, Self::Accessibility | Self::FileAccess | Self::NetworkAccess)
    }
}

/// 权限状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionStatus {
    /// 已授权
    Granted,
    /// 未授权
    Denied,
    /// 需要请求
    NotDetermined,
    /// 不可用（平台不支持）
    Unavailable,
}

impl PermissionStatus {
    /// 是否已授权
    pub fn is_granted(&self) -> bool {
        matches!(self, Self::Granted)
    }
}

/// 权限信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionInfo {
    /// 权限类型
    pub permission_type: PermissionType,
    /// 状态
    pub status: PermissionStatus,
    /// 说明
    pub description: String,
    /// 如何授权的指引
    pub grant_instructions: Option<String>,
}

/// 权限管理器
pub struct PermissionManager {
    /// 缓存的权限状态
    permissions: Vec<PermissionInfo>,
}

impl Default for PermissionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PermissionManager {
    /// 创建新的权限管理器
    pub fn new() -> Self {
        Self {
            permissions: Vec::new(),
        }
    }

    /// 检查所有权限
    pub fn check_all(&mut self) -> &[PermissionInfo] {
        self.permissions = self.detect_all_permissions();
        &self.permissions
    }

    /// 检查单个权限
    pub fn check(&self, permission_type: PermissionType) -> PermissionInfo {
        detector::check_permission(permission_type)
    }

    /// 获取缓存的权限列表
    pub fn permissions(&self) -> &[PermissionInfo] {
        &self.permissions
    }

    /// 是否所有必要权限已授权
    pub fn all_required_granted(&self) -> bool {
        self.permissions
            .iter()
            .filter(|p| p.permission_type.is_required())
            .all(|p| p.status.is_granted())
    }

    /// 获取未授权的必要权限
    pub fn missing_required(&self) -> Vec<&PermissionInfo> {
        self.permissions
            .iter()
            .filter(|p| p.permission_type.is_required() && !p.status.is_granted())
            .collect()
    }

    /// 打开系统权限设置
    pub fn open_settings(&self, permission_type: PermissionType) -> Result<(), PermissionError> {
        debug!("Opening settings for: {:?}", permission_type);
        detector::open_permission_settings(permission_type)
    }

    /// 检测所有权限
    fn detect_all_permissions(&self) -> Vec<PermissionInfo> {
        let types = [
            PermissionType::Accessibility,
            PermissionType::ScreenRecording,
            PermissionType::FullDiskAccess,
            PermissionType::FileAccess,
            PermissionType::NetworkAccess,
        ];

        types.iter().map(|t| detector::check_permission(*t)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_type_description() {
        assert_eq!(PermissionType::Accessibility.description(), "辅助功能");
        assert_eq!(PermissionType::ScreenRecording.description(), "屏幕录制");
    }

    #[test]
    fn test_permission_required() {
        assert!(PermissionType::Accessibility.is_required());
        assert!(PermissionType::FileAccess.is_required());
        assert!(!PermissionType::ScreenRecording.is_required());
    }

    #[test]
    fn test_permission_status() {
        assert!(PermissionStatus::Granted.is_granted());
        assert!(!PermissionStatus::Denied.is_granted());
        assert!(!PermissionStatus::NotDetermined.is_granted());
    }

    #[test]
    fn test_manager_creation() {
        let manager = PermissionManager::new();
        assert!(manager.permissions().is_empty());
    }

    #[test]
    fn test_check_all() {
        let mut manager = PermissionManager::new();
        let perms = manager.check_all();
        assert_eq!(perms.len(), 5);
    }

    #[test]
    fn test_check_single() {
        let manager = PermissionManager::new();
        let info = manager.check(PermissionType::NetworkAccess);
        assert_eq!(info.permission_type, PermissionType::NetworkAccess);
    }
}

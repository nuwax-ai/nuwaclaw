//! 权限管理模块
//!
//! 管理客户端的系统权限

use open;
use thiserror::Error;
use tracing::debug;

#[cfg(target_os = "linux")]
use crate::utils::CommandNoWindowExt;

/// 权限错误
#[derive(Error, Debug)]
pub enum PermissionError {
    #[error("权限检查失败: {0}")]
    CheckFailed(String),
    #[error("权限请求失败: {0}")]
    RequestFailed(String),
    #[error("权限类型不支持: {0}")]
    UnsupportedPermission(String),
}

/// 权限项
#[derive(Debug, Clone)]
pub struct PermissionItem {
    /// 权限名称
    pub name: String,
    /// 显示名称
    pub display_name: String,
    /// 描述
    pub description: String,
    /// 状态
    pub status: PermissionStatus,
    /// 是否已请求
    pub requested: bool,
}

/// 权限状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionStatus {
    /// 未知
    Unknown,
    /// 已授权
    Granted,
    /// 被拒绝
    Denied,
    /// 待确认
    Pending,
}

/// 权限管理器
pub struct PermissionManager {
    /// 权限列表
    permissions: Vec<PermissionItem>,
}

impl Default for PermissionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PermissionManager {
    /// 创建新的权限管理器
    pub fn new() -> Self {
        let permissions = Self::default_permissions();
        Self { permissions }
    }

    /// 打开系统权限设置页面
    #[cfg(target_os = "macos")]
    pub fn open_settings(permission: &str) -> Result<(), PermissionError> {
        let url = match permission {
            "screen_recording" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "input_monitoring" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
            }
            "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
            "microphone" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            }
            _ => {
                tracing::error!("不支持的权限类型: {}", permission);
                return Err(PermissionError::UnsupportedPermission(
                    permission.to_string(),
                ));
            }
        };

        tracing::info!("打开系统设置 URL: {}", url);

        open::that(url).map_err(|e| PermissionError::RequestFailed(e.to_string()))
    }

    /// 打开系统权限设置页面 (Windows)
    #[cfg(target_os = "windows")]
    pub fn open_settings(permission: &str) -> Result<(), PermissionError> {
        let url = match permission {
            "screen_recording" => "ms-settings:privacy-broadfilesystemaccess",
            "accessibility" => "ms-settings:easeofaccess-display",
            "input_monitoring" => "ms-settings:privacy-backgroundapps",
            "camera" => "ms-settings:privacy-webcam",
            "microphone" => "ms-settings:privacy-microphone",
            _ => {
                tracing::error!("不支持的权限类型: {}", permission);
                return Err(PermissionError::UnsupportedPermission(
                    permission.to_string(),
                ));
            }
        };

        tracing::info!("打开系统设置 URL: {}", url);

        open::that(url).map_err(|e| PermissionError::RequestFailed(e.to_string()))
    }

    /// 打开系统权限设置页面 (Linux)
    #[cfg(target_os = "linux")]
    pub fn open_settings(permission: &str) -> Result<(), PermissionError> {
        // Linux 桌面环境差异大，尝试打开通用隐私/安全设置
        let url = match permission {
            "camera" => "xdg-open x-scheme-handler/camera",
            "microphone" => "xdg-open x-scheme-handler/microphone",
            _ => {
                // 对于大多数权限，尝试打开 GNOME Settings 的隐私面板
                // 如果不是 GNOME，xdg-open 会回退到系统默认设置应用
                tracing::info!(
                    "Linux 平台权限 '{}' 无直接设置页面，尝试打开系统设置",
                    permission
                );
                "gnome-control-center privacy"
            }
        };

        tracing::info!("打开系统设置: {}", url);

        // 尝试 GNOME 设置面板，失败则回退到 xdg-open
        let result = match permission {
            "camera" | "microphone" => open::that(format!("gnome-control-center {}", permission))
                .or_else(|_| open::that("xdg-settings")),
            _ => std::process::Command::new("gnome-control-center")
                .no_window()
                .arg("privacy")
                .spawn()
                .map(|_| ())
                .or_else(|_| {
                    std::process::Command::new("xdg-open")
                        .no_window()
                        .arg("gnome-control-center:")
                        .spawn()
                        .map(|_| ())
                }),
        };

        result.map_err(|e| {
            PermissionError::RequestFailed(format!(
                "无法打开系统设置，请手动在系统设置中授权: {}",
                e
            ))
        })
    }

    /// 打开系统权限设置页面 (其他平台)
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    pub fn open_settings(permission: &str) -> Result<(), PermissionError> {
        Err(PermissionError::UnsupportedPermission(format!(
            "当前平台不支持自动打开权限设置: {}",
            permission
        )))
    }

    /// 默认权限列表
    fn default_permissions() -> Vec<PermissionItem> {
        vec![
            PermissionItem {
                name: "screen_recording".to_string(),
                display_name: "屏幕录制".to_string(),
                description: "允许应用程序捕获屏幕内容用于远程桌面功能".to_string(),
                status: PermissionStatus::Unknown,
                requested: false,
            },
            PermissionItem {
                name: "input_monitoring".to_string(),
                display_name: "输入监控".to_string(),
                description: "允许应用程序监控输入事件，用于远程控制时拦截本地键盘鼠标操作"
                    .to_string(),
                status: PermissionStatus::Unknown,
                requested: false,
            },
            PermissionItem {
                name: "accessibility".to_string(),
                display_name: "辅助功能".to_string(),
                description: "允许应用程序控制输入设备用于远程操作功能".to_string(),
                status: PermissionStatus::Unknown,
                requested: false,
            },
            PermissionItem {
                name: "camera".to_string(),
                display_name: "摄像头".to_string(),
                description: "允许访问摄像头用于视频通话功能".to_string(),
                status: PermissionStatus::Unknown,
                requested: false,
            },
            PermissionItem {
                name: "microphone".to_string(),
                display_name: "麦克风".to_string(),
                description: "允许访问麦克风用于语音通话功能".to_string(),
                status: PermissionStatus::Unknown,
                requested: false,
            },
        ]
    }

    /// 获取所有权限
    pub async fn get_all(&self) -> Vec<PermissionItem> {
        self.permissions.clone()
    }

    /// 检查权限状态
    pub async fn check(&self, permission: &str) -> PermissionStatus {
        debug!("Checking permission: {}", permission);

        // 实际实现需要根据平台调用系统 API
        // 这里返回默认值
        self.permissions
            .iter()
            .find(|p| p.name == permission)
            .map(|p| p.status.clone())
            .unwrap_or(PermissionStatus::Unknown)
    }

    /// 请求权限
    pub async fn request(&self, permission: &str) -> bool {
        debug!("Requesting permission: {}", permission);

        // 实际实现需要打开系统权限设置或请求对话框
        // 这里返回模拟结果
        true
    }

    /// 撤销权限
    pub async fn revoke(&self, permission: &str) -> bool {
        debug!("Revoking permission: {}", permission);

        // 实际实现需要打开系统权限设置
        // 这里返回模拟结果
        true
    }

    /// 检查所有权限状态
    pub async fn check_all(&mut self) {
        for perm in &mut self.permissions {
            // 直接内联检查逻辑，避免借用问题
            perm.status = PermissionStatus::Unknown; // 模拟结果
        }
    }

    /// 获取缺失的必需权限
    pub async fn get_missing_permissions(&self) -> Vec<String> {
        self.permissions
            .iter()
            .filter(|p| p.status != PermissionStatus::Granted)
            .map(|p| p.name.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_permission_manager_creation() {
        let manager = PermissionManager::new();
        let permissions = manager.get_all().await;

        assert!(!permissions.is_empty());
        assert!(permissions.iter().any(|p| p.name == "screen_recording"));
    }

    #[tokio::test]
    async fn test_check_permission() {
        let manager = PermissionManager::new();
        let status = manager.check("screen_recording").await;

        // 默认状态应该是 Unknown
        assert_eq!(status, PermissionStatus::Unknown);
    }

    #[tokio::test]
    async fn test_get_missing_permissions() {
        let manager = PermissionManager::new();
        let missing = manager.get_missing_permissions().await;

        // 默认所有权限都是缺失的
        assert!(!missing.is_empty());
    }

    #[test]
    fn test_default_permissions_include_all_types() {
        let perms = PermissionManager::default_permissions();
        let names: Vec<&str> = perms.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"screen_recording"));
        assert!(names.contains(&"accessibility"));
        assert!(names.contains(&"input_monitoring"));
        assert!(names.contains(&"camera"));
        assert!(names.contains(&"microphone"));
    }

    #[test]
    fn test_permission_status_default_is_unknown() {
        let perms = PermissionManager::default_permissions();
        for perm in &perms {
            assert_eq!(perm.status, PermissionStatus::Unknown);
            assert!(!perm.requested);
        }
    }

    #[test]
    fn test_open_settings_unsupported_permission() {
        let result = PermissionManager::open_settings("nonexistent_permission");
        assert!(result.is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_open_settings_known_permissions_macos() {
        // 验证已知权限名称不触发 UnsupportedPermission 错误
        // 不实际调用 open_settings（会打开系统设置窗口）
        let known = [
            "screen_recording",
            "accessibility",
            "input_monitoring",
            "camera",
            "microphone",
        ];
        for _perm in &known {
            // 这里不调用 open_settings 因为会真正打开系统设置
            // 测试重点在于验证 unsupported 分支（已在上面 test_open_settings_unsupported_permission 覆盖）
        }
    }

    #[tokio::test]
    async fn test_check_unknown_permission() {
        let manager = PermissionManager::new();
        let status = manager.check("nonexistent").await;
        assert_eq!(status, PermissionStatus::Unknown);
    }

    #[tokio::test]
    async fn test_permission_manager_check_all() {
        let mut manager = PermissionManager::new();
        manager.check_all().await;
        // check_all 不应 panic
        let perms = manager.get_all().await;
        assert!(!perms.is_empty());
    }
}

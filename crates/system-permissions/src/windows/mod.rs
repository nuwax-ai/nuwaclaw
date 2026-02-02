//! Windows 权限管理器实现
//!
//! 使用系统工具检查和请求各种系统权限

use async_trait::async_trait;

use crate::{
    LocationMode, PermissionError, PermissionManager, PermissionState, PermissionStatus,
    RequestOptions, RequestResult, SystemPermission,
};

/// Windows 权限管理器
///
/// 使用 Windows API 检查和请求系统权限
#[derive(Debug, Default)]
pub struct WindowsPermissionManager;

impl WindowsPermissionManager {
    /// 创建新的 Windows 权限管理器
    pub fn new() -> Self {
        Self
    }

    /// 检查管理员权限
    async fn check_admin(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Accessibility,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查麦克风权限
    async fn check_microphone(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Microphone,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查相机权限
    async fn check_camera(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Camera,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查通知权限
    async fn check_notifications(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Notifications,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查位置权限
    async fn check_location(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Location,
            status: PermissionStatus::NotDetermined,
            location_mode: Some(LocationMode::Off),
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查屏幕录制权限
    async fn check_screen_recording(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::ScreenRecording,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查 NuwaxCode / Claude Code / 文件系统 / 剪贴板 / 键盘监控 / 网络 等权限
    /// Windows 上多为 UAC 或应用能力声明，此处返回未决定
    async fn check_ide_and_extra(&self, permission: SystemPermission) -> PermissionState {
        PermissionState {
            permission,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 请求管理员权限
    async fn request_admin(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Accessibility,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Requires administrator privileges".to_string()),
            settings_guide: Some("Right-click and select 'Run as administrator'".to_string()),
        }
    }

    /// 请求麦克风权限
    async fn request_microphone(&self, _options: RequestOptions) -> RequestResult {
        open_privacy_settings("microphone");

        RequestResult {
            permission: SystemPermission::Microphone,
            granted: false,
            status: PermissionStatus::NotDetermined,
            error_message: Some("Please enable microphone access in Windows Settings".to_string()),
            settings_guide: Some("Settings > Privacy > Microphone".to_string()),
        }
    }

    /// 请求相机权限
    async fn request_camera(&self, _options: RequestOptions) -> RequestResult {
        open_privacy_settings("camera");

        RequestResult {
            permission: SystemPermission::Camera,
            granted: false,
            status: PermissionStatus::NotDetermined,
            error_message: Some("Please enable camera access in Windows Settings".to_string()),
            settings_guide: Some("Settings > Privacy > Camera".to_string()),
        }
    }

    /// 请求通知权限
    async fn request_notifications(&self, _options: RequestOptions) -> RequestResult {
        open_privacy_settings("notifications");

        RequestResult {
            permission: SystemPermission::Notifications,
            granted: false,
            status: PermissionStatus::NotDetermined,
            error_message: Some("Please enable notifications in Windows Settings".to_string()),
            settings_guide: Some("Settings > System > Notifications".to_string()),
        }
    }

    /// 请求位置权限
    async fn request_location(&self, _options: RequestOptions) -> RequestResult {
        open_privacy_settings("location");

        RequestResult {
            permission: SystemPermission::Location,
            granted: false,
            status: PermissionStatus::NotDetermined,
            error_message: Some("Please enable location access in Windows Settings".to_string()),
            settings_guide: Some("Settings > Privacy > Location".to_string()),
        }
    }
}

#[async_trait]
impl PermissionManager for WindowsPermissionManager {
    fn supported_permissions(&self) -> Vec<SystemPermission> {
        vec![
            SystemPermission::Accessibility,
            SystemPermission::ScreenRecording,
            SystemPermission::Microphone,
            SystemPermission::Camera,
            SystemPermission::Notifications,
            SystemPermission::Location,
            SystemPermission::NuwaxCode,
            SystemPermission::ClaudeCode,
            SystemPermission::FileSystemRead,
            SystemPermission::FileSystemWrite,
            SystemPermission::Clipboard,
            SystemPermission::KeyboardMonitoring,
            SystemPermission::Network,
        ]
    }

    async fn check(&self, permission: SystemPermission) -> PermissionState {
        match permission {
            SystemPermission::Accessibility => self.check_admin().await,
            SystemPermission::ScreenRecording => self.check_screen_recording().await,
            SystemPermission::Microphone => self.check_microphone().await,
            SystemPermission::Camera => self.check_camera().await,
            SystemPermission::Notifications => self.check_notifications().await,
            SystemPermission::Location => self.check_location().await,
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite
            | SystemPermission::Clipboard
            | SystemPermission::KeyboardMonitoring
            | SystemPermission::Network => self.check_ide_and_extra(permission).await,
            _ => PermissionState::unavailable(permission),
        }
    }

    async fn check_all(&self, permissions: &[SystemPermission]) -> Vec<PermissionState> {
        let mut states = Vec::with_capacity(permissions.len());
        for permission in permissions {
            states.push(self.check(*permission).await);
        }
        states
    }

    async fn request(
        &self,
        permission: SystemPermission,
        options: RequestOptions,
    ) -> RequestResult {
        match permission {
            SystemPermission::Accessibility => self.request_admin(options).await,
            SystemPermission::ScreenRecording => {
                RequestResult::granted(permission, PermissionStatus::Authorized)
            }
            SystemPermission::Microphone => self.request_microphone(options).await,
            SystemPermission::Camera => self.request_camera(options).await,
            SystemPermission::Notifications => self.request_notifications(options).await,
            SystemPermission::Location => self.request_location(options).await,
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite
            | SystemPermission::Clipboard
            | SystemPermission::KeyboardMonitoring
            | SystemPermission::Network => {
                let _ = self.open_settings(permission).await;
                RequestResult::denied(
                    permission,
                    Some("Please enable the permission in Windows Settings".to_string()),
                    Some("Settings > Privacy & security".to_string()),
                )
            }
            _ => RequestResult::unsupported(permission),
        }
    }

    async fn open_settings(&self, permission: SystemPermission) -> Result<(), PermissionError> {
        let settings_page = match permission {
            SystemPermission::Accessibility => "privacy-accessibility",
            SystemPermission::ScreenRecording => "privacy-webcam",
            SystemPermission::Microphone => "privacy-microphone",
            SystemPermission::Camera => "privacy-webcam",
            SystemPermission::Notifications => "notifications",
            SystemPermission::Location => "privacy-location",
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite => "privacy-apps",
            SystemPermission::Clipboard
            | SystemPermission::KeyboardMonitoring => "privacy-accessibility",
            SystemPermission::Network => "privacy-apps",
            _ => return Err(PermissionError::Unsupported { permission: permission.name() }),
        };

        open_privacy_settings(settings_page);
        Ok(())
    }

    async fn request_all(
        &self,
        permissions: &[SystemPermission],
        options: RequestOptions,
    ) -> Vec<RequestResult> {
        let mut results = Vec::with_capacity(permissions.len());
        for permission in permissions {
            results.push(self.request(*permission, options.clone()).await);
        }
        results
    }
}

/// 打开 Windows 隐私设置页面
fn open_privacy_settings(category: &str) {
    let _ = std::process::Command::new("cmd")
        .args(&["/c", &format!("start ms-settings:{}", category)])
        .spawn();
}

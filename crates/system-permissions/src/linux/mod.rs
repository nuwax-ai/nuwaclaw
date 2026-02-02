//! Linux 权限管理器实现
//!
//! 使用 D-Bus 和系统工具检查和请求各种系统权限

use async_trait::async_trait;
use chrono::Utc;

use crate::{
    LocationMode, PermissionError, PermissionManager, PermissionState, PermissionStatus,
    RequestOptions, RequestResult, SystemPermission,
};

/// Linux 权限管理器
///
/// 使用 D-Bus 和系统工具检查和请求 Linux 系统权限
#[derive(Debug, Default)]
pub struct LinuxPermissionManager;

impl LinuxPermissionManager {
    /// 创建新的 Linux 权限管理器
    pub fn new() -> Self {
        Self
    }

    /// 检查 AT-SPI 辅助功能权限
    async fn check_accessibility(&self) -> PermissionState {
        let has_access = check_atspi_access();

        PermissionState {
            permission: SystemPermission::Accessibility,
            status: if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if has_access { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查 PipeWire 屏幕录制权限
    async fn check_screen_recording(&self) -> PermissionState {
        let has_access = check_pipewire_access();

        PermissionState {
            permission: SystemPermission::ScreenRecording,
            status: if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if has_access { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查音频设备权限
    async fn check_microphone(&self) -> PermissionState {
        let has_access = check_audio_device_access();

        PermissionState {
            permission: SystemPermission::Microphone,
            status: if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if has_access { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查相机权限
    async fn check_camera(&self) -> PermissionState {
        let has_access = check_camera_access();

        PermissionState {
            permission: SystemPermission::Camera,
            status: if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if has_access { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查位置权限
    async fn check_location(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Location,
            status: PermissionStatus::Denied,
            location_mode: Some(LocationMode::Off),
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查 NuwaxCode / Claude Code / 文件系统 / 剪贴板 / 键盘监控 / 网络 等权限
    /// Linux 上多为文件/会话权限，此处返回未决定
    async fn check_ide_and_extra(&self, permission: SystemPermission) -> PermissionState {
        PermissionState {
            permission,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 请求辅助功能权限
    async fn request_accessibility(&self, _options: RequestOptions) -> RequestResult {
        let _ = std::process::Command::new("sh")
            .args(&["-c", "gnome-control-center accessibility 2>/dev/null || xdg-open settings://accessibility"])
            .spawn();

        RequestResult {
            permission: SystemPermission::Accessibility,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Please enable Accessibility in system settings".to_string()),
            settings_guide: Some("System Settings > Accessibility".to_string()),
        }
    }

    /// 请求屏幕录制权限
    async fn request_screen_recording(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::ScreenRecording,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Screen recording requires portal permission".to_string()),
            settings_guide: Some("Allow screen recording in the permission dialog".to_string()),
        }
    }

    /// 请求麦克风权限
    async fn request_microphone(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Microphone,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Microphone access requires device permission".to_string()),
            settings_guide: Some("Check /dev/snd device permissions".to_string()),
        }
    }

    /// 请求相机权限
    async fn request_camera(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Camera,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Camera access requires /dev/video* device permission".to_string()),
            settings_guide: Some("Check /dev/video device permissions".to_string()),
        }
    }

    /// 请求位置权限
    async fn request_location(&self, _options: RequestOptions) -> RequestResult {
        let _ = std::process::Command::new("sh")
            .args(&["-c", "gnome-control-center privacy 2>/dev/null || xdg-open settings://privacy"])
            .spawn();

        RequestResult {
            permission: SystemPermission::Location,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Location services must be enabled in system settings".to_string()),
            settings_guide: Some("System Settings > Privacy > Location Services".to_string()),
        }
    }
}

#[async_trait]
impl PermissionManager for LinuxPermissionManager {
    fn supported_permissions(&self) -> Vec<SystemPermission> {
        vec![
            SystemPermission::Accessibility,
            SystemPermission::ScreenRecording,
            SystemPermission::Microphone,
            SystemPermission::Camera,
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
            SystemPermission::Accessibility => self.check_accessibility().await,
            SystemPermission::ScreenRecording => self.check_screen_recording().await,
            SystemPermission::Microphone => self.check_microphone().await,
            SystemPermission::Camera => self.check_camera().await,
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
            SystemPermission::Accessibility => self.request_accessibility(options).await,
            SystemPermission::ScreenRecording => self.request_screen_recording(options).await,
            SystemPermission::Microphone => self.request_microphone(options).await,
            SystemPermission::Camera => self.request_camera(options).await,
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
                    Some("Please enable the permission in system settings".to_string()),
                    Some("System Settings > Privacy".to_string()),
                )
            }
            _ => RequestResult::unsupported(permission),
        }
    }

    async fn open_settings(&self, permission: SystemPermission) -> Result<(), PermissionError> {
        let settings_cmd = match permission {
            SystemPermission::Accessibility => "gnome-control-center accessibility",
            SystemPermission::ScreenRecording => "gnome-control-center privacy",
            SystemPermission::Microphone => "gnome-control-center privacy",
            SystemPermission::Camera => "gnome-control-center privacy",
            SystemPermission::Location => "gnome-control-center privacy",
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite
            | SystemPermission::Clipboard
            | SystemPermission::KeyboardMonitoring
            | SystemPermission::Network => "gnome-control-center privacy",
            _ => return Err(PermissionError::Unsupported { permission: permission.name() }),
        };

        std::process::Command::new("sh")
            .args(&["-c", settings_cmd])
            .spawn()
            .map_err(|e| PermissionError::SettingsOpenFailed {
                reason: e.to_string(),
            })?;

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

/// 检查 AT-SPI 辅助功能权限
fn check_atspi_access() -> bool {
    if let Ok(home) = std::env::var("HOME") {
        let config_path = format!("{}/.config/at-spi2/accessibility.conf", home);
        return std::path::Path::new(&config_path).exists();
    }
    false
}

/// 检查 PipeWire 访问权限
fn check_pipewire_access() -> bool {
    if let Ok(home) = std::env::var("HOME") {
        let pipewire_dir = format!("{}/.config/pipewire", home);
        return std::path::Path::new(&pipewire_dir).exists();
    }
    false
}

/// 检查音频设备访问权限
fn check_audio_device_access() -> bool {
    let snd_path = std::path::Path::new("/dev/snd");
    if snd_path.exists() {
        return std::fs::read_dir(snd_path).is_ok();
    }
    false
}

/// 检查相机设备访问权限
fn check_camera_access() -> bool {
    if let Ok(entries) = std::fs::read_dir("/dev") {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.starts_with("video") {
                    return true;
                }
            }
        }
    }
    false
}

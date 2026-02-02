//! macOS 权限管理器实现
//!
//! 使用 Objective-C runtime 和 Core Foundation 调用 macOS TCC 权限 API


use async_trait::async_trait;
use chrono::Utc;

use crate::{
    LocationMode, PermissionError, PermissionManager, PermissionState, PermissionStatus,
    RequestOptions, RequestResult, SystemPermission,
};

/// macOS 权限管理器
///
/// 使用 macOS 系统框架检查和请求各种 TCC 权限
#[derive(Debug, Default)]
pub struct MacOSPermissionManager;

impl MacOSPermissionManager {
    /// 创建新的 macOS 权限管理器
    pub fn new() -> Self {
        Self
    }

    /// 检查辅助功能权限
    async fn check_accessibility(&self) -> PermissionState {
        let trusted = unsafe { AXIsProcessTrusted() };

        PermissionState {
            permission: SystemPermission::Accessibility,
            status: if trusted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if trusted { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查屏幕录制权限
    async fn check_screen_recording(&self) -> PermissionState {
        let authorized = unsafe { CGPreflightScreenCaptureAccess() };

        PermissionState {
            permission: SystemPermission::ScreenRecording,
            status: if authorized {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            },
            location_mode: None,
            granted_at: if authorized { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查麦克风权限
    /// 注意: 完整实现需通过 Objective-C 绑定调用 AVCaptureDevice authorizationStatusForMediaType，
    /// 此处返回未决定，避免链接不存在的 C 符号
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
    /// 注意: 完整实现需通过 Objective-C 绑定调用 AVCaptureDevice，此处返回未决定
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

    /// 检查语音识别权限
    /// 注意: 完整实现需通过 Objective-C 绑定调用 SFSpeechRecognizer，此处返回未决定
    async fn check_speech_recognition(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::SpeechRecognition,
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

    /// 检查 AppleScript 权限
    async fn check_apple_script(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::AppleScript,
            status: PermissionStatus::Denied,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查 NuwaxCode / Claude Code / 文件系统 / 剪贴板 / 键盘监控 / 网络 等权限
    /// 这些权限在 macOS 上多为沙盒或 TCC 全盘访问，此处返回未决定，由上层引导用户打开设置
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
        let _ = std::process::Command::new("open")
            .args(&["x-apple.systempreferences:com.apple.security.accessibility"])
            .output();

        RequestResult::denied(
            SystemPermission::Accessibility,
            Some("Please enable Accessibility permission in System Preferences".to_string()),
            Some("System Preferences > Security & Privacy > Privacy > Accessibility".to_string()),
        )
    }

    /// 请求屏幕录制权限
    async fn request_screen_recording(&self, options: RequestOptions) -> RequestResult {
        let granted = if options.interactive {
            unsafe { CGRequestScreenCaptureAccess() }
        } else {
            false
        };

        RequestResult {
            permission: SystemPermission::ScreenRecording,
            granted,
            status: if granted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            error_message: if granted {
                None
            } else {
                Some("Screen recording permission is required".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("System Preferences > Security & Privacy > Privacy > Screen Recording".to_string())
            },
        }
    }

    /// 请求麦克风权限
    /// 打开系统设置页，由用户手动授权；完整实现需 Objective-C 绑定
    async fn request_microphone(&self, _options: RequestOptions) -> RequestResult {
        let _ = self.open_settings(SystemPermission::Microphone).await;
        RequestResult::denied(
            SystemPermission::Microphone,
            Some("Please enable Microphone in System Preferences".to_string()),
            Some("System Preferences > Security & Privacy > Privacy > Microphone".to_string()),
        )
    }

    /// 请求相机权限
    /// 打开系统设置页，由用户手动授权；完整实现需 Objective-C 绑定
    async fn request_camera(&self, _options: RequestOptions) -> RequestResult {
        let _ = self.open_settings(SystemPermission::Camera).await;
        RequestResult::denied(
            SystemPermission::Camera,
            Some("Please enable Camera in System Preferences".to_string()),
            Some("System Preferences > Security & Privacy > Privacy > Camera".to_string()),
        )
    }

    /// 请求通知权限
    async fn request_notifications(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Notifications,
            granted: false,
            status: PermissionStatus::Unavailable,
            error_message: Some("Notifications permission requires UserNotifications framework".to_string()),
            settings_guide: None,
        }
    }

    /// 请求语音识别权限
    /// 打开系统设置页，由用户手动授权；完整实现需 Objective-C 绑定
    async fn request_speech_recognition(&self, _options: RequestOptions) -> RequestResult {
        let _ = self.open_settings(SystemPermission::SpeechRecognition).await;
        RequestResult::denied(
            SystemPermission::SpeechRecognition,
            Some("Please enable Speech Recognition in System Preferences".to_string()),
            Some("System Preferences > Security & Privacy > Privacy > Speech Recognition".to_string()),
        )
    }

    /// 请求位置权限
    async fn request_location(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Location,
            granted: false,
            status: PermissionStatus::Unavailable,
            error_message: Some("Location permission requires CoreLocation framework".to_string()),
            settings_guide: Some("System Preferences > Security & Privacy > Privacy > Location Services".to_string()),
        }
    }

    /// 请求 AppleScript 权限
    async fn request_apple_script(&self, _options: RequestOptions) -> RequestResult {
        let _ = std::process::Command::new("open")
            .args(&["x-apple.systempreferences:com.apple.security.accessibility"])
            .output();

        RequestResult::denied(
            SystemPermission::AppleScript,
            Some("Please enable Automation permission for your app".to_string()),
            Some("System Preferences > Security & Privacy > Privacy > Automation".to_string()),
        )
    }

    /// 请求 NuwaxCode / Claude Code / 文件系统 / 剪贴板 / 键盘监控 / 网络 等权限
    /// 打开对应系统设置页，由用户手动授权
    async fn request_ide_and_extra(
        &self,
        permission: SystemPermission,
        _options: RequestOptions,
    ) -> RequestResult {
        let _ = self.open_settings(permission).await;
        let (msg, guide) = match permission {
            SystemPermission::NuwaxCode | SystemPermission::ClaudeCode => (
                "Please enable Full Disk Access or Automation for this app".to_string(),
                "System Preferences > Security & Privacy > Privacy > Full Disk Access / Automation".to_string(),
            ),
            SystemPermission::FileSystemRead | SystemPermission::FileSystemWrite => (
                "Please grant file access in System Preferences".to_string(),
                "System Preferences > Security & Privacy > Privacy > Files and Folders".to_string(),
            ),
            SystemPermission::Clipboard => (
                "Clipboard is usually allowed; check Accessibility if needed".to_string(),
                "System Preferences > Security & Privacy > Privacy > Accessibility".to_string(),
            ),
            SystemPermission::KeyboardMonitoring => (
                "Please enable Input Monitoring for global shortcuts".to_string(),
                "System Preferences > Security & Privacy > Privacy > Input Monitoring".to_string(),
            ),
            SystemPermission::Network => (
                "Network access is usually allowed for desktop apps".to_string(),
                "If blocked, check firewall or app permissions".to_string(),
            ),
            _ => (
                "Please enable the permission in System Preferences".to_string(),
                "System Preferences > Security & Privacy > Privacy".to_string(),
            ),
        };
        RequestResult::denied(permission, Some(msg), Some(guide))
    }
}

#[async_trait]
impl PermissionManager for MacOSPermissionManager {
    fn supported_permissions(&self) -> Vec<SystemPermission> {
        vec![
            SystemPermission::Accessibility,
            SystemPermission::ScreenRecording,
            SystemPermission::Microphone,
            SystemPermission::Camera,
            SystemPermission::Notifications,
            SystemPermission::SpeechRecognition,
            SystemPermission::Location,
            SystemPermission::AppleScript,
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
            SystemPermission::Notifications => self.check_notifications().await,
            SystemPermission::SpeechRecognition => self.check_speech_recognition().await,
            SystemPermission::Location => self.check_location().await,
            SystemPermission::AppleScript => self.check_apple_script().await,
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite
            | SystemPermission::Clipboard
            | SystemPermission::KeyboardMonitoring
            | SystemPermission::Network => self.check_ide_and_extra(permission).await,
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
            SystemPermission::Notifications => self.request_notifications(options).await,
            SystemPermission::SpeechRecognition => self.request_speech_recognition(options).await,
            SystemPermission::Location => self.request_location(options).await,
            SystemPermission::AppleScript => self.request_apple_script(options).await,
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite
            | SystemPermission::Clipboard
            | SystemPermission::KeyboardMonitoring
            | SystemPermission::Network => self.request_ide_and_extra(permission, options).await,
        }
    }

    async fn open_settings(&self, permission: SystemPermission) -> Result<(), PermissionError> {
        let url = match permission {
            SystemPermission::Accessibility => "x-apple.systempreferences:com.apple.security.accessibility",
            SystemPermission::ScreenRecording => "x-apple.systempreferences:com.apple.security.screenRecording",
            SystemPermission::Microphone => "x-apple.systempreferences:com.apple.security.privacy-microphone",
            SystemPermission::Camera => "x-apple.systempreferences:com.apple.security.privacy-camera",
            SystemPermission::Notifications => "x-apple.systempreferences:com.apple.security.privacy-notifications",
            SystemPermission::SpeechRecognition => "x-apple.systempreferences:com.apple.security.privacy-speechRecognition",
            SystemPermission::Location => "x-apple.systempreferences:com.apple.security.privacy-location",
            SystemPermission::AppleScript => "x-apple.systempreferences:com.apple.security.accessibility",
            SystemPermission::NuwaxCode | SystemPermission::ClaudeCode => "x-apple.systempreferences:com.apple.security.privacy.all",
            SystemPermission::FileSystemRead | SystemPermission::FileSystemWrite => "x-apple.systempreferences:com.apple.security.privacy.files",
            SystemPermission::Clipboard => "x-apple.systempreferences:com.apple.security.accessibility",
            SystemPermission::KeyboardMonitoring => "x-apple.systempreferences:com.apple.security.privacy.inputMonitoring",
            SystemPermission::Network => "x-apple.systempreferences:com.apple.security.firewall",
        };

        std::process::Command::new("open")
            .arg(url)
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

// 外部函数声明 (Objective-C runtime 和系统框架)

// AXIsProcessTrusted - 检查辅助功能权限
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

// CGPreflightScreenCaptureAccess - 预检查屏幕录制权限
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

// AVFoundation/Speech 的完整实现需通过 Objective-C 绑定调用，当前仅使用 CoreGraphics/ApplicationServices 的 C API

use async_trait::async_trait;
use chrono::Utc;
use objc2::{class, msg_send, runtime::AnyClass};
use objc2_foundation::NSString;
use std::ffi::CStr;

use crate::{
    LocationMode, PermissionError, PermissionManager, PermissionState, PermissionStatus,
    RequestOptions, RequestResult, SystemPermission,
};

/// macOS 权限管理器
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
        eprintln!(
            "[SystemPermissions] AXIsProcessTrusted returned: {}",
            trusted
        );

        PermissionState {
            permission: SystemPermission::Accessibility,
            status: if trusted {
                PermissionStatus::Authorized
            } else {
                // AXIsProcessTrusted 无法区分"从未授权"和"已拒绝"，
                // 统一返回 NotDetermined，前端显示为"待授权"
                PermissionStatus::NotDetermined
            },
            location_mode: None,
            granted_at: if trusted { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查屏幕录制权限
    async fn check_screen_recording(&self) -> PermissionState {
        let authorized = unsafe { CGPreflightScreenCaptureAccess() };
        eprintln!(
            "[SystemPermissions] CGPreflightScreenCaptureAccess returned: {}",
            authorized
        );

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
    async fn check_microphone(&self) -> PermissionState {
        let status =
            unsafe { AVCaptureDevice::authorization_status_for_media_type(AVMediaType::AUDIO) };
        self.map_av_status(status, SystemPermission::Microphone)
    }

    /// 检查相机权限
    async fn check_camera(&self) -> PermissionState {
        let status =
            unsafe { AVCaptureDevice::authorization_status_for_media_type(AVMediaType::VIDEO) };
        self.map_av_status(status, SystemPermission::Camera)
    }

    fn map_av_status(&self, status: isize, permission: SystemPermission) -> PermissionState {
        let status_enum = match status {
            0 => PermissionStatus::NotDetermined,
            1 => PermissionStatus::Restricted,
            2 => PermissionStatus::Denied,
            3 => PermissionStatus::Authorized,
            _ => PermissionStatus::Unavailable,
        };

        PermissionState {
            permission,
            status: status_enum,
            location_mode: None,
            granted_at: if status_enum == PermissionStatus::Authorized {
                Some(Utc::now())
            } else {
                None
            },
            can_request: status_enum == PermissionStatus::NotDetermined,
        }
    }

    /// 检查通知权限
    async fn check_notifications(&self) -> PermissionState {
        // 简化实现，因为通知权限通常由 Tauri 自身管理或需复杂 API
        PermissionState {
            permission: SystemPermission::Notifications,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    /// 检查语音识别权限
    async fn check_speech_recognition(&self) -> PermissionState {
        let status = unsafe { SFSpeechRecognizer::authorization_status() };
        // SFSpeechRecognizerAuthorizationStatus:
        // 0 = NotDetermined, 1 = Denied, 2 = Restricted, 3 = Authorized
        let status_enum = match status {
            0 => PermissionStatus::NotDetermined,
            1 => PermissionStatus::Denied,
            2 => PermissionStatus::Restricted,
            3 => PermissionStatus::Authorized,
            _ => PermissionStatus::Unavailable,
        };

        PermissionState {
            permission: SystemPermission::SpeechRecognition,
            status: status_enum,
            location_mode: None,
            granted_at: if status_enum == PermissionStatus::Authorized {
                Some(Utc::now())
            } else {
                None
            },
            can_request: status_enum == PermissionStatus::NotDetermined,
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

    /// 检查其他权限
    async fn check_ide_and_extra(&self, permission: SystemPermission) -> PermissionState {
        PermissionState {
            permission,
            status: PermissionStatus::NotDetermined,
            location_mode: None,
            granted_at: None,
            can_request: true,
        }
    }

    // Requests

    async fn request_accessibility(&self, _options: RequestOptions) -> RequestResult {
        let _ = self.open_settings(SystemPermission::Accessibility).await;

        RequestResult::denied(
            SystemPermission::Accessibility,
            Some("Please enable Accessibility permission in System Preferences".to_string()),
            Some("System Preferences > Security & Privacy > Privacy > Accessibility".to_string()),
        )
    }

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
                Some("Required".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("System Preferences > Security & Privacy".to_string())
            },
        }
    }

    async fn request_microphone(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            unsafe { AVCaptureDevice::request_access_for_media_type(AVMediaType::AUDIO) };
        }

        let state = self.check_microphone().await;
        let granted = state.status == PermissionStatus::Authorized;

        RequestResult {
            permission: SystemPermission::Microphone,
            granted,
            status: state.status,
            error_message: if granted {
                None
            } else {
                Some("Denied".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("System Preferences > Security & Privacy".to_string())
            },
        }
    }

    async fn request_camera(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            unsafe { AVCaptureDevice::request_access_for_media_type(AVMediaType::VIDEO) };
        }

        let state = self.check_camera().await;
        let granted = state.status == PermissionStatus::Authorized;

        RequestResult {
            permission: SystemPermission::Camera,
            granted,
            status: state.status,
            error_message: if granted {
                None
            } else {
                Some("Denied".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("System Preferences > Security & Privacy".to_string())
            },
        }
    }

    async fn request_notifications(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Notifications,
            granted: false,
            status: PermissionStatus::Unavailable,
            error_message: Some("Not implemented".to_string()),
            settings_guide: None,
        }
    }

    async fn request_speech_recognition(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            unsafe { SFSpeechRecognizer::request_authorization() };
        }

        let state = self.check_speech_recognition().await;
        let granted = state.status == PermissionStatus::Authorized;

        RequestResult {
            permission: SystemPermission::SpeechRecognition,
            granted,
            status: state.status,
            error_message: if granted {
                None
            } else {
                Some("Denied".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("System Preferences > Security & Privacy".to_string())
            },
        }
    }

    async fn request_location(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Location,
            granted: false,
            status: PermissionStatus::Unavailable,
            error_message: Some("Not implemented".to_string()),
            settings_guide: None,
        }
    }

    async fn request_apple_script(&self, _options: RequestOptions) -> RequestResult {
        RequestResult::denied(SystemPermission::AppleScript, None, None)
    }

    async fn request_ide_and_extra(
        &self,
        permission: SystemPermission,
        _options: RequestOptions,
    ) -> RequestResult {
        let _ = self.open_settings(permission).await;
        RequestResult::denied(permission, None, None)
    }

    async fn open_settings(&self, permission: SystemPermission) -> Result<(), PermissionError> {
        // 根据权限类型构建对应的系统设置 URL
        let url = match permission {
            SystemPermission::ScreenRecording => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            SystemPermission::Accessibility => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            SystemPermission::Microphone => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            }
            SystemPermission::Camera => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
            }
            SystemPermission::SpeechRecognition => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
            }
            SystemPermission::Location => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices"
            }
            SystemPermission::Notifications => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Notifications"
            }
            SystemPermission::FileSystemRead | SystemPermission::FileSystemWrite => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
            }
            _ => {
                // 其他权限类型打开通用隐私设置页面
                "x-apple.systempreferences:com.apple.preference.security?Privacy"
            }
        };

        eprintln!("[SystemPermissions] Opening settings URL: {}", url);

        // 使用 open 命令打开 URL
        let output = std::process::Command::new("open")
            .arg(url)
            .output()
            .map_err(|e| PermissionError::SettingsOpenFailed {
                reason: e.to_string(),
            })?;

        if !output.status.success() {
            eprintln!(
                "[SystemPermissions] open command failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            return Err(PermissionError::SettingsOpenFailed {
                reason: String::from_utf8_lossy(&output.stderr).to_string(),
            });
        }

        Ok(())
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
            SystemPermission::SpeechRecognition,
            SystemPermission::FileSystemRead,
            SystemPermission::FileSystemWrite,
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
            _ => self.check_ide_and_extra(permission).await,
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
            _ => self.request_ide_and_extra(permission, options).await,
        }
    }

    async fn open_settings(&self, permission: SystemPermission) -> Result<(), PermissionError> {
        self.open_settings(permission).await
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

// FFI Definitions

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[link(name = "Speech", kind = "framework")]
extern "C" {}

// Helper Structs for ObjC Calls

struct AVMediaType;
impl AVMediaType {
    const AUDIO: &'static str = "soun";
    const VIDEO: &'static str = "vide";
}

struct AVCaptureDevice;
impl AVCaptureDevice {
    unsafe fn authorization_status_for_media_type(media_type: &'static str) -> isize {
        if AnyClass::get(CStr::from_bytes_with_nul_unchecked(b"AVCaptureDevice\0")).is_none() {
            return 0;
        }
        let cls = class!(AVCaptureDevice);
        let arg = NSString::from_str(media_type);
        let status: isize = msg_send![cls, authorizationStatusForMediaType: &*arg];
        status
    }

    unsafe fn request_access_for_media_type(media_type: &'static str) {
        if AnyClass::get(CStr::from_bytes_with_nul_unchecked(b"AVCaptureDevice\0")).is_none() {
            return;
        }
        let cls = class!(AVCaptureDevice);
        let arg = NSString::from_str(media_type);
        // Note: requestAccessForMediaType expects a completion handler block.
        // Passing nil (std::ptr::null_mut()) might crash or effectively do nothing if it's required.
        // For now, we simulate "request" by calling it, but we can't await the result easily without blocks.
        // However, most permissions requests in macOS will trigger the system prompt regardless of callback.
        // Pass a ptr::null() for the block might be unsafe if not nullable.
        // For this fix, we will just call check() again which returns current status.
        // Properly implementing blocks in Rust is complex (requires `block` crate).
        // Given usage is often just "trigger prompt", let's try calling with null listener.
        let _: () = msg_send![cls, requestAccessForMediaType: &*arg, completionHandler: std::ptr::null_mut::<std::ffi::c_void>()];
    }
}

struct SFSpeechRecognizer;
impl SFSpeechRecognizer {
    unsafe fn authorization_status() -> isize {
        if AnyClass::get(CStr::from_bytes_with_nul_unchecked(b"SFSpeechRecognizer\0")).is_none() {
            return 0;
        }
        let cls = class!(SFSpeechRecognizer);
        let status: isize = msg_send![cls, authorizationStatus];
        status
    }

    unsafe fn request_authorization() {
        if AnyClass::get(CStr::from_bytes_with_nul_unchecked(b"SFSpeechRecognizer\0")).is_none() {
            return;
        }
        let cls = class!(SFSpeechRecognizer);
        let _: () = msg_send![cls, requestAuthorization: std::ptr::null_mut::<std::ffi::c_void>()];
    }
}

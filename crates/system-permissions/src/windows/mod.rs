//! Windows 权限管理器实现
//!
//! 使用 Windows API 检查和请求各种系统权限

use async_trait::async_trait;
use chrono::Utc;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows 下隐藏控制台窗口的标志
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_family = "windows")]
use windows::Win32::{
    Foundation::HANDLE,
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

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

    /// 检查管理员权限 (UAC)
    async fn check_admin(&self) -> PermissionState {
        let is_admin = check_is_admin();

        PermissionState {
            permission: SystemPermission::Accessibility,
            status: if is_admin {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if is_admin { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查麦克风权限
    async fn check_microphone(&self) -> PermissionState {
        let allowed = check_privacy_setting("microphone");

        PermissionState {
            permission: SystemPermission::Microphone,
            status: if allowed {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if allowed { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查相机权限
    async fn check_camera(&self) -> PermissionState {
        let allowed = check_privacy_setting("camera");

        PermissionState {
            permission: SystemPermission::Camera,
            status: if allowed {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: None,
            granted_at: if allowed { Some(Utc::now()) } else { None },
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
        let allowed = check_privacy_setting("location");

        PermissionState {
            permission: SystemPermission::Location,
            status: if allowed {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: if allowed {
                Some(LocationMode::WhileUsing)
            } else {
                Some(LocationMode::Off)
            },
            granted_at: if allowed { Some(Utc::now()) } else { None },
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

    /// 检查剪贴板权限
    async fn check_clipboard(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Clipboard,
            status: PermissionStatus::Authorized,
            location_mode: None,
            granted_at: Some(Utc::now()),
            can_request: false,
        }
    }

    /// 检查 NuwaxCode / Claude Code / 文件系统 / 键盘监控 / 网络 等权限
    async fn check_ide_and_extra(&self, permission: SystemPermission) -> PermissionState {
        match permission {
            SystemPermission::Network => PermissionState {
                permission,
                status: PermissionStatus::Authorized,
                location_mode: None,
                granted_at: Some(Utc::now()),
                can_request: false,
            },
            SystemPermission::FileSystemRead | SystemPermission::FileSystemWrite => {
                PermissionState {
                    permission,
                    status: PermissionStatus::NotDetermined,
                    location_mode: None,
                    granted_at: None,
                    can_request: true,
                }
            }
            SystemPermission::KeyboardMonitoring => PermissionState {
                permission,
                status: PermissionStatus::NotDetermined,
                location_mode: None,
                granted_at: None,
                can_request: true,
            },
            _ => PermissionState {
                permission,
                status: PermissionStatus::NotDetermined,
                location_mode: None,
                granted_at: None,
                can_request: true,
            },
        }
    }

    /// 请求管理员权限
    async fn request_admin(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            // 尝试以管理员身份重新运行
            #[cfg(target_os = "windows")]
            let _ = Command::new("powershell")
                .creation_flags(CREATE_NO_WINDOW)
                .args(&[
                    "-Command",
                    "Start-Process -FilePath '$env:ComSpec' -ArgumentList '/c','echo Admin rights required' -Verb RunAs",
                ])
                .spawn();
            #[cfg(not(target_os = "windows"))]
            let _ = Command::new("powershell")
                .args(&[
                    "-Command",
                    "Start-Process -FilePath '$env:ComSpec' -ArgumentList '/c','echo Admin rights required' -Verb RunAs",
                ])
                .spawn();
        }

        RequestResult {
            permission: SystemPermission::Accessibility,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Requires administrator privileges".to_string()),
            settings_guide: Some("Right-click and select 'Run as administrator'".to_string()),
        }
    }

    /// 请求麦克风权限
    async fn request_microphone(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            open_privacy_settings("microphone");
        }

        let granted = check_privacy_setting("microphone");

        RequestResult {
            permission: SystemPermission::Microphone,
            granted,
            status: if granted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            error_message: if granted {
                None
            } else {
                Some("Please enable microphone access in Windows Settings".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("Settings > Privacy > Microphone".to_string())
            },
        }
    }

    /// 请求相机权限
    async fn request_camera(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            open_privacy_settings("camera");
        }

        let granted = check_privacy_setting("camera");

        RequestResult {
            permission: SystemPermission::Camera,
            granted,
            status: if granted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            error_message: if granted {
                None
            } else {
                Some("Please enable camera access in Windows Settings".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("Settings > Privacy > Camera".to_string())
            },
        }
    }

    /// 请求通知权限
    async fn request_notifications(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            open_privacy_settings("notifications");
        }

        RequestResult {
            permission: SystemPermission::Notifications,
            granted: false,
            status: PermissionStatus::NotDetermined,
            error_message: Some("Please enable notifications in Windows Settings".to_string()),
            settings_guide: Some("Settings > System > Notifications".to_string()),
        }
    }

    /// 请求位置权限
    async fn request_location(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            open_privacy_settings("location");
        }

        let granted = check_privacy_setting("location");

        RequestResult {
            permission: SystemPermission::Location,
            granted,
            status: if granted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            error_message: if granted {
                None
            } else {
                Some("Please enable location access in Windows Settings".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("Settings > Privacy > Location".to_string())
            },
        }
    }

    /// 请求屏幕录制权限
    async fn request_screen_recording(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            open_privacy_settings("graphics");
        }

        RequestResult {
            permission: SystemPermission::ScreenRecording,
            granted: false,
            status: PermissionStatus::NotDetermined,
            error_message: Some("Screen recording requires graphics settings".to_string()),
            settings_guide: Some("Settings > Privacy > Graphics".to_string()),
        }
    }

    /// 请求剪贴板权限
    async fn request_clipboard(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Clipboard,
            granted: true,
            status: PermissionStatus::Authorized,
            error_message: None,
            settings_guide: None,
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
            SystemPermission::Clipboard,
            SystemPermission::NuwaxCode,
            SystemPermission::ClaudeCode,
            SystemPermission::FileSystemRead,
            SystemPermission::FileSystemWrite,
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
            SystemPermission::Clipboard => self.check_clipboard().await,
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite
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
            SystemPermission::ScreenRecording => self.request_screen_recording(options).await,
            SystemPermission::Microphone => self.request_microphone(options).await,
            SystemPermission::Camera => self.request_camera(options).await,
            SystemPermission::Notifications => self.request_notifications(options).await,
            SystemPermission::Location => self.request_location(options).await,
            SystemPermission::Clipboard => self.request_clipboard(options).await,
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite
            | SystemPermission::KeyboardMonitoring
            | SystemPermission::Network => {
                if options.interactive {
                    let _ = self.open_settings(permission).await;
                }
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
            SystemPermission::Clipboard | SystemPermission::KeyboardMonitoring => {
                "privacy-accessibility"
            }
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite => "privacy-apps",
            SystemPermission::Network => "privacy-apps",
            _ => {
                return Err(PermissionError::Unsupported {
                    permission: permission.name(),
                })
            }
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

/// 检查 Windows 隐私设置
fn check_privacy_setting(category: &str) -> bool {
    // 读取注册表检查隐私设置
    // HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore

    let key_path = format!(
        r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{}",
        category
    );

    // 检查 Value 字段（使用 winreg crate 读取注册表，参考 RustDesk）
    #[cfg(target_family = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(subkey) = hkcu.open_subkey_with_flags(&key_path, KEY_READ) {
            if let Ok(value) = subkey.get_value::<String, _>("Value") {
                return value == "Allow";
            }
        }
    }

    // 如果读取失败，保守返回 false
    false
}

/// 打开 Windows 隐私设置页面
fn open_privacy_settings(category: &str) {
    #[cfg(target_os = "windows")]
    let _ = Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args(&["/c", &format!("start ms-settings:{}", category)])
        .spawn();
    #[cfg(not(target_os = "windows"))]
    let _ = Command::new("cmd")
        .args(&["/c", &format!("start ms-settings:{}", category)])
        .spawn();
}

// Windows API 辅助函数

/// 获取进程令牌信息
#[cfg(target_family = "windows")]
fn get_process_elevated() -> bool {
    unsafe {
        let mut token_handle: HANDLE = HANDLE::default();

        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle).is_err() {
            return false;
        }

        let mut elevation = TOKEN_ELEVATION::default();
        let mut return_length: u32 = std::mem::size_of::<TOKEN_ELEVATION>() as u32;

        if GetTokenInformation(
            token_handle,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut std::ffi::c_void),
            return_length,
            &mut return_length,
        )
        .is_err()
        {
            return false;
        }

        elevation.TokenIsElevated != 0
    }
}

#[cfg(not(target_family = "windows"))]
fn get_process_elevated() -> bool {
    false
}

/// 检查当前用户是否是管理员
#[cfg(target_family = "windows")]
fn check_is_admin() -> bool {
    get_process_elevated()
}

#[cfg(not(target_family = "windows"))]
fn check_is_admin() -> bool {
    false
}

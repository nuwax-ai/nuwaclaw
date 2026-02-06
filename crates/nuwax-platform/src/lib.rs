//! 跨平台抽象层
//!
//! 提供统一的平台能力抽象：路径、自动启动、托盘等
//! 通过 trait 和 platform-specific 实现支持 macOS/Windows/Linux

use thiserror::Error;

pub mod paths;
pub mod autostart;

#[cfg(feature = "tray")]
pub mod tray;

pub mod config;
// pub mod permissions; // 权限模块请使用 system-permissions crate

/// 平台类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    MacOS,
    Windows,
    Linux,
}

/// 获取当前运行平台
#[inline]
pub fn current_platform() -> Platform {
    #[cfg(target_os = "macos")]
    return Platform::MacOS;

    #[cfg(target_os = "windows")]
    return Platform::Windows;

    #[cfg(target_os = "linux")]
    return Platform::Linux;
}

/// 平台特性 trait - 所有平台模块的基础
pub trait PlatformModule {
    /// 模块名称
    fn name(&self) -> &'static str;

    /// 检查是否可用
    fn is_available(&self) -> bool;

    /// 初始化模块
    fn initialize(&self) -> Result<(), Error> {
        Ok(())
    }
}

/// 统一错误类型
#[derive(Error, Debug)]
pub enum Error {
    #[error("Platform error: {0}")]
    Platform(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),
}

// ============ 平台能力检测 ============

/// 平台能力枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformCapability {
    /// 系统托盘
    Tray,
    /// 开机自启动
    AutoStart,
    /// 后台服务
    BackgroundServices,
    /// 桌面环境
    DesktopEnvironment,
    /// 辅助功能权限
    AccessibilityPermissions,
    /// 屏幕录制权限
    ScreenRecordingPermissions,
}

/// 平台能力检测结果
#[derive(Debug, Clone)]
pub struct CapabilityStatus {
    /// 能力类型
    pub capability: PlatformCapability,
    /// 是否可用
    pub available: bool,
    /// 详细信息
    pub message: String,
}

/// 检查平台是否支持指定能力
///
/// # Arguments
///
/// * `capability` - 要检查的能力类型
///
/// # Returns
///
/// 能力可用性状态
#[inline]
pub fn check_capability(capability: PlatformCapability) -> CapabilityStatus {
    match capability {
        PlatformCapability::Tray => check_tray_available(),
        PlatformCapability::AutoStart => check_autostart_available(),
        PlatformCapability::BackgroundServices => check_background_services_available(),
        PlatformCapability::DesktopEnvironment => check_desktop_environment_available(),
        PlatformCapability::AccessibilityPermissions => check_accessibility_permissions(),
        PlatformCapability::ScreenRecordingPermissions => check_screen_recording_permissions(),
    }
}

/// 检查托盘是否可用
#[inline]
pub fn check_tray_available() -> CapabilityStatus {
    #[cfg(target_os = "linux")]
    {
        let display = std::env::var("DISPLAY").ok();
        let wayland = std::env::var("WAYLAND_DISPLAY").ok();

        if display.is_none() && wayland.is_none() {
            CapabilityStatus {
                capability: PlatformCapability::Tray,
                available: false,
                message: "No display server (DISPLAY or WAYLAND_DISPLAY not set)".to_string(),
            }
        } else {
            CapabilityStatus {
                capability: PlatformCapability::Tray,
                available: true,
                message: if wayland.is_some() {
                    "Wayland desktop environment detected".to_string()
                } else {
                    "X11 desktop environment detected".to_string()
                },
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        CapabilityStatus {
            capability: PlatformCapability::Tray,
            available: true,
            message: format!("{:?} platform fully supports tray", current_platform()),
        }
    }
}

/// 检查自动启动是否可用
#[inline]
pub fn check_autostart_available() -> CapabilityStatus {
    #[cfg(target_os = "linux")]
    {
        // 检查 systemd 或 xdg-autostart 是否可用
        let systemd_available = std::process::Command::new("systemctl")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if systemd_available {
            CapabilityStatus {
                capability: PlatformCapability::AutoStart,
                available: true,
                message: "systemd user service available".to_string(),
            }
        } else {
            CapabilityStatus {
                capability: PlatformCapability::AutoStart,
                available: true,
                message: "xdg-autostart fallback available".to_string(),
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        CapabilityStatus {
            capability: PlatformCapability::AutoStart,
            available: true,
            message: format!("{:?} platform supports auto-start", current_platform()),
        }
    }
}

/// 检查后台服务是否可用
#[inline]
pub fn check_background_services_available() -> CapabilityStatus {
    #[cfg(target_os = "linux")]
    {
        let systemd_available = std::process::Command::new("systemctl")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        CapabilityStatus {
            capability: PlatformCapability::BackgroundServices,
            available: systemd_available,
            message: if systemd_available {
                "systemd user services available".to_string()
            } else {
                "Limited background service support".to_string()
            },
        }
    }

    #[cfg(target_os = "macos")]
    {
        CapabilityStatus {
            capability: PlatformCapability::BackgroundServices,
            available: true,
            message: "macOS launchd available".to_string(),
        }
    }

    #[cfg(target_os = "windows")]
    {
        CapabilityStatus {
            capability: PlatformCapability::BackgroundServices,
            available: true,
            message: "Windows service available".to_string(),
        }
    }
}

/// 检查桌面环境
#[inline]
pub fn check_desktop_environment_available() -> CapabilityStatus {
    #[cfg(target_os = "linux")]
    {
        let desktop_session = std::env::var("DESKTOP_SESSION").ok();
        let xdg_current_desktop = std::env::var("XDG_CURRENT_DESKTOP").ok();

        let de_info = desktop_session.or(xdg_current_desktop)
            .unwrap_or_else(|| "Unknown".to_string());

        CapabilityStatus {
            capability: PlatformCapability::DesktopEnvironment,
            available: true,
            message: format!("Desktop environment: {}", de_info),
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        CapabilityStatus {
            capability: PlatformCapability::DesktopEnvironment,
            available: true,
            message: format!("{:?} native desktop", current_platform()),
        }
    }
}

/// 检查辅助功能权限状态
#[inline]
pub fn check_accessibility_permissions() -> CapabilityStatus {
    #[cfg(target_os = "macos")]
    {
        // macOS 可以检查辅助功能权限
        use std::process::Command;

        // 尝试访问系统偏好设置
        let result = Command::new("osascript")
            .args(&["-e", "tell application \"System Events\" to get name of every process"])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                CapabilityStatus {
                    capability: PlatformCapability::AccessibilityPermissions,
                    available: true,
                    message: "Accessibility permissions may be granted".to_string(),
                }
            }
            _ => {
                CapabilityStatus {
                    capability: PlatformCapability::AccessibilityPermissions,
                    available: false,
                    message: "Accessibility permissions not granted or denied".to_string(),
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows UAC 检查
        let is_admin = is_user_admin();

        CapabilityStatus {
            capability: PlatformCapability::AccessibilityPermissions,
            available: !is_admin, // 非管理员用户需要 UAC 提升
            message: if is_admin {
                "Running with administrator privileges".to_string()
            } else {
                "Standard user permissions".to_string()
            },
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux 通常不需要辅助功能权限
        CapabilityStatus {
            capability: PlatformCapability::AccessibilityPermissions,
            available: true,
            message: "Linux does not require accessibility permissions".to_string(),
        }
    }
}

/// 检查屏幕录制权限状态
#[inline]
pub fn check_screen_recording_permissions() -> CapabilityStatus {
    #[cfg(target_os = "macos")]
    {
        // macOS 12+ 可以使用 TCC 工具检查
        use std::process::Command;

        let result = Command::new("sqlite3")
            .args(&[
                "/Library/Application Support/com.apple.TCC/TCC.db",
                "SELECT auth_value FROM access WHERE client='nuwax-agent' AND service='kTCCServiceScreenCapture'"
            ])
            .output();

        match result {
            Ok(output) => {
                let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let (available, message) = match status.as_str() {
                    "2" | "allowed" => (true, "Screen recording permission granted"),
                    "0" | "denied" => (false, "Screen recording permission denied"),
                    "1" | "unknown" => (true, "Screen recording permission unknown (may prompt)"),
                    _ => (true, "Screen recording permission status unclear"),
                };

                CapabilityStatus {
                    capability: PlatformCapability::ScreenRecordingPermissions,
                    available,
                    message: message.to_string(),
                }
            }
            Err(_) => {
                CapabilityStatus {
                    capability: PlatformCapability::ScreenRecordingPermissions,
                    available: true,
                    message: "Unable to check screen recording permissions".to_string(),
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows 屏幕录制不需要特殊权限（但应用需要窗口可见）
        CapabilityStatus {
            capability: PlatformCapability::ScreenRecordingPermissions,
            available: true,
            message: "Windows does not require screen recording permissions".to_string(),
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux Wayland 可能需要权限
        let wayland_display = std::env::var("WAYLAND_DISPLAY").ok();

        CapabilityStatus {
            capability: PlatformCapability::ScreenRecordingPermissions,
            available: wayland_display.is_none() || true, // X11 不需要权限，Wayland 可能有额外限制
            message: if wayland_display.is_some() {
                "Wayland may require additional permissions for screen capture".to_string()
            } else {
                "X11 screen capture available".to_string()
            },
        }
    }
}

/// 检查当前用户是否是管理员（Windows）
#[cfg(target_os = "windows")]
fn is_user_admin() -> bool {
    use windows_sys::Win32::Security::WinBuiltin;
    use windows_sys::Win32::System::Threading;

    unsafe {
        let mut token_handle: windows_sys::Win32::System::Threading::HANDLE = std::mem::zeroed();
        if windows_sys::Win32::Security::WinBuiltin::OpenProcessToken(
            windows_sys::Win32::System::Threading::GetCurrentProcess(),
            windows_sys::Win32::Security::WinBuiltin::TOKEN_READ | windows_sys::Win32::Security::WinBuiltin::TOKEN_QUERY,
            &mut token_handle,
        ) != 0
        {
            let mut token_information: windows_sys::Win32::Security::WinBuiltin::TOKEN_ELEVATION = unsafe { std::mem::zeroed() };
            let mut return_length: u32 = 0;

            let result = windows_sys::Win32::Security::WinBuiltin::GetTokenInformation(
                token_handle,
                windows_sys::Win32::Security::WinBuiltin::TokenElevation,
                &mut token_information as *mut _ as *mut std::ffi::c_void,
                std::mem::size_of::<windows_sys::Win32::Security::WinBuiltin::TOKEN_ELEVATION>() as u32,
                &mut return_length,
            );

            windows_sys::Win32::System::Threading::CloseHandle(token_handle);

            result != 0 && token_information.TokenIsElevated != 0
        } else {
            false
        }
    }
}

/// 获取所有平台能力的当前状态
#[inline]
pub fn get_all_capabilities() -> Vec<CapabilityStatus> {
    vec![
        check_tray_available(),
        check_autostart_available(),
        check_background_services_available(),
        check_desktop_environment_available(),
        check_accessibility_permissions(),
        check_screen_recording_permissions(),
    ]
}


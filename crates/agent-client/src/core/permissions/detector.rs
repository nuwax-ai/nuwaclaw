//! 平台特定的权限检测

use super::{PermissionError, PermissionInfo, PermissionStatus, PermissionType};

/// 检查单个权限
pub fn check_permission(permission_type: PermissionType) -> PermissionInfo {
    let (status, instructions) = detect_platform_permission(permission_type);

    PermissionInfo {
        permission_type,
        status,
        description: permission_type.description().to_string(),
        grant_instructions: instructions,
    }
}

/// 打开系统权限设置
pub fn open_permission_settings(permission_type: PermissionType) -> Result<(), PermissionError> {
    #[cfg(target_os = "macos")]
    {
        open_macos_settings(permission_type)
    }

    #[cfg(target_os = "windows")]
    {
        open_windows_settings(permission_type)
    }

    #[cfg(target_os = "linux")]
    {
        let _ = permission_type;
        // Linux 通常不需要特别的权限设置 UI
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = permission_type;
        Err(PermissionError::UnsupportedPlatform)
    }
}

/// 检测平台权限
fn detect_platform_permission(permission_type: PermissionType) -> (PermissionStatus, Option<String>) {
    #[cfg(target_os = "macos")]
    {
        detect_macos_permission(permission_type)
    }

    #[cfg(target_os = "windows")]
    {
        detect_windows_permission(permission_type)
    }

    #[cfg(target_os = "linux")]
    {
        detect_linux_permission(permission_type)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = permission_type;
        (PermissionStatus::Unavailable, None)
    }
}

// === macOS 权限检测 ===

#[cfg(target_os = "macos")]
fn detect_macos_permission(permission_type: PermissionType) -> (PermissionStatus, Option<String>) {
    match permission_type {
        PermissionType::Accessibility => {
            // 检查辅助功能权限 - 通过 tccutil 或 AppleScript
            let status = check_macos_tcc("kTCCServiceAccessibility");
            let instructions = Some(
                "系统设置 → 隐私与安全性 → 辅助功能 → 允许 nuwax-agent".to_string(),
            );
            (status, instructions)
        }
        PermissionType::ScreenRecording => {
            let status = check_macos_tcc("kTCCServiceScreenCapture");
            let instructions = Some(
                "系统设置 → 隐私与安全性 → 屏幕录制 → 允许 nuwax-agent".to_string(),
            );
            (status, instructions)
        }
        PermissionType::FullDiskAccess => {
            let status = check_macos_tcc("kTCCServiceSystemPolicyAllFiles");
            let instructions = Some(
                "系统设置 → 隐私与安全性 → 完全磁盘访问权限 → 允许 nuwax-agent".to_string(),
            );
            (status, instructions)
        }
        PermissionType::FileAccess => {
            // 文件访问通常在 macOS 上是默认授权的
            (PermissionStatus::Granted, None)
        }
        PermissionType::NetworkAccess => {
            // 网络访问通常在 macOS 上是默认授权的
            (PermissionStatus::Granted, None)
        }
    }
}

#[cfg(target_os = "macos")]
fn check_macos_tcc(_service: &str) -> PermissionStatus {
    // TCC 数据库检查需要特殊权限，这里使用简化检测
    // 实际实现可通过 macOS Accessibility API 检查
    // 当前使用 NotDetermined 作为默认值，因为无法在非交互环境确定
    PermissionStatus::NotDetermined
}

#[cfg(target_os = "macos")]
fn open_macos_settings(permission_type: PermissionType) -> Result<(), PermissionError> {
    let pane = match permission_type {
        PermissionType::Accessibility => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        PermissionType::ScreenRecording => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        PermissionType::FullDiskAccess => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        }
        _ => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy"
        }
    };

    std::process::Command::new("open")
        .arg(pane)
        .spawn()
        .map_err(|e| PermissionError::OpenSettingsFailed(e.to_string()))?;

    Ok(())
}

// === Windows 权限检测 ===

#[cfg(target_os = "windows")]
fn detect_windows_permission(permission_type: PermissionType) -> (PermissionStatus, Option<String>) {
    match permission_type {
        PermissionType::Accessibility => {
            // Windows 的辅助功能权限通过 UI Automation 检查
            (PermissionStatus::Granted, None)
        }
        PermissionType::ScreenRecording => {
            // Windows 不需要显式屏幕录制权限
            (PermissionStatus::Granted, None)
        }
        PermissionType::FullDiskAccess => {
            // 检查是否以管理员权限运行
            let status = if is_elevated_windows() {
                PermissionStatus::Granted
            } else {
                PermissionStatus::Denied
            };
            let instructions = Some("请以管理员身份运行应用程序".to_string());
            (status, instructions)
        }
        PermissionType::FileAccess => {
            (PermissionStatus::Granted, None)
        }
        PermissionType::NetworkAccess => {
            // 检查防火墙设置需要额外权限，先假设已授权
            (PermissionStatus::Granted, None)
        }
    }
}

#[cfg(target_os = "windows")]
fn is_elevated_windows() -> bool {
    // 简化检测：尝试访问 system32 目录
    std::path::Path::new("C:\\Windows\\System32\\config").exists()
}

#[cfg(target_os = "windows")]
fn open_windows_settings(permission_type: PermissionType) -> Result<(), PermissionError> {
    let uri = match permission_type {
        PermissionType::Accessibility => "ms-settings:easeofaccess",
        PermissionType::ScreenRecording => "ms-settings:privacy",
        PermissionType::FullDiskAccess => "ms-settings:privacy",
        _ => "ms-settings:privacy",
    };

    std::process::Command::new("cmd")
        .args(["/C", "start", uri])
        .spawn()
        .map_err(|e| PermissionError::OpenSettingsFailed(e.to_string()))?;

    Ok(())
}

// === Linux 权限检测 ===

#[cfg(target_os = "linux")]
fn detect_linux_permission(permission_type: PermissionType) -> (PermissionStatus, Option<String>) {
    match permission_type {
        PermissionType::Accessibility => {
            // Linux 通过 AT-SPI2 提供辅助功能
            (PermissionStatus::Granted, None)
        }
        PermissionType::ScreenRecording => {
            // X11 不需要权限，Wayland 需要 PipeWire
            let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
            if is_wayland {
                (
                    PermissionStatus::NotDetermined,
                    Some("Wayland 环境可能需要 PipeWire 支持".to_string()),
                )
            } else {
                (PermissionStatus::Granted, None)
            }
        }
        PermissionType::FullDiskAccess => {
            // 检查用户权限 - 通过环境变量或 id 命令
            let is_root = std::env::var("USER")
                .map(|u| u == "root")
                .unwrap_or(false);
            if is_root {
                (PermissionStatus::Granted, None)
            } else {
                (
                    PermissionStatus::Denied,
                    Some("某些目录可能需要 root 权限".to_string()),
                )
            }
        }
        PermissionType::FileAccess => {
            (PermissionStatus::Granted, None)
        }
        PermissionType::NetworkAccess => {
            (PermissionStatus::Granted, None)
        }
    }
}

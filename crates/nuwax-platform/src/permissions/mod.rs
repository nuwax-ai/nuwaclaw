//! 跨平台权限抽象
//!
//! 统一处理不同平台的系统权限检测与申请
//!
//! # 权限类型
//!
//! | 权限 | macOS | Windows | Linux |
//! |------|-------|---------|-------|
//! | 辅助功能 | Security > Privacy > Accessibility | UAC | - |
//! | 屏幕录制 | Security > Privacy > Screen Recording | GDI+ / Desktop Duplication | - |
//! | 麦克风 | Security > Privacy > Microphone | 隐私设置 | PulseAudio |
//! | 摄像头 | Security > Privacy > Camera | 隐私设置 | V4L2 |
//! | 完全磁盘访问 | Security > Privacy > Full Disk Access | - | - |

use std::path::PathBuf;

/// 权限类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionType {
    Accessibility,     // 辅助功能
    ScreenRecording,  // 屏幕录制
    Microphone,       // 麦克风
    Camera,           // 摄像头
    FullDiskAccess,   // 完全磁盘访问 (macOS only)
    Notifications,    // 通知
}

/// 权限状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionState {
    Granted,       // 已授权
    Denied,        // 已拒绝
    NotDetermined, // 未决定（首次请求）
    Unknown,       // 未知
}

/// 权限信息
#[derive(Debug, Clone)]
pub struct PermissionInfo {
    pub permission: PermissionType,
    pub state: PermissionState,
    pub can_request: bool,
    pub description: &'static str,
}

/// 权限提供者 trait
pub trait PermissionProvider {
    /// 获取所有权限状态
    fn get_permissions(&self) -> Vec<PermissionInfo>;

    /// 获取单个权限状态
    fn get_permission(&self, permission: PermissionType) -> PermissionInfo;

    /// 检查权限是否已授予
    fn is_granted(&self, permission: PermissionType) -> bool;

    /// 请求权限
    fn request(&self, permission: PermissionType) -> Result<PermissionState, crate::Error>;

    /// 打开系统设置（让用户手动授权）
    fn open_settings(&self, permission: PermissionType) -> Result<(), crate::Error>;

    /// 获取系统设置路径
    fn settings_path(&self, permission: PermissionType) -> Option<PathBuf>;
}

/// 权限管理器
pub struct PermissionManager<P: PermissionProvider> {
    provider: P,
}

impl<P: PermissionProvider> PermissionManager<P> {
    #[inline]
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    /// 获取所有权限状态
    #[inline]
    pub fn permissions(&self) -> Vec<PermissionInfo> {
        self.provider.get_permissions()
    }

    /// 获取单个权限状态
    #[inline]
    pub fn permission(&self, permission: PermissionType) -> PermissionInfo {
        self.provider.get_permission(permission)
    }

    /// 检查是否已授予
    #[inline]
    pub fn is_granted(&self, permission: PermissionType) -> bool {
        self.provider.is_granted(permission)
    }

    /// 请求权限
    #[inline]
    pub fn request(&self, permission: PermissionType) -> Result<PermissionState, crate::Error> {
        self.provider.request(permission)
    }

    /// 打开系统设置
    #[inline]
    pub fn open_settings(&self, permission: PermissionType) -> Result<(), crate::Error> {
        self.provider.open_settings(permission)
    }

    /// 检查是否所有必需权限都已授予
    #[inline]
    pub fn check_required(&self, permissions: &[PermissionType]) -> Vec<PermissionType> {
        permissions
            .iter()
            .filter(|p| !self.is_granted(**p))
            .copied()
            .collect()
    }

    /// 批量检查权限
    #[inline]
    pub fn check_all(&self, permissions: &[PermissionType]) -> Vec<PermissionInfo> {
        permissions
            .iter()
            .map(|p| self.provider.get_permission(**p))
            .collect()
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::process::Command;

    const ACCESSIBILITY_DB: &str = "/Library/Application Support/com.apple.TCC/TCC.db";

    fn check_tcc_db(service: &str) -> PermissionState {
        // 读取 TCC 数据库检查权限状态
        // 注意：需要 root 权限或 SIP 禁用才能直接读取
        // 实际实现可能需要其他方式检测

        // 简化实现：尝试访问受保护资源
        match service {
            "kTCCServiceAccessibility" => {
                // 检查辅助功能权限
                PermissionState::NotDetermined
            }
            "kTCCServiceScreenCapture" => PermissionState::NotDetermined,
            "kTCCServiceMicrophone" => PermissionState::NotDetermined,
            "kTCCServiceCamera" => PermissionState::NotDetermined,
            "kTCCServiceFullDiskAccess" => PermissionState::NotDetermined,
            _ => PermissionState::Unknown,
        }
    }

    impl super::PermissionProvider for PlatformPermissions {
        fn get_permissions(&self) -> Vec<PermissionInfo> {
            vec![
                self.get_permission(PermissionType::Accessibility),
                self.get_permission(PermissionType::ScreenRecording),
                self.get_permission(PermissionType::Microphone),
                self.get_permission(PermissionType::Camera),
                self.get_permission(PermissionType::FullDiskAccess),
            ]
        }

        fn get_permission(&self, permission: PermissionType) -> PermissionInfo {
            let (service, description) = match permission {
                PermissionType::Accessibility => ("kTCCServiceAccessibility", "辅助功能权限用于控制其他应用"),
                PermissionType::ScreenRecording => ("kTCCServiceScreenCapture", "屏幕录制权限用于远程桌面"),
                PermissionType::Microphone => ("kTCCServiceMicrophone", "麦克风权限用于语音通信"),
                PermissionType::Camera => ("kTCCServiceCamera", "摄像头权限用于视频通话"),
                PermissionType::FullDiskAccess => ("kTCCServiceFullDiskAccess", "完全磁盘访问权限用于访问所有文件"),
                PermissionType::Notifications => ("kTCCServiceNotifications", "通知权限用于显示提醒"),
            };

            let state = check_tcc_db(service);

            PermissionInfo {
                permission,
                state,
                can_request: matches!(state, PermissionState::NotDetermined),
                description,
            }
        }

        fn is_granted(&self, permission: PermissionType) -> bool {
            self.get_permission(permission).state == PermissionState::Granted
        }

        fn request(&self, permission: PermissionType) -> Result<PermissionState, crate::Error> {
            // macOS 需要通过系统对话框请求
            // 注意：Tauri 可能需要通过 Swift/ObjC 代码实现
            Ok(PermissionState::NotDetermined)
        }

        fn open_settings(&self, permission: PermissionType) -> Result<(), crate::Error> {
            let url = match permission {
                PermissionType::Accessibility => "x-apple.systempreferences:com.apple.securityAccessibility",
                PermissionType::ScreenRecording => "x-apple.systempreferences:com.apple.securityScreenCapture",
                PermissionType::Microphone => "x-apple.systempreferences:com.apple.securityMicrophone",
                PermissionType::Camera => "x-apple.systempreferences:com.apple.securityCamera",
                PermissionType::FullDiskAccess => "x-apple.systempreferences:com.apple.securityFullDiskAccess",
                PermissionType::Notifications => "x-apple.systempreferences:com.apple.notifications",
            };

            Command::new("open").arg(url).output()?;
            Ok(())
        }

        fn settings_path(&self, permission: PermissionType) -> Option<PathBuf> {
            Some(match permission {
                PermissionType::Accessibility => PathBuf::from("/System/Library/PreferencePanes/Security.prefPane"),
                _ => PathBuf::from("/System/Library/PreferencePanes/Security.prefPane"),
            })
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;

    impl super::PermissionProvider for PlatformPermissions {
        fn get_permissions(&self) -> Vec<PermissionInfo> {
            vec![
                self.get_permission(PermissionType::Accessibility),
                self.get_permission(PermissionType::ScreenRecording),
                self.get_permission(PermissionType::Microphone),
                self.get_permission(PermissionType::Camera),
            ]
        }

        fn get_permission(&self, permission: PermissionType) -> PermissionInfo {
            let (state, description, can_request) = match permission {
                PermissionType::Accessibility => (PermissionState::Unknown, "辅助功能权限", true),
                PermissionType::ScreenRecording => (PermissionState::Unknown, "屏幕录制权限", true),
                PermissionType::Microphone => (PermissionState::Unknown, "麦克风权限", true),
                PermissionType::Camera => (PermissionState::Unknown, "摄像头权限", true),
                _ => (PermissionState::Unknown, "权限", false),
            };

            PermissionInfo {
                permission,
                state,
                can_request,
                description,
            }
        }

        fn is_granted(&self, _permission: PermissionType) -> bool {
            false // Windows 权限检测需要不同实现
        }

        fn request(&self, _permission: PermissionType) -> Result<PermissionState, crate::Error> {
            Ok(PermissionState::NotDetermined)
        }

        fn open_settings(&self, _permission: PermissionType) -> Result<(), crate::Error> {
            // 打开 Windows 隐私设置
            Ok(())
        }

        fn settings_path(&self, _permission: PermissionType) -> Option<PathBuf> {
            None
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    impl super::PermissionProvider for PlatformPermissions {
        fn get_permissions(&self) -> Vec<PermissionInfo> {
            vec![
                self.get_permission(PermissionType::Accessibility),
                self.get_permission(PermissionType::Microphone),
                self.get_permission(PermissionType::Camera),
            ]
        }

        fn get_permission(&self, permission: PermissionType) -> PermissionInfo {
            let (state, description, can_request) = match permission {
                PermissionType::Accessibility => (PermissionState::Unknown, "辅助功能权限", true),
                PermissionType::Microphone => (PermissionState::Unknown, "麦克风权限", true),
                PermissionType::Camera => (PermissionState::Unknown, "摄像头权限", true),
                _ => (PermissionState::Unknown, "权限", false),
            };

            PermissionInfo {
                permission,
                state,
                can_request,
                description,
            }
        }

        fn is_granted(&self, _permission: PermissionType) -> bool {
            false // Linux 权限检测需要不同实现（通常基于 polkit / D-Bus）
        }

        fn request(&self, _permission: PermissionType) -> Result<PermissionState, crate::Error> {
            Ok(PermissionState::NotDetermined)
        }

        fn open_settings(&self, _permission: PermissionType) -> Result<(), crate::Error> {
            // 打开系统设置
            Ok(())
        }

        fn settings_path(&self, _permission: PermissionType) -> Option<PathBuf> {
            None
        }
    }
}

/// 平台权限实现
pub struct PlatformPermissions;

impl PermissionProvider for PlatformPermissions {
    #[cfg(target_os = "macos")]
    fn get_permissions(&self) -> Vec<PermissionInfo> {
        let p = PlatformPermissions;
        p.get_permissions()
    }

    #[cfg(target_os = "windows")]
    fn get_permissions(&self) -> Vec<PermissionInfo> {
        let p = PlatformPermissions;
        p.get_permissions()
    }

    #[cfg(target_os = "linux")]
    fn get_permissions(&self) -> Vec<PermissionInfo> {
        let p = PlatformPermissions;
        p.get_permissions()
    }

    #[cfg(target_os = "macos")]
    fn get_permission(&self, permission: PermissionType) -> PermissionInfo {
        let p = PlatformPermissions;
        p.get_permission(permission)
    }

    #[cfg(target_os = "windows")]
    fn get_permission(&self, permission: PermissionType) -> PermissionInfo {
        let p = PlatformPermissions;
        p.get_permission(permission)
    }

    #[cfg(target_os = "linux")]
    fn get_permission(&self, permission: PermissionType) -> PermissionInfo {
        let p = PlatformPermissions;
        p.get_permission(permission)
    }

    fn is_granted(&self, permission: PermissionType) -> bool {
        #[cfg(target_os = "macos")]
        {
            let p = PlatformPermissions;
            p.is_granted(permission)
        }
        #[cfg(target_os = "windows")]
        {
            let p = PlatformPermissions;
            p.is_granted(permission)
        }
        #[cfg(target_os = "linux")]
        {
            let p = PlatformPermissions;
            p.is_granted(permission)
        }
    }

    fn request(&self, permission: PermissionType) -> Result<PermissionState, crate::Error> {
        #[cfg(target_os = "macos")]
        {
            let p = PlatformPermissions;
            p.request(permission)
        }
        #[cfg(target_os = "windows")]
        {
            let p = PlatformPermissions;
            p.request(permission)
        }
        #[cfg(target_os = "linux")]
        {
            let p = PlatformPermissions;
            p.request(permission)
        }
    }

    fn open_settings(&self, permission: PermissionType) -> Result<(), crate::Error> {
        #[cfg(target_os = "macos")]
        {
            let p = PlatformPermissions;
            p.open_settings(permission)
        }
        #[cfg(target_os = "windows")]
        {
            let p = PlatformPermissions;
            p.open_settings(permission)
        }
        #[cfg(target_os = "linux")]
        {
            let p = PlatformPermissions;
            p.open_settings(permission)
        }
    }

    fn settings_path(&self, permission: PermissionType) -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        {
            let p = PlatformPermissions;
            p.settings_path(permission)
        }
        #[cfg(target_os = "windows")]
        {
            let p = PlatformPermissions;
            p.settings_path(permission)
        }
        #[cfg(target_os = "linux")]
        {
            let p = PlatformPermissions;
            p.settings_path(permission)
        }
    }
}

/// 创建权限管理器
#[inline]
pub fn permissions() -> PermissionManager<PlatformPermissions> {
    PermissionManager::new(PlatformPermissions)
}

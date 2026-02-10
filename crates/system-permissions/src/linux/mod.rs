//! Linux 权限管理器实现
//!
//! 使用 D-Bus、AT-SPI 和系统工具检查和请求各种系统权限

use async_trait::async_trait;
use chrono::Utc;
use std::path::Path;
use std::process::Command;

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
        let has_access = check_atspi_access() || check_dbus_atspi_access();

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

    /// 检查 PipeWire 屏幕录制权限 (Wayland)
    async fn check_screen_recording(&self) -> PermissionState {
        let has_access = check_pipewire_portal_access() || check_xdg_portal_screencast();

        // 检查是否是 Wayland 会话
        let is_wayland = std::env::var("XDG_SESSION_TYPE")
            .map(|v| v == "wayland")
            .unwrap_or(false);

        // Wayland 需要 xdg-desktop-portal
        let status = if is_wayland {
            if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            }
        } else {
            // X11 通常需要 xhost 检查
            if check_x11_screen_access() {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            }
        };

        PermissionState {
            permission: SystemPermission::ScreenRecording,
            status,
            location_mode: None,
            granted_at: if status == PermissionStatus::Authorized {
                Some(Utc::now())
            } else {
                None
            },
            can_request: status == PermissionStatus::NotDetermined,
        }
    }

    /// 检查音频设备权限 (PulseAudio/PipeWire)
    async fn check_microphone(&self) -> PermissionState {
        let has_access = check_audio_device_access() || check_pulseaudio_access();

        PermissionState {
            permission: SystemPermission::Microphone,
            status: if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            },
            location_mode: None,
            granted_at: if has_access { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查相机权限 (V4L2)
    async fn check_camera(&self) -> PermissionState {
        let has_access = check_camera_access();

        PermissionState {
            permission: SystemPermission::Camera,
            status: if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            },
            location_mode: None,
            granted_at: if has_access { Some(Utc::now()) } else { None },
            can_request: true,
        }
    }

    /// 检查位置权限 (GeoClue)
    async fn check_location(&self) -> PermissionState {
        let has_access = check_geoclue_access();

        PermissionState {
            permission: SystemPermission::Location,
            status: if has_access {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::Denied
            },
            location_mode: if has_access {
                Some(LocationMode::WhileUsing)
            } else {
                Some(LocationMode::Off)
            },
            granted_at: if has_access { Some(Utc::now()) } else { None },
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

    /// 检查网络权限
    async fn check_network(&self) -> PermissionState {
        PermissionState {
            permission: SystemPermission::Network,
            status: PermissionStatus::Authorized,
            location_mode: None,
            granted_at: Some(Utc::now()),
            can_request: false,
        }
    }

    /// 检查文件系统权限
    async fn check_filesystem(&self, permission: SystemPermission) -> PermissionState {
        // 检查用户主目录权限
        let home_dir = std::env::home_dir().unwrap_or_default();

        if permission == SystemPermission::FileSystemRead {
            let can_read = home_dir.exists() && home_dir.read_dir().is_ok();
            PermissionState {
                permission,
                status: if can_read {
                    PermissionStatus::Authorized
                } else {
                    PermissionStatus::Denied
                },
                location_mode: None,
                granted_at: if can_read { Some(Utc::now()) } else { None },
                can_request: true,
            }
        } else {
            let can_write = home_dir.exists() && home_dir.read_dir().is_ok();
            PermissionState {
                permission,
                status: if can_write {
                    PermissionStatus::Authorized
                } else {
                    PermissionStatus::Denied
                },
                location_mode: None,
                granted_at: if can_write { Some(Utc::now()) } else { None },
                can_request: true,
            }
        }
    }

    /// 检查 NuwaxCode / Claude Code / 键盘监控 等权限
    async fn check_ide_and_extra(&self, permission: SystemPermission) -> PermissionState {
        match permission {
            SystemPermission::KeyboardMonitoring => {
                let has_access = check_input_device_access();
                PermissionState {
                    permission,
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
            _ => PermissionState {
                permission,
                status: PermissionStatus::NotDetermined,
                location_mode: None,
                granted_at: None,
                can_request: true,
            },
        }
    }

    /// 请求辅助功能权限
    async fn request_accessibility(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            let _ = Command::new("sh")
                .args(&[
                    "-c",
                    "gnome-control-center accessibility 2>/dev/null || xdg-open settings://accessibility",
                ])
                .spawn();
        }

        RequestResult {
            permission: SystemPermission::Accessibility,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: Some("Please enable Accessibility in system settings".to_string()),
            settings_guide: Some("System Settings > Accessibility".to_string()),
        }
    }

    /// 请求屏幕录制权限
    async fn request_screen_recording(&self, options: RequestOptions) -> RequestResult {
        // Wayland 使用 xdg-desktop-portal 请求屏幕录制
        if options.interactive {
            // 提示用户通过 portal 对话框授权
            let _ = Command::new("sh")
                .args(&[
                    "-c",
                    "xdg-desktop-portal --help 2>/dev/null || echo 'Portal not available'",
                ])
                .spawn();
        }

        let granted = check_pipewire_portal_access();

        RequestResult {
            permission: SystemPermission::ScreenRecording,
            granted,
            status: if granted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            },
            error_message: if granted {
                None
            } else {
                Some("Screen recording requires portal permission".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("Allow screen recording in the permission dialog".to_string())
            },
        }
    }

    /// 请求麦克风权限
    async fn request_microphone(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            let _ = Command::new("sh")
                .args(&[
                    "-c",
                    "gnome-control-center privacy 2>/dev/null || xdg-open settings://privacy",
                ])
                .spawn();
        }

        let granted = check_audio_device_access();

        RequestResult {
            permission: SystemPermission::Microphone,
            granted,
            status: if granted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            },
            error_message: if granted {
                None
            } else {
                Some("Microphone access requires device permission".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("Check /dev/snd device permissions or Audio Settings".to_string())
            },
        }
    }

    /// 请求相机权限
    async fn request_camera(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            let _ = Command::new("sh")
                .args(&[
                    "-c",
                    "gnome-control-center privacy 2>/dev/null || xdg-open settings://privacy",
                ])
                .spawn();
        }

        let granted = check_camera_access();

        RequestResult {
            permission: SystemPermission::Camera,
            granted,
            status: if granted {
                PermissionStatus::Authorized
            } else {
                PermissionStatus::NotDetermined
            },
            error_message: if granted {
                None
            } else {
                Some("Camera access requires /dev/video* device permission".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("Check /dev/video device permissions or Camera Settings".to_string())
            },
        }
    }

    /// 请求位置权限
    async fn request_location(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            let _ = Command::new("sh")
                .args(&[
                    "-c",
                    "gnome-control-center privacy 2>/dev/null || xdg-open settings://privacy",
                ])
                .spawn();
        }

        let granted = check_geoclue_access();

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
                Some("Location services must be enabled in system settings".to_string())
            },
            settings_guide: if granted {
                None
            } else {
                Some("System Settings > Privacy > Location Services".to_string())
            },
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

    /// 请求网络权限
    async fn request_network(&self, _options: RequestOptions) -> RequestResult {
        RequestResult {
            permission: SystemPermission::Network,
            granted: true,
            status: PermissionStatus::Authorized,
            error_message: None,
            settings_guide: None,
        }
    }

    /// 请求键盘监控权限
    async fn request_keyboard_monitoring(&self, options: RequestOptions) -> RequestResult {
        if options.interactive {
            let _ = Command::new("sh")
                .args(&[
                    "-c",
                    "gnome-control-center privacy 2>/dev/null || xdg-open settings://privacy",
                ])
                .spawn();
        }

        RequestResult {
            permission: SystemPermission::KeyboardMonitoring,
            granted: false,
            status: PermissionStatus::NotDetermined,
            error_message: Some(
                "Keyboard monitoring requires input device permissions".to_string(),
            ),
            settings_guide: Some("System Settings > Privacy > Input Monitoring".to_string()),
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
            SystemPermission::Clipboard,
            SystemPermission::Network,
            SystemPermission::NuwaxCode,
            SystemPermission::ClaudeCode,
            SystemPermission::FileSystemRead,
            SystemPermission::FileSystemWrite,
            SystemPermission::KeyboardMonitoring,
        ]
    }

    async fn check(&self, permission: SystemPermission) -> PermissionState {
        match permission {
            SystemPermission::Accessibility => self.check_accessibility().await,
            SystemPermission::ScreenRecording => self.check_screen_recording().await,
            SystemPermission::Microphone => self.check_microphone().await,
            SystemPermission::Camera => self.check_camera().await,
            SystemPermission::Location => self.check_location().await,
            SystemPermission::Clipboard => self.check_clipboard().await,
            SystemPermission::Network => self.check_network().await,
            SystemPermission::FileSystemRead | SystemPermission::FileSystemWrite => {
                self.check_filesystem(permission).await
            }
            SystemPermission::KeyboardMonitoring => self.check_ide_and_extra(permission).await,
            SystemPermission::NuwaxCode | SystemPermission::ClaudeCode => {
                self.check_ide_and_extra(permission).await
            }
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
            SystemPermission::Clipboard => self.request_clipboard(options).await,
            SystemPermission::Network => self.request_network(options).await,
            SystemPermission::KeyboardMonitoring => self.request_keyboard_monitoring(options).await,
            SystemPermission::FileSystemRead | SystemPermission::FileSystemWrite => {
                let _ = self.open_settings(permission).await;
                RequestResult::denied(
                    permission,
                    Some("Please grant file access in system settings".to_string()),
                    Some("File picker permission or home directory access".to_string()),
                )
            }
            SystemPermission::NuwaxCode | SystemPermission::ClaudeCode => {
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
            SystemPermission::ScreenRecording
            | SystemPermission::Microphone
            | SystemPermission::Camera => "gnome-control-center privacy",
            SystemPermission::Location => "gnome-control-center privacy",
            SystemPermission::Clipboard | SystemPermission::KeyboardMonitoring => {
                "gnome-control-center privacy"
            }
            SystemPermission::NuwaxCode
            | SystemPermission::ClaudeCode
            | SystemPermission::FileSystemRead
            | SystemPermission::FileSystemWrite => "gnome-control-center privacy",
            SystemPermission::Network => "gnome-control-center network",
            _ => {
                return Err(PermissionError::Unsupported {
                    permission: permission.name(),
                })
            }
        };

        Command::new("sh")
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

/// 检查 AT-SPI 辅助功能权限配置
fn check_atspi_access() -> bool {
    // 检查用户配置文件
    if let Ok(home) = std::env::var("HOME") {
        let config_paths = [
            format!("{}/.config/at-spi2/accessibility.conf", home),
            format!("{}/.config/at-spi2/atspi.conf", home),
        ];

        for config_path in &config_paths {
            if Path::new(config_path).exists() {
                return true;
            }
        }
    }

    // 检查系统级配置
    ["/etc/at-spi2/accessibility.conf", "/etc/at-spi2/atspi.conf"]
        .iter()
        .any(|p| Path::new(p).exists())
}

/// 检查 D-Bus AT-SPI2 服务可用性
fn check_dbus_atspi_access() -> bool {
    // 通过 D-Bus 检查 AT-SPI2 服务
    std::process::Command::new("busctl")
        .args(&[
            "call",
            "--system",
            "org.a11y.Bus",
            "/org/a11y/bus",
            "org.freedesktop.DBus.Introspectable",
            "Introspect",
        ])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// 检查 PipeWire 门户访问权限
fn check_pipewire_portal_access() -> bool {
    // 检查 xdg-desktop-portal 是否运行
    let portal_running = std::process::Command::new("pgrep")
        .args(&["-x", "xdg-desktop-portal"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    if !portal_running {
        return false;
    }

    // 检查 PipeWire 配置文件
    if let Ok(home) = std::env::var("HOME") {
        let pipewire_conf = format!("{}/.config/pipewire/pipewire.conf", home);
        if Path::new(&pipewire_conf).exists() {
            return true;
        }
    }

    false
}

/// 检查 xdg-desktop-portal 屏幕录制
fn check_xdg_portal_screencast() -> bool {
    // 检查 portal 设置文件
    if let Ok(home) = std::env::var("HOME") {
        let portal_settings = format!("{}/.config/xdg-desktop-portal/settings.conf", home);
        if Path::new(&portal_settings).exists() {
            return true;
        }
    }
    false
}

/// 检查 X11 屏幕访问权限
fn check_x11_screen_access() -> bool {
    // 检查 DISPLAY 环境变量
    if std::env::var("DISPLAY").is_err() {
        return false;
    }

    // 尝试 xhost 检查
    let output = std::process::Command::new("xhost")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok());

    match output {
        Some(s) => {
            // 检查是否有本地连接
            s.lines()
                .any(|line| line.contains("LOCAL:") || line.contains("Si:"))
        }
        None => false,
    }
}

/// 检查音频设备访问权限
fn check_audio_device_access() -> bool {
    let snd_path = Path::new("/dev/snd");
    if snd_path.exists() {
        // 尝试列出设备
        return std::fs::read_dir(snd_path).is_ok();
    }
    false
}

/// 检查 PulseAudio 访问
fn check_pulseaudio_access() -> bool {
    // 检查 PulseAudio socket
    let pulse_dir = Path::new("/run/user")
        .join(std::process::id().to_string())
        .join("pulse");

    if pulse_dir.exists() {
        return true;
    }

    // 检查环境变量
    std::env::var("PULSE_SERVER").is_ok()
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

/// 检查位置服务访问 (GeoClue)
fn check_geoclue_access() -> bool {
    // 检查 GeoClue D-Bus 服务
    let geoclue_running = std::process::Command::new("busctl")
        .args(&[
            "call",
            "--system",
            "org.freedesktop.GeoClue2",
            "/org/freedesktop/GeoClue2/Manager",
            "org.freedesktop.GeoClue2.Manager",
            "GetVersion",
        ])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    geoclue_running
}

/// 检查输入设备访问权限
fn check_input_device_access() -> bool {
    // 检查 /dev/input 目录
    let input_path = Path::new("/dev/input");
    if input_path.exists() {
        return std::fs::read_dir(input_path).is_ok();
    }
    false
}

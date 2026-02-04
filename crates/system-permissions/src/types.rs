//! 权限类型定义
//!
//! 定义系统权限枚举、状态类型和请求选项

/// 系统权限类型枚举
///
/// 表示桌面应用程序可能需要请求的各种系统权限
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SystemPermission {
    /// 辅助功能权限 - 控制其他应用的 UI 元素
    ///
    /// macOS: TCC Accessibility
    /// Windows: UAC/管理员权限
    /// Linux: AT-SPI
    Accessibility,

    /// 屏幕录制权限 - 捕获屏幕内容
    ///
    /// macOS: TCC Screen Recording
    /// Windows: DXGI Desktop Duplication
    /// Linux: PipeWire/xdg-desktop-portal
    ScreenRecording,

    /// 麦克风权限 - 音频捕获
    ///
    /// macOS: TCC Microphone (AVFoundation)
    /// Windows: WASAPI Audio
    /// Linux: PulseAudio/PipeWire
    Microphone,

    /// 相机权限 - 视频捕获
    ///
    /// macOS: TCC Camera (AVFoundation)
    /// Windows: Media Foundation
    /// Linux: V4L2
    Camera,

    /// 通知权限 - 桌面通知
    ///
    /// macOS: UserNotifications
    /// Windows: Toast Notifications
    /// Linux: Desktop Notifications (D-Bus)
    Notifications,

    /// 语音识别权限 - 语音转文字 (仅 macOS)
    ///
    /// macOS: Speech Framework
    /// 其他平台: 不支持
    SpeechRecognition,

    /// 位置权限 - 地理位置服务
    ///
    /// macOS: CoreLocation
    /// Windows: Windows Location API
    /// Linux: GeoClue
    Location,

    /// AppleScript 权限 - 自动化控制 (仅 macOS)
    ///
    /// macOS: AppleScript/Automation
    /// 其他平台: 不支持
    AppleScript,

    /// NuwaxCode 编辑器权限 - NuwaxCode IDE 集成
    ///
    /// 用于与 NuwaxCode 编辑器的集成和自动化
    NuwaxCode,

    /// Claude Code 编辑器权限 - Claude Code IDE 集成
    ///
    /// 用于与 Claude Code 编辑器的集成和自动化
    ClaudeCode,

    /// 文件系统读权限 - 读取用户指定目录/文件
    ///
    /// macOS: 沙盒/用户选择文件
    /// Windows: 文件系统访问
    /// Linux: 文件系统访问
    FileSystemRead,

    /// 文件系统写权限 - 写入用户指定目录/文件
    ///
    /// macOS: 沙盒/用户选择文件
    /// Windows: 文件系统访问
    /// Linux: 文件系统访问
    FileSystemWrite,

    /// 剪贴板权限 - 读写系统剪贴板
    ///
    /// 各平台通常默认允许，部分环境需显式授权
    Clipboard,

    /// 键盘监控权限 - 监听全局键盘输入 (如快捷键)
    ///
    /// macOS: 与辅助功能或输入监控相关
    /// Windows: 底层键盘钩子
    /// Linux: X11/Wayland 输入
    KeyboardMonitoring,

    /// 网络权限 - 发起网络请求
    ///
    /// 各平台通常默认允许，沙盒环境下需声明
    Network,
}

impl SystemPermission {
    /// 获取权限显示名称
    ///
    /// 返回用于 UI 显示的人类可读权限名称
    ///
    /// # 示例
    ///
    /// ```rust
    /// use system_permissions::SystemPermission;
    ///
    /// assert_eq!(SystemPermission::Microphone.name(), "Microphone");
    /// ```
    pub fn name(&self) -> &'static str {
        match self {
            Self::Accessibility => "Accessibility",
            Self::ScreenRecording => "Screen Recording",
            Self::Microphone => "Microphone",
            Self::Camera => "Camera",
            Self::Notifications => "Notifications",
            Self::SpeechRecognition => "Speech Recognition",
            Self::Location => "Location",
            Self::AppleScript => "AppleScript",
            Self::NuwaxCode => "NuwaxCode",
            Self::ClaudeCode => "Claude Code",
            Self::FileSystemRead => "File System (Read)",
            Self::FileSystemWrite => "File System (Write)",
            Self::Clipboard => "Clipboard",
            Self::KeyboardMonitoring => "Keyboard Monitoring",
            Self::Network => "Network",
        }
    }

    /// 获取权限描述
    ///
    /// 返回描述权限用途的简短文本
    pub fn description(&self) -> &'static str {
        match self {
            Self::Accessibility => "Required to control other applications",
            Self::ScreenRecording => "Required to capture screen content",
            Self::Microphone => "Required for audio input",
            Self::Camera => "Required for video input",
            Self::Notifications => "Required to show desktop notifications",
            Self::SpeechRecognition => "Required for speech-to-text",
            Self::Location => "Required to access location services",
            Self::AppleScript => "Required to automate other apps via AppleScript",
            Self::NuwaxCode => "Required for NuwaxCode editor integration",
            Self::ClaudeCode => "Required for Claude Code editor integration",
            Self::FileSystemRead => "Required to read files and folders",
            Self::FileSystemWrite => "Required to write files and folders",
            Self::Clipboard => "Required to read and write clipboard",
            Self::KeyboardMonitoring => "Required for global keyboard shortcuts",
            Self::Network => "Required for network access",
        }
    }

    /// 检查权限是否支持当前平台
    ///
    /// 某些权限只在特定平台上可用
    #[cfg(target_os = "macos")]
    pub fn is_supported(&self) -> bool {
        true // macOS 支持所有定义的权限
    }

    #[cfg(target_os = "windows")]
    pub fn is_supported(&self) -> bool {
        match self {
            Self::SpeechRecognition | Self::AppleScript => false,
            Self::Accessibility
            | Self::ScreenRecording
            | Self::Microphone
            | Self::Camera
            | Self::Notifications
            | Self::Location
            | Self::NuwaxCode
            | Self::ClaudeCode
            | Self::FileSystemRead
            | Self::FileSystemWrite
            | Self::Clipboard
            | Self::KeyboardMonitoring
            | Self::Network => true,
        }
    }

    #[cfg(target_os = "linux")]
    pub fn is_supported(&self) -> bool {
        match self {
            Self::SpeechRecognition | Self::AppleScript | Self::Notifications => false,
            Self::Accessibility
            | Self::ScreenRecording
            | Self::Microphone
            | Self::Camera
            | Self::Location
            | Self::NuwaxCode
            | Self::ClaudeCode
            | Self::FileSystemRead
            | Self::FileSystemWrite
            | Self::Clipboard
            | Self::KeyboardMonitoring
            | Self::Network => true,
        }
    }
}

/// 权限授权状态
///
/// 表示权限请求的当前状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionStatus {
    /// 未决定 - 首次请求权限或用户尚未做出选择
    ///
    /// 这是权限的初始状态，应用程序可以请求权限
    NotDetermined,

    /// 已授权 - 用户已授予权限
    ///
    /// 应用程序可以使用相应的系统功能
    Authorized,

    /// 已拒绝 - 用户明确拒绝授权
    ///
    /// 应用程序需要引导用户手动在系统设置中启用权限
    Denied,

    /// 受限制 - 系统限制获取此权限
    ///
    /// 可能由管理员策略或家长控制导致
    Restricted,

    /// 不可用 - 平台不支持此权限
    ///
    /// 某些权限在特定操作系统上不可用
    Unavailable,
}

impl PermissionStatus {
    /// 检查状态是否表示已授权
    pub fn is_authorized(&self) -> bool {
        matches!(self, Self::Authorized)
    }

    /// 检查状态是否表示可请求
    pub fn can_request(&self) -> bool {
        matches!(self, Self::NotDetermined)
    }

    /// 检查状态是否表示需要用户手动操作
    pub fn requires_manual_action(&self) -> bool {
        matches!(self, Self::Denied | Self::Restricted)
    }

    /// 获取状态的人类可读描述
    pub fn to_string(&self) -> &'static str {
        match self {
            Self::NotDetermined => "Not Determined",
            Self::Authorized => "Authorized",
            Self::Denied => "Denied",
            Self::Restricted => "Restricted",
            Self::Unavailable => "Unavailable",
        }
    }
}

/// 位置权限的特殊模式 (主要 macOS)
///
/// 位置权限通常有多个授权级别
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocationMode {
    /// 关闭 - 位置服务完全禁用
    Off,

    /// 使用时获取 - 仅在应用程序运行时获取位置
    ///
    /// 这是较严格的隐私设置
    WhileUsing,

    /// 始终获取 - 即使应用程序在后台也能获取位置
    ///
    /// 这是较宽松的隐私设置，通常需要额外的用户确认
    Always,
}

impl LocationMode {
    /// 从授权状态推断位置模式
    #[cfg(target_os = "macos")]
    pub fn from_authorization_status(status: i32) -> Self {
        match status {
            // kCLAuthorizationStatusAuthorizedWhenInUse
            5 => Self::WhileUsing,
            // kCLAuthorizationStatusAuthorizedAlways
            4 | 3 => Self::Always, // kCLAuthorizationStatusAuthorized
            _ => Self::Off,
        }
    }

    /// 获取模式的显示名称
    pub fn name(&self) -> &'static str {
        match self {
            Self::Off => "Off",
            Self::WhileUsing => "While Using",
            Self::Always => "Always",
        }
    }
}

/// 权限状态信息
///
/// 包含权限的完整状态信息
#[derive(Debug, Clone)]
pub struct PermissionState {
    /// 权限类型
    pub permission: SystemPermission,

    /// 当前授权状态
    pub status: PermissionStatus,

    /// 位置权限的特殊模式 (仅当 permission == SystemPermission::Location 时有效)
    pub location_mode: Option<LocationMode>,

    /// 权限获取时间 (如果已授权)
    pub granted_at: Option<chrono::DateTime<chrono::Utc>>,

    /// 是否可以交互式请求此权限
    ///
    /// 如果为 false，用户需要手动在系统设置中启用权限
    pub can_request: bool,
}

impl PermissionState {
    /// 创建新的权限状态
    pub fn new(permission: SystemPermission, status: PermissionStatus) -> Self {
        Self {
            permission,
            status,
            location_mode: None,
            granted_at: None,
            can_request: status.can_request(),
        }
    }

    /// 创建已授权状态的快捷方法
    pub fn authorized(permission: SystemPermission) -> Self {
        Self {
            permission,
            status: PermissionStatus::Authorized,
            location_mode: None,
            granted_at: Some(chrono::Utc::now()),
            can_request: false,
        }
    }

    /// 创建拒绝状态的快捷方法
    pub fn denied(permission: SystemPermission) -> Self {
        Self {
            permission,
            status: PermissionStatus::Denied,
            location_mode: None,
            granted_at: None,
            can_request: false,
        }
    }

    /// 创建不可用状态的快捷方法
    pub fn unavailable(permission: SystemPermission) -> Self {
        Self {
            permission,
            status: PermissionStatus::Unavailable,
            location_mode: None,
            granted_at: None,
            can_request: false,
        }
    }

    /// 检查是否已授权
    pub fn is_authorized(&self) -> bool {
        self.status.is_authorized()
    }
}

/// 权限请求选项
///
/// 控制权限请求的行为
#[derive(Debug, Clone)]
pub struct RequestOptions {
    /// 是否显示系统对话框
    ///
    /// 如果为 true，会显示系统的权限请求对话框
    /// 如果为 false，仅检查当前权限状态而不请求
    pub interactive: bool,

    /// 超时时间 (毫秒)
    ///
    /// 权限请求的超时时间。某些系统对话框可能不会自动关闭
    pub timeout_ms: u64,

    /// 自定义理由消息 (macOS)
    ///
    /// 在请求权限时显示给用户的说明文本
    /// 仅 macOS 支持此选项
    pub reason: Option<String>,

    /// 显示详细错误信息
    pub verbose_errors: bool,
}

impl Default for RequestOptions {
    fn default() -> Self {
        Self {
            interactive: true,
            timeout_ms: 30_000, // 30 秒默认超时
            reason: None,
            verbose_errors: true,
        }
    }
}

impl RequestOptions {
    /// 创建非交互式请求选项
    ///
    /// 仅检查权限状态，不显示系统对话框
    pub fn non_interactive() -> Self {
        Self {
            interactive: false,
            ..Default::default()
        }
    }

    /// 创建交互式请求选项
    ///
    /// 显示系统对话框请求权限
    pub fn interactive() -> Self {
        Self {
            interactive: true,
            ..Default::default()
        }
    }

    /// 设置超时时间
    pub fn with_timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = ms;
        self
    }

    /// 设置理由消息
    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

/// 权限请求结果
///
/// 包含权限请求的完整结果信息
#[derive(Debug, Clone)]
pub struct RequestResult {
    /// 请求的权限类型
    pub permission: SystemPermission,

    /// 是否成功获取权限
    pub granted: bool,

    /// 请求后的最终状态
    pub status: PermissionStatus,

    /// 错误消息 (如果请求失败)
    pub error_message: Option<String>,

    /// 设置引导信息
    ///
    /// 当权限被拒绝时，提供手动启用的指导
    pub settings_guide: Option<String>,
}

impl RequestResult {
    /// 创建成功结果
    pub fn granted(permission: SystemPermission, status: PermissionStatus) -> Self {
        Self {
            permission,
            granted: true,
            status,
            error_message: None,
            settings_guide: None,
        }
    }

    /// 创建失败结果
    pub fn denied(
        permission: SystemPermission,
        error_message: impl Into<Option<String>>,
        settings_guide: impl Into<Option<String>>,
    ) -> Self {
        Self {
            permission,
            granted: false,
            status: PermissionStatus::Denied,
            error_message: error_message.into(),
            settings_guide: settings_guide.into(),
        }
    }

    /// 创建不支持的结果
    pub fn unsupported(permission: SystemPermission) -> Self {
        Self {
            permission,
            granted: false,
            status: PermissionStatus::Unavailable,
            error_message: Some(format!(
                "{} is not supported on this platform",
                permission.name()
            )),
            settings_guide: None,
        }
    }

    /// 检查是否成功
    pub fn is_success(&self) -> bool {
        self.granted
    }

    /// 检查是否需要手动操作
    pub fn requires_manual_action(&self) -> bool {
        self.status.requires_manual_action()
    }
}

/// 权限检查结果 (批量)
///
/// 包含多个权限的检查结果
#[derive(Debug, Clone)]
pub struct CheckResult {
    /// 所有权限的状态列表
    pub states: Vec<PermissionState>,

    /// 已授权的权限数量
    pub authorized_count: usize,

    /// 缺失的权限数量
    pub missing_count: usize,
}

impl CheckResult {
    /// 从状态列表创建检查结果
    pub fn from_states(states: Vec<PermissionState>) -> Self {
        let authorized_count = states.iter().filter(|s| s.is_authorized()).count();
        let missing_count = states.len() - authorized_count;

        Self {
            states,
            authorized_count,
            missing_count,
        }
    }

    /// 检查是否所有权限都已授权
    pub fn all_authorized(&self) -> bool {
        self.missing_count == 0
    }

    /// 获取缺失的权限列表
    pub fn missing_permissions(&self) -> Vec<SystemPermission> {
        self.states
            .iter()
            .filter(|s| !s.is_authorized())
            .map(|s| s.permission)
            .collect()
    }

    /// 获取已授权的权限列表
    pub fn authorized_permissions(&self) -> Vec<SystemPermission> {
        self.states
            .iter()
            .filter(|s| s.is_authorized())
            .map(|s| s.permission)
            .collect()
    }
}

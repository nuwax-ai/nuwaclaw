//! 权限相关错误类型
//!
//! 定义权限操作过程中可能出现的错误

use thiserror::Error;

/// 权限相关错误类型
///
/// 包含所有权限操作可能产生的错误变体
#[derive(Debug, Error)]
pub enum PermissionError {
    /// 权限不支持当前平台
    ///
    /// 某些权限只在特定操作系统上可用
    #[error("Permission '{permission}' is not supported on this platform")]
    Unsupported {
        /// 不支持的权限类型
        permission: &'static str,
    },

    /// 权限请求超时
    ///
    /// 系统对话框或权限检查操作超时
    #[error("Permission request timed out after {timeout_ms}ms")]
    Timeout {
        /// 超时时间 (毫秒)
        timeout_ms: u64,
    },

    /// 用户拒绝权限请求
    ///
    /// 用户在系统对话框中点击了"拒绝"或"不允许"
    #[error("Permission was denied by user")]
    DeniedByUser,

    /// 权限被永久拒绝
    ///
    /// 用户之前拒绝了权限请求且选择了"不再询问"，
    /// 需要用户手动在系统设置中启用
    #[error("Permission permanently denied, requires manual intervention in system settings")]
    PermanentlyDenied,

    /// 系统服务不可用
    ///
    /// 权限检查所需的后台服务未运行或不存在
    #[error("System service unavailable: {service}")]
    ServiceUnavailable {
        /// 不可用的服务名称
        service: String,
    },

    /// 打开系统设置失败
    ///
    /// 尝试打开权限设置页面时发生错误
    #[error("Failed to open settings: {reason}")]
    SettingsOpenFailed {
        /// 失败原因
        reason: String,
    },

    /// 平台 API 错误
    ///
    /// 调用底层系统 API 时发生错误
    #[error("Platform API error: {details}")]
    PlatformError {
        /// 错误详情
        details: String,
    },

    /// 权限状态无效
    ///
    /// 获取到的权限状态值无效或无法解析
    #[error("Invalid permission status value: {value}")]
    InvalidStatus {
        /// 原始值
        value: i32,
    },

    /// 权限请求被取消
    ///
    /// 用户关闭了系统权限对话框
    #[error("Permission request was cancelled by user")]
    Cancelled,

    /// 未知错误
    ///
    /// 未分类的错误
    #[error("Unknown permission error: {message}")]
    Unknown {
        /// 错误消息
        message: String,
    },
}

impl PermissionError {
    /// 创建不支持权限的错误
    pub fn unsupported(permission: &'static str) -> Self {
        Self::Unsupported { permission }
    }

    /// 创建超时错误
    pub fn timeout(timeout_ms: u64) -> Self {
        Self::Timeout { timeout_ms }
    }

    /// 创建设置打开失败错误
    pub fn settings_open_failed(reason: impl Into<String>) -> Self {
        Self::SettingsOpenFailed {
            reason: reason.into(),
        }
    }

    /// 创建平台错误
    pub fn platform_error(details: impl Into<String>) -> Self {
        Self::PlatformError {
            details: details.into(),
        }
    }

    /// 检查错误是否表示需要用户手动操作
    pub fn requires_manual_action(&self) -> bool {
        matches!(
            self,
            Self::PermanentlyDenied | Self::SettingsOpenFailed { .. }
        )
    }

    /// 获取错误的用户友好消息
    pub fn user_message(&self) -> String {
        match self {
            Self::Unsupported { permission } => {
                format!(
                    "{} permission is not available on this platform",
                    permission
                )
            }
            Self::Timeout { timeout_ms } => {
                format!("Permission request timed out after {}ms", timeout_ms)
            }
            Self::DeniedByUser => {
                "Permission was denied. Please try again or enable manually in system settings."
                    .to_string()
            }
            Self::PermanentlyDenied => {
                "Permission was permanently denied. Please enable it manually in system settings."
                    .to_string()
            }
            Self::ServiceUnavailable { service } => {
                format!("Required system service '{}' is unavailable", service)
            }
            Self::SettingsOpenFailed { reason } => {
                format!("Failed to open settings: {}", reason)
            }
            Self::PlatformError { details } => {
                format!("System error: {}", details)
            }
            Self::InvalidStatus { value } => {
                format!("Invalid permission status value: {}", value)
            }
            Self::Cancelled => "Permission request was cancelled".to_string(),
            Self::Unknown { message } => message.clone(),
        }
    }
}

/// 权限操作结果的简写类型
///
/// 用于表示可能失败的权限操作
pub type PermissionResult<T> = Result<T, PermissionError>;

impl From<std::io::Error> for PermissionError {
    fn from(e: std::io::Error) -> Self {
        Self::PlatformError {
            details: format!("I/O error: {}", e),
        }
    }
}

impl From<std::time::SystemTimeError> for PermissionError {
    fn from(e: std::time::SystemTimeError) -> Self {
        Self::PlatformError {
            details: format!("Time error: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_messages() {
        let error = PermissionError::unsupported("Microphone");
        assert_eq!(
            error.to_string(),
            "Permission 'Microphone' is not supported on this platform"
        );

        let error = PermissionError::timeout(30000);
        assert_eq!(
            error.to_string(),
            "Permission request timed out after 30000ms"
        );
    }

    #[test]
    fn test_user_message() {
        let error = PermissionError::PermanentlyDenied;
        assert!(error.user_message().contains("manually in system settings"));

        let error = PermissionError::settings_open_failed("Command not found");
        assert!(error.user_message().contains("Failed to open settings"));
    }

    #[test]
    fn test_requires_manual_action() {
        assert!(PermissionError::PermanentlyDenied.requires_manual_action());
        assert!(PermissionError::SettingsOpenFailed {
            reason: "test".to_string()
        }
        .requires_manual_action());

        assert!(!PermissionError::DeniedByUser.requires_manual_action());
        assert!(!PermissionError::timeout(1000).requires_manual_action());
    }
}

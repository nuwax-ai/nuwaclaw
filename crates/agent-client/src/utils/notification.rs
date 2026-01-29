//! 通知工具

use serde::{Deserialize, Serialize};

/// 通知类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotificationType {
    Info,
    Success,
    Warning,
    Error,
}

/// 通知消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    /// 通知类型
    pub notification_type: NotificationType,
    /// 标题
    pub title: String,
    /// 内容
    pub message: String,
}

impl Notification {
    pub fn info(message: impl Into<String>) -> Self {
        Self {
            notification_type: NotificationType::Info,
            title: "信息".to_string(),
            message: message.into(),
        }
    }

    pub fn success(message: impl Into<String>) -> Self {
        Self {
            notification_type: NotificationType::Success,
            title: "成功".to_string(),
            message: message.into(),
        }
    }

    pub fn warning(message: impl Into<String>) -> Self {
        Self {
            notification_type: NotificationType::Warning,
            title: "警告".to_string(),
            message: message.into(),
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            notification_type: NotificationType::Error,
            title: "错误".to_string(),
            message: message.into(),
        }
    }
}

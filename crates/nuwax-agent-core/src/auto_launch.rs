//! 开机自启动管理模块
//!
//! 支持跨平台开机自启动功能
//! 使用 nuwax-platform 提供统一的自动启动抽象

use thiserror::Error;
use nuwax_platform::autostart::{PlatformAutostart, autostart};

/// 开机自启动错误
#[derive(Error, Debug)]
pub enum AutoLaunchError {
    #[error("设置开机自启动失败: {0}")]
    EnableFailed(String),
    #[error("取消开机自启动失败: {0}")]
    DisableFailed(String),
    #[error("检查状态失败: {0}")]
    StatusCheckFailed(String),
}

/// 开机自启动管理器（使用 nuwax-platform）
///
/// 在 nuwax-platform PlatformAutostart 基础上添加异步支持
pub struct AutoLaunchManager {
    /// 平台自动启动实例
    platform_autostart: PlatformAutostart,
}

impl AutoLaunchManager {
    /// 创建新的开机自启动管理器
    pub fn new() -> Result<Self, AutoLaunchError> {
        Ok(Self {
            platform_autostart: autostart(),
        })
    }

    /// 启用开机自启动
    pub async fn enable(&self) -> Result<(), AutoLaunchError> {
        self.platform_autostart.enable()
            .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))
    }

    /// 禁用开机自启动
    pub async fn disable(&self) -> Result<(), AutoLaunchError> {
        self.platform_autostart.disable()
            .map_err(|e| AutoLaunchError::DisableFailed(e.to_string()))
    }

    /// 检查是否已启用开机自启动
    pub async fn is_enabled(&self) -> Result<bool, AutoLaunchError> {
        Ok(self.platform_autostart.is_enabled())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_auto_launch_manager_creation() {
        let manager = AutoLaunchManager::new();
        assert!(manager.is_ok());
    }

    #[tokio::test]
    async fn test_auto_launch_check_status() {
        let manager = AutoLaunchManager::new().unwrap();
        // 在测试环境中可能无法准确检查
        let _ = manager.is_enabled().await;
    }
}

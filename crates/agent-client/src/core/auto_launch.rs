//! 开机自启动管理
//!
//! 使用 auto-launch crate 实现跨平台开机自启动

use thiserror::Error;
use tracing::info;

#[cfg(feature = "auto-launch")]
use auto_launch::AutoLaunchBuilder;

/// 自启动错误
#[derive(Error, Debug)]
pub enum AutoLaunchError {
    #[error("功能未启用")]
    FeatureDisabled,
    #[error("初始化失败: {0}")]
    InitFailed(String),
    #[error("启用失败: {0}")]
    EnableFailed(String),
    #[error("禁用失败: {0}")]
    DisableFailed(String),
    #[error("状态检查失败: {0}")]
    CheckFailed(String),
}

/// 自启动管理器
pub struct AutoLaunchManager {
    #[cfg(feature = "auto-launch")]
    auto_launch: auto_launch::AutoLaunch,
    #[cfg(not(feature = "auto-launch"))]
    _phantom: std::marker::PhantomData<()>,
}

impl AutoLaunchManager {
    /// 创建新的自启动管理器
    pub fn new() -> Result<Self, AutoLaunchError> {
        #[cfg(feature = "auto-launch")]
        {
            let app_name = env!("CARGO_PKG_NAME");
            let app_path = std::env::current_exe()
                .map_err(|e| AutoLaunchError::InitFailed(e.to_string()))?;

            // 使用 AutoLaunchBuilder 实现跨平台兼容
            let auto_launch = AutoLaunchBuilder::new()
                .set_app_name(app_name)
                .set_app_path(app_path.to_string_lossy().as_ref())
                .set_args(&[] as &[&str])
                .build()
                .map_err(|e| AutoLaunchError::InitFailed(e.to_string()))?;

            info!("AutoLaunchManager initialized for: {}", app_name);

            Ok(Self { auto_launch })
        }

        #[cfg(not(feature = "auto-launch"))]
        {
            Ok(Self {
                _phantom: std::marker::PhantomData,
            })
        }
    }

    /// 检查是否已启用自启动
    pub fn is_enabled(&self) -> Result<bool, AutoLaunchError> {
        #[cfg(feature = "auto-launch")]
        {
            self.auto_launch
                .is_enabled()
                .map_err(|e| AutoLaunchError::CheckFailed(e.to_string()))
        }

        #[cfg(not(feature = "auto-launch"))]
        {
            Err(AutoLaunchError::FeatureDisabled)
        }
    }

    /// 启用自启动
    pub fn enable(&self) -> Result<(), AutoLaunchError> {
        #[cfg(feature = "auto-launch")]
        {
            self.auto_launch
                .enable()
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
            info!("Auto-launch enabled");
            Ok(())
        }

        #[cfg(not(feature = "auto-launch"))]
        {
            Err(AutoLaunchError::FeatureDisabled)
        }
    }

    /// 禁用自启动
    pub fn disable(&self) -> Result<(), AutoLaunchError> {
        #[cfg(feature = "auto-launch")]
        {
            self.auto_launch
                .disable()
                .map_err(|e| AutoLaunchError::DisableFailed(e.to_string()))?;
            info!("Auto-launch disabled");
            Ok(())
        }

        #[cfg(not(feature = "auto-launch"))]
        {
            Err(AutoLaunchError::FeatureDisabled)
        }
    }

    /// 设置自启动状态
    pub fn set_enabled(&self, enabled: bool) -> Result<(), AutoLaunchError> {
        if enabled {
            self.enable()
        } else {
            self.disable()
        }
    }

    /// 切换自启动状态
    pub fn toggle(&self) -> Result<bool, AutoLaunchError> {
        let is_enabled = self.is_enabled()?;
        self.set_enabled(!is_enabled)?;
        Ok(!is_enabled)
    }
}

impl Default for AutoLaunchManager {
    fn default() -> Self {
        Self::new().unwrap_or_else(|_| {
            #[cfg(feature = "auto-launch")]
            panic!("Failed to create AutoLaunchManager");

            #[cfg(not(feature = "auto-launch"))]
            Self {
                _phantom: std::marker::PhantomData,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auto_launch_manager_creation() {
        // 只测试创建，不实际启用/禁用
        let result = AutoLaunchManager::new();
        // 在没有 auto-launch feature 时仍然应该成功创建
        assert!(result.is_ok());
    }
}

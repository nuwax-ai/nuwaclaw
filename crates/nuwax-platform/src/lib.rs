//! 跨平台抽象层
//!
//! 提供统一的平台能力抽象：路径、自动启动、托盘、权限等
//! 通过 trait 和 platform-specific 实现支持 macOS/Windows/Linux

pub mod paths;
pub mod autostart;
pub mod tray;
pub mod permissions;

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
    fn initialize(&self) -> crate::Result<()> {
        Ok(())
    }
}

/// 统一错误类型
pub use crate::Error;

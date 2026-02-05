//! 跨平台托盘抽象
//!
//! 统一处理不同平台的系统托盘行为
//!
//! # 平台行为差异
//!
//! | 平台 | 左键行为 | 右键行为 | 特殊说明 |
//! |------|---------|---------|---------|
//! | macOS | 显示菜单 | 显示菜单 | 菜单栏图标，点击弹出菜单 |
//! | Windows | 显示主窗口 | 显示菜单 | 系统托盘，左键打开窗口 |
//! | Linux | 显示主窗口 | 显示菜单 | 依赖 DE 支持 |

use std::path::PathBuf;

/// 托盘图标类型
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayIcon {
    Default,
    Connected,
    Disconnected,
    Error,
}

/// 托盘菜单项
#[derive(Debug, Clone)]
pub struct TrayMenuItem {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub checked: Option<bool>,
    pub children: Vec<TrayMenuItem>,
}

/// 托盘事件
#[derive(Debug, Clone)]
pub enum TrayEvent {
    Click,
    DoubleClick,
    RightClick,
    MenuSelect(String), // menu item id
}

/// 托盘回调类型
pub type TrayCallback = Box<dyn Fn(TrayEvent) + Send + Sync>;

/// 托盘提供者 trait
pub trait TrayProvider {
    /// 创建托盘图标
    fn create_icon(&self, icon: TrayIcon) -> Result<(), crate::Error>;

    /// 设置托盘图标
    fn set_icon(&self, icon: TrayIcon) -> Result<(), crate::Error>;

    /// 设置托盘提示文本
    fn set_tooltip(&self, text: &str) -> Result<(), crate::Error>;

    /// 设置菜单
    fn set_menu(&self, items: Vec<TrayMenuItem>) -> Result<(), crate::Error>;

    /// 显示托盘
    fn show(&self) -> Result<(), crate::Error>;

    /// 隐藏托盘
    fn hide(&self) -> Result<(), crate::Error>;

    /// 销毁托盘
    fn destroy(&self) -> Result<(), crate::Error>;

    /// 注册事件回调
    fn on_event(&self, callback: TrayCallback);
}

/// 托盘状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Hidden,
    Visible,
}

/// 托盘管理器
pub struct TrayManager<P: TrayProvider> {
    provider: P,
    state: TrayState,
}

impl<P: TrayProvider> TrayManager<P> {
    /// 创建托盘管理器
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            state: TrayState::Hidden,
        }
    }

    /// 初始化托盘
    pub fn initialize(&mut self) -> Result<(), crate::Error> {
        self.provider.create_icon(TrayIcon::Default)?;
        self.provider.set_tooltip("NuWax Agent");
        self.provider.show()?;
        self.state = TrayState::Visible;
        Ok(())
    }

    /// 显示主窗口（Windows/Linux 常用）
    pub fn show_main_window(&self) {
        // 由调用方实现窗口显示逻辑
        // 这里只发送事件通知
    }

    /// 隐藏到托盘
    pub fn hide_to_tray(&mut self) -> Result<(), crate::Error> {
        self.provider.hide()?;
        self.state = TrayState::Hidden;
        Ok(())
    }

    /// 显示托盘
    pub fn show_tray(&mut self) -> Result<(), crate::Error> {
        self.provider.show()?;
        self.state = TrayState::Visible;
        Ok(())
    }

    /// 更新图标状态
    pub fn update_icon(&self, icon: TrayIcon) -> Result<(), crate::Error> {
        self.provider.set_icon(icon)
    }

    /// 更新菜单
    pub fn update_menu(&self, items: Vec<TrayMenuItem>) -> Result<(), crate::Error> {
        self.provider.set_menu(items)
    }

    /// 获取当前状态
    pub fn state(&self) -> TrayState {
        self.state
    }

    /// 是否可见
    pub fn is_visible(&self) -> bool {
        self.state == TrayState::Visible
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use tauri::AppHandle;

    pub struct MacOSTray {
        app: AppHandle,
        icon: Option<Vec<u8>>,
    }

    impl MacOSTray {
        pub fn new(app: AppHandle) -> Self {
            Self { app, icon: None }
        }
    }

    impl super::TrayProvider for MacOSTray {
        fn create_icon(&self, _icon: super::TrayIcon) -> Result<(), crate::Error> {
            // macOS 使用系统原生托盘
            Ok(())
        }

        fn set_icon(&self, _icon: super::TrayIcon) -> Result<(), crate::Error> {
            Ok(())
        }

        fn set_tooltip(&self, text: &str) -> Result<(), crate::Error> {
            // macOS 托盘图标 tooltip
            Ok(())
        }

        fn set_menu(&self, _items: Vec<TrayMenuItem>) -> Result<(), crate::Error> {
            Ok(())
        }

        fn show(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn hide(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn destroy(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn on_event(&self, _callback: super::TrayCallback) {
            // macOS 事件处理
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;

    pub struct WindowsTray {
        hwnd: Option<isize>,
        icon_path: Option<PathBuf>,
    }

    impl WindowsTray {
        pub fn new() -> Self {
            Self {
                hwnd: None,
                icon_path: None,
            }
        }
    }

    impl super::TrayProvider for WindowsTray {
        fn create_icon(&self, _icon: super::TrayIcon) -> Result<(), crate::Error> {
            Ok(())
        }

        fn set_icon(&self, _icon: super::TrayIcon) -> Result<(), crate::Error> {
            Ok(())
        }

        fn set_tooltip(&self, _text: &str) -> Result<(), crate::Error> {
            Ok(())
        }

        fn set_menu(&self, _items: Vec<TrayMenuItem>) -> Result<(), crate::Error> {
            Ok(())
        }

        fn show(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn hide(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn destroy(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn on_event(&self, _callback: super::TrayCallback) {
            // Windows 托盘事件处理
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    pub struct LinuxTray {
        indicator: Option<*mut libc::c_void>,
    }

    impl LinuxTray {
        pub fn new() -> Self {
            Self { indicator: None }
        }
    }

    impl super::TrayProvider for LinuxTray {
        fn create_icon(&self, _icon: super::TrayIcon) -> Result<(), crate::Error> {
            // Linux 需要 appindicator3 或 libappindicator
            Ok(())
        }

        fn set_icon(&self, _icon: super::TrayIcon) -> Result<(), crate::Error> {
            Ok(())
        }

        fn set_tooltip(&self, _text: &str) -> Result<(), crate::Error> {
            Ok(())
        }

        fn set_menu(&self, _items: Vec<TrayMenuItem>) -> Result<(), crate::Error> {
            Ok(())
        }

        fn show(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn hide(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn destroy(&self) -> Result<(), crate::Error> {
            Ok(())
        }

        fn on_event(&self, _callback: super::TrayCallback) {
            // Linux 托盘事件处理
        }
    }
}

/// 平台托盘实现（占位，需要根据实际 Tauri 集成）
pub struct PlatformTray {
    #[cfg(target_os = "macos")]
    inner: macos::MacOSTray,
    #[cfg(target_os = "windows")]
    inner: windows::WindowsTray,
    #[cfg(target_os = "linux")]
    inner: linux::LinuxTray,
}

impl PlatformTray {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            inner: macos::MacOSTray::new(),
            #[cfg(target_os = "windows")]
            inner: windows::WindowsTray::new(),
            #[cfg(target_os = "linux")]
            inner: linux::LinuxTray::new(),
        }
    }
}

impl TrayProvider for PlatformTray {
    fn create_icon(&self, icon: TrayIcon) -> Result<(), crate::Error> {
        self.inner.create_icon(icon)
    }

    fn set_icon(&self, icon: TrayIcon) -> Result<(), crate::Error> {
        self.inner.set_icon(icon)
    }

    fn set_tooltip(&self, text: &str) -> Result<(), crate::Error> {
        self.inner.set_tooltip(text)
    }

    fn set_menu(&self, items: Vec<TrayMenuItem>) -> Result<(), crate::Error> {
        self.inner.set_menu(items)
    }

    fn show(&self) -> Result<(), crate::Error> {
        self.inner.show()
    }

    fn hide(&self) -> Result<(), crate::Error> {
        self.inner.hide()
    }

    fn destroy(&self) -> Result<(), crate::Error> {
        self.inner.destroy()
    }

    fn on_event(&self, callback: TrayCallback) {
        self.inner.on_event(callback)
    }
}

/// 创建托盘管理器
#[inline]
pub fn tray() -> TrayManager<PlatformTray> {
    TrayManager::new(PlatformTray::new())
}

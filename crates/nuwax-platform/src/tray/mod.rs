//! 跨平台托盘抽象
//!
//! 统一处理不同平台的系统托盘图标和菜单
//!
//! # 平台差异处理
//!
//! | 平台 | 托盘支持 | 菜单行为 | 注意事项 |
//! |------|---------|---------|---------|
//! | macOS | 完全支持 | 顶部菜单栏 | 需要辅助功能权限 |
//! | Windows | 完全支持 | 右下角通知区域 | 需要设置窗口消息处理 |
//! | Linux | 部分支持 | 依赖系统托盘实现 | 不同 DE 兼容性问题 |

use std::path::PathBuf;

/// 托盘事件类型
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayEvent {
    /// 显示主窗口
    ShowWindow,
    /// 打开设置
    OpenSettings,
    /// 打开依赖管理
    OpenDependencies,
    /// 显示关于
    ShowAbout,
    /// 退出应用
    Quit,
    /// 左键点击图标
    LeftClick,
    /// 右键点击图标
    RightClick,
}

/// 托盘菜单项
#[derive(Debug, Clone)]
pub struct TrayMenuItem {
    /// 菜单项 ID
    pub id: String,
    /// 菜单项显示标签
    pub label: String,
    /// 是否可用
    pub enabled: bool,
    /// 是否为分隔线
    pub is_separator: bool,
}

impl TrayMenuItem {
    /// 创建普通菜单项
    #[inline]
    pub fn new(id: impl Into<String>, label: impl Into<String>, enabled: bool) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            enabled,
            is_separator: false,
        }
    }

    /// 创建分隔线
    #[inline]
    pub fn separator() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            enabled: false,
            is_separator: true,
        }
    }
}

/// 托盘菜单配置
#[derive(Debug, Clone, Default)]
pub struct TrayMenu {
    /// 菜单项列表
    pub items: Vec<TrayMenuItem>,
}

impl TrayMenu {
    /// 创建标准菜单（显示窗口、设置、依赖、关于、退出）
    #[inline]
    pub fn standard() -> Self {
        Self {
            items: vec![
                TrayMenuItem::new("show_window", "显示窗口", true),
                TrayMenuItem::separator(),
                TrayMenuItem::new("settings", "设置", true),
                TrayMenuItem::new("dependencies", "依赖管理", true),
                TrayMenuItem::separator(),
                TrayMenuItem::new("about", "关于", true),
                TrayMenuItem::separator(),
                TrayMenuItem::new("quit", "退出", true),
            ],
        }
    }

    /// 创建最小菜单（仅显示窗口和退出）
    #[inline]
    pub fn minimal() -> Self {
        Self {
            items: vec![
                TrayMenuItem::new("show_window", "显示窗口", true),
                TrayMenuItem::separator(),
                TrayMenuItem::new("quit", "退出", true),
            ],
        }
    }

    /// 创建自定义菜单
    #[inline]
    pub fn new(items: Vec<TrayMenuItem>) -> Self {
        Self { items }
    }
}

/// 托盘配置
#[derive(Debug, Clone, Default)]
pub struct TrayConfig {
    /// 托盘图标路径
    pub icon_path: Option<PathBuf>,
    /// 托盘提示文本
    pub tooltip: String,
    /// 初始菜单
    pub menu: TrayMenu,
}

impl TrayConfig {
    /// 创建默认配置
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置图标路径
    #[inline]
    pub fn with_icon_path<P: Into<PathBuf>>(mut self, path: P) -> Self {
        self.icon_path = Some(path.into());
        self
    }

    /// 设置提示文本
    #[inline]
    pub fn with_tooltip(mut self, tooltip: impl Into<String>) -> Self {
        self.tooltip = tooltip.into();
        self
    }

    /// 设置菜单
    #[inline]
    pub fn with_menu(mut self, menu: TrayMenu) -> Self {
        self.menu = menu;
        self
    }
}

/// 检查托盘是否在当前环境可用
///
/// 对于 Linux，会检查 DISPLAY 或 WAYLAND_DISPLAY 环境变量
/// 对于其他平台始终返回 true
#[inline]
pub fn is_tray_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var("DISPLAY").is_ok() || std::env::var("WAYLAND_DISPLAY").is_ok()
    }

    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

/// 获取托盘图标默认路径
///
/// 优先从运行时目录加载图标
#[inline]
pub fn get_default_icon_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let path = home.join("Library/Application Support/nuwax-agent/icons/tray_icon.png");
            if path.exists() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(app_data) = dirs::data_dir() {
            let path = app_data.join("nuwax-agent/icons/tray_icon.png");
            if path.exists() {
                return Some(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = xdg::BaseDirectories::new() {
            let path = xdg.get_data_home().join("nuwax-agent/icons/tray_icon.png");
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tray_menu_standard() {
        let menu = TrayMenu::standard();
        assert!(!menu.items.is_empty());
        assert!(menu.items.iter().any(|i| i.id == "show_window"));
        assert!(menu.items.iter().any(|i| i.id == "quit"));
    }

    #[test]
    fn test_tray_menu_minimal() {
        let menu = TrayMenu::minimal();
        assert_eq!(menu.items.len(), 3);
    }

    #[test]
    fn test_tray_menu_item() {
        let item = TrayMenuItem::new("test", "Test Item", true);
        assert_eq!(item.id, "test");
        assert_eq!(item.label, "Test Item");
        assert!(item.enabled);
        assert!(!item.is_separator);
    }

    #[test]
    fn test_tray_menu_item_separator() {
        let item = TrayMenuItem::separator();
        assert!(item.id.is_empty());
        assert!(item.label.is_empty());
        assert!(item.is_separator);
    }

    #[test]
    fn test_tray_config() {
        let config = TrayConfig::new()
            .with_icon_path("/path/to/icon.png")
            .with_tooltip("Test Tooltip")
            .with_menu(TrayMenu::minimal());

        assert!(config.icon_path.is_some());
        assert_eq!(config.tooltip, "Test Tooltip");
        assert_eq!(config.items.len(), 3);
    }

    #[test]
    fn test_is_tray_available() {
        let available = is_tray_available();
        #[cfg(not(target_os = "linux"))]
        assert!(available);
    }
}

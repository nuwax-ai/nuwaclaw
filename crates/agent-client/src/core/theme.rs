//! 主题管理模块
//!
//! 支持浅色/深色/跟随系统三种主题模式

use serde::{Deserialize, Serialize};

/// 主题模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum ThemeMode {
    /// 浅色主题
    Light,
    /// 深色主题
    Dark,
    /// 跟随系统
    #[default]
    System,
}

impl ThemeMode {
    /// 显示名称
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Light => "浅色",
            Self::Dark => "深色",
            Self::System => "跟随系统",
        }
    }

    /// 英文显示名称
    pub fn display_name_en(&self) -> &'static str {
        match self {
            Self::Light => "Light",
            Self::Dark => "Dark",
            Self::System => "System",
        }
    }

    /// 从字符串解析
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "light" => Self::Light,
            "dark" => Self::Dark,
            _ => Self::System,
        }
    }

    /// 所有可用模式
    pub fn all() -> &'static [ThemeMode] {
        &[ThemeMode::Light, ThemeMode::Dark, ThemeMode::System]
    }
}


/// 主题管理器
pub struct ThemeManager {
    /// 当前主题模式
    current_mode: ThemeMode,
    /// 系统主题检测结果（true = dark）
    system_is_dark: bool,
}

impl Default for ThemeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ThemeManager {
    /// 创建新的主题管理器
    pub fn new() -> Self {
        Self {
            current_mode: ThemeMode::default(),
            system_is_dark: Self::detect_system_dark(),
        }
    }

    /// 设置主题模式
    pub fn set_mode(&mut self, mode: ThemeMode) {
        self.current_mode = mode;
    }

    /// 获取当前模式
    pub fn mode(&self) -> ThemeMode {
        self.current_mode
    }

    /// 是否应使用深色主题
    pub fn is_dark(&self) -> bool {
        match self.current_mode {
            ThemeMode::Light => false,
            ThemeMode::Dark => true,
            ThemeMode::System => self.system_is_dark,
        }
    }

    /// 刷新系统主题检测
    pub fn refresh_system_theme(&mut self) {
        self.system_is_dark = Self::detect_system_dark();
    }

    /// 检测系统是否使用深色主题
    fn detect_system_dark() -> bool {
        #[cfg(target_os = "macos")]
        {
            // macOS: 使用 defaults 命令检查
            std::process::Command::new("defaults")
                .args(["read", "-g", "AppleInterfaceStyle"])
                .output()
                .map(|output| {
                    String::from_utf8_lossy(&output.stdout)
                        .trim()
                        .eq_ignore_ascii_case("dark")
                })
                .unwrap_or(false)
        }

        #[cfg(target_os = "windows")]
        {
            // Windows: 检查注册表
            std::process::Command::new("reg")
                .args([
                    "query",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                    "/v",
                    "AppsUseLightTheme",
                ])
                .output()
                .map(|output| {
                    let text = String::from_utf8_lossy(&output.stdout);
                    text.contains("0x0")
                })
                .unwrap_or(false)
        }

        #[cfg(target_os = "linux")]
        {
            // Linux: 检查 GTK 主题或 gsettings
            std::process::Command::new("gsettings")
                .args(["get", "org.gnome.desktop.interface", "gtk-theme"])
                .output()
                .map(|output| {
                    let theme = String::from_utf8_lossy(&output.stdout).to_lowercase();
                    theme.contains("dark")
                })
                .unwrap_or(false)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_theme_mode_default() {
        assert_eq!(ThemeMode::default(), ThemeMode::System);
    }

    #[test]
    fn test_theme_mode_from_str() {
        assert_eq!(ThemeMode::from_str("light"), ThemeMode::Light);
        assert_eq!(ThemeMode::from_str("dark"), ThemeMode::Dark);
        assert_eq!(ThemeMode::from_str("system"), ThemeMode::System);
        assert_eq!(ThemeMode::from_str("unknown"), ThemeMode::System);
    }

    #[test]
    fn test_theme_mode_display() {
        assert_eq!(ThemeMode::Light.display_name(), "浅色");
        assert_eq!(ThemeMode::Dark.display_name_en(), "Dark");
    }

    #[test]
    fn test_theme_manager() {
        let mut manager = ThemeManager::new();
        assert_eq!(manager.mode(), ThemeMode::System);

        manager.set_mode(ThemeMode::Dark);
        assert!(manager.is_dark());

        manager.set_mode(ThemeMode::Light);
        assert!(!manager.is_dark());
    }

    #[test]
    fn test_all_modes() {
        assert_eq!(ThemeMode::all().len(), 3);
    }
}

//! 跨平台自动启动抽象
//!
//! 统一处理不同平台的开机自启动能力
//!
//! # 平台实现
//!
//! | 平台 | 机制 | 配置文件/注册表位置 |
//! |------|------|------------------|
//! | macOS | Login Items (System Settings) | ~/Library/Application Support/com.apple.sharing.launchd/ |
//! | Windows | Registry Run key | HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run |
//! | Linux | systemd User unit / XDG Autostart | ~/.config/systemd/user/ 或 ~/.config/autostart/ |

use crate::paths;
use std::path::PathBuf;

/// 自动启动提供者 trait
pub trait AutostartProvider {
    /// 检查是否已启用自动启动
    fn is_enabled(&self) -> bool;

    /// 启用自动启动
    fn enable(&self) -> crate::Result<()>;

    /// 禁用自动启动
    fn disable(&self) -> crate::Result<()>;

    /// 获取自动启动文件/注册表路径
    fn get_path(&self) -> Option<PathBuf>;
}

/// 自动启动状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartState {
    Enabled,
    Disabled,
    Unknown,
}

/// 自动启动管理器
pub struct AutostartManager<P: AutostartProvider> {
    provider: P,
}

impl<P: AutostartProvider> AutostartManager<P> {
    #[inline]
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    /// 获取当前状态
    #[inline]
    pub fn state(&self) -> AutostartState {
        match self.provider.is_enabled() {
            true => AutostartState::Enabled,
            false => AutostartState::Disabled,
        }
    }

    /// 是否已启用
    #[inline]
    pub fn is_enabled(&self) -> bool {
        self.provider.is_enabled()
    }

    /// 启用
    #[inline]
    pub fn enable(&self) -> crate::Result<()> {
        self.provider.enable()
    }

    /// 禁用
    #[inline]
    pub fn disable(&self) -> crate::Result<()> {
        self.provider.disable()
    }

    /// 获取路径
    #[inline]
    pub fn path(&self) -> Option<PathBuf> {
        self.provider.get_path()
    }

    /// 切换状态
    #[inline]
    pub fn toggle(&self) -> crate::Result<AutostartState> {
        if self.is_enabled() {
            self.disable()?;
            Ok(AutostartState::Disabled)
        } else {
            self.enable()?;
            Ok(AutostartState::Enabled)
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::fs;

    const SERVICE_NAME: &str = "com.nuwax.agent";

    impl AutostartProvider for PlatformAutostart {
        fn is_enabled(&self) -> bool {
            // 检查 Login Items plist 是否存在
            let plist_path = dirs::home_dir()
                .map(|h| h.join("Library/Application Support/com.apple.sharing.launchd/"))
                .filter(|p| p.exists())
                .and_then(|p| {
                    let file = format!("{}.plist", SERVICE_NAME);
                    Some(p.join(file))
                });

            if let Some(path) = plist_path {
                return path.exists();
            }
            false
        }

        fn enable(&self) -> crate::Result<()> {
            let plist_dir = dirs::home_dir()
                .ok_or_else(|| crate::Error::msg("Cannot find home directory"))?
                .join("Library/Application Support/com.apple.sharing.launchd/");

            if !plist_dir.exists() {
                fs::create_dir_all(&plist_dir)?;
            }

            let plist_path = plist_dir.join(format!("{}.plist", SERVICE_NAME));
            let plist_content = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>RunAtLoad</key>
    <true/>
    <key>Label</key>
    <string>com.nuwax.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/nuwax-agent.app/Contents/MacOS/nuwax-agent</string>
    </array>
</dict>
</plist>"#;

            // 注意：macOS 推荐使用 macos_app_links 或手动添加 Login Items
            // 这里生成 plist，实际添加需要用户手动操作或使用 AppleScript
            fs::write(&plist_path, plist_content)?;
            Ok(())
        }

        fn disable(&self) -> crate::Result<()> {
            let plist_path = dirs::home_dir()
                .ok_or_else(|| crate::Error::msg("Cannot find home directory"))?
                .join("Library/Application Support/com.apple.sharing.launchd/")
                .join(format!("{}.plist", SERVICE_NAME));

            if plist_path.exists() {
                fs::remove_file(&plist_path)?;
            }
            Ok(())
        }

        fn get_path(&self) -> Option<PathBuf> {
            dirs::home_dir().map(|h| {
                h.join("Library/Application Support/com.apple.sharing.launchd/")
                    .join(format!("{}.plist", SERVICE_NAME))
            })
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use winreg::enums::*;
    use winreg::RegKey;

    const REG_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE_NAME: &str = "nuwax-agent";

    impl AutostartProvider for PlatformAutostart {
        fn is_enabled(&self) -> bool {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(key) = hkcu.open_subkey(REG_KEY) {
                if let Ok(_) = key.get_value::<String, _>(VALUE_NAME) {
                    return true;
                }
            }
            false
        }

        fn enable(&self) -> crate::Result<()> {
            let exe_path = std::env::current_exe()
                .map_err(|e| crate::Error::msg(format!("Failed to get exe path: {}", e)))?;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let key = hkcu.open_subkey_with_flags(REG_KEY, KEY_WRITE)?;
            key.set_value(VALUE_NAME, &exe_path.to_string_lossy().to_string())?;
            Ok(())
        }

        fn disable(&self) -> crate::Result<()> {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let key = hkcu.open_subkey_with_flags(REG_KEY, KEY_WRITE)?;
            if let Ok(_) = key.delete_value(VALUE_NAME) {
                // Value deleted
            }
            Ok(())
        }

        fn get_path(&self) -> Option<PathBuf> {
            Some(PathBuf::from(REG_KEY))
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    const DESKTOP_FILE: &str = "nuwax-agent.desktop";
    const SYSTEMD_SERVICE: &str = "nuwax-agent.service";

    impl AutostartProvider for PlatformAutostart {
        fn is_enabled(&self) -> bool {
            // 检查 XDG Autostart
            let autostart_path = xdg::BaseDirectories::new()
                .ok()?
                .get_data_home()
                .join("autostart")
                .join(DESKTOP_FILE);

            // 检查 systemd user
            let systemd_path = xdg::BaseDirectories::new()
                .ok()?
                .get_data_home()
                .join("systemd")
                .join(SYSTEMD_SERVICE);

            autostart_path.exists() || systemd_path.exists()
        }

        fn enable(&self) -> crate::Result<()> {
            let exe_path = std::env::current_exe()
                .map_err(|e| crate::Error::msg(format!("Failed to get exe path: {}", e)))?;

            // 创建 XDG Autostart desktop file
            let autostart_dir = xdg::BaseDirectories::new()
                .map_err(|e| crate::Error::msg(format!("Failed to get xdg dirs: {}", e)))?
                .get_data_home()
                .join("autostart");

            std::fs::create_dir_all(&autostart_dir)?;

            let desktop_file = autostart_dir.join(DESKTOP_FILE);
            let content = format!(
                r#"[Desktop Entry]
Type=Application
Name=NuWax Agent
Exec={}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
"#,
                exe_path.to_string_lossy()
            );

            std::fs::write(&desktop_file, content)?;
            Ok(())
        }

        fn disable(&self) -> crate::Result<()> {
            let autostart_path = xdg::BaseDirectories::new()
                .ok()?
                .get_data_home()
                .join("autostart")
                .join(DESKTOP_FILE);

            if autostart_path.exists() {
                std::fs::remove_file(&autostart_path)?;
            }
            Ok(())
        }

        fn get_path(&self) -> Option<PathBuf> {
            xdg::BaseDirectories::new()
                .ok()?
                .get_data_home()
                .join("autostart")
                .join(DESKTOP_FILE)
                .into()
        }
    }
}

/// 平台自动启动实现
pub struct PlatformAutostart;

impl AutostartProvider for PlatformAutostart {
    #[cfg(target_os = "macos")]
    fn is_enabled(&self) -> bool {
        let m = PlatformAutostart;
        m.is_enabled()
    }

    #[cfg(target_os = "windows")]
    fn is_enabled(&self) -> bool {
        let m = PlatformAutostart;
        m.is_enabled()
    }

    #[cfg(target_os = "linux")]
    fn is_enabled(&self) -> bool {
        let m = PlatformAutostart;
        m.is_enabled()
    }

    #[cfg(target_os = "macos")]
    fn enable(&self) -> crate::Result<()> {
        let m = PlatformAutostart;
        m.enable()
    }

    #[cfg(target_os = "windows")]
    fn enable(&self) -> crate::Result<()> {
        let m = PlatformAutostart;
        m.enable()
    }

    #[cfg(target_os = "linux")]
    fn enable(&self) -> crate::Result<()> {
        let m = PlatformAutostart;
        m.enable()
    }

    #[cfg(target_os = "macos")]
    fn disable(&self) -> crate::Result<()> {
        let m = PlatformAutostart;
        m.disable()
    }

    #[cfg(target_os = "windows")]
    fn disable(&self) -> crate::Result<()> {
        let m = PlatformAutostart;
        m.disable()
    }

    #[cfg(target_os = "linux")]
    fn disable(&self) -> crate::Result<()> {
        let m = PlatformAutostart;
        m.disable()
    }

    fn get_path(&self) -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        {
            let m = PlatformAutostart;
            m.get_path()
        }
        #[cfg(target_os = "windows")]
        {
            let m = PlatformAutostart;
            m.get_path()
        }
        #[cfg(target_os = "linux")]
        {
            let m = PlatformAutostart;
            m.get_path()
        }
    }
}

/// 创建自动启动管理器
#[inline]
pub fn autostart() -> AutostartManager<PlatformAutostart> {
    AutostartManager::new(PlatformAutostart)
}

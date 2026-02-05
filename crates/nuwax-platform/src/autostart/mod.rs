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

use crate::Error;
use std::path::PathBuf;

/// 自动启动状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartState {
    Enabled,
    Disabled,
    Unknown,
}

/// 平台自动启动实现
#[derive(Debug)]
pub struct PlatformAutostart {
    // 平台特定数据
    #[cfg(target_os = "macos")]
    service_name: &'static str,
    
    #[cfg(target_os = "windows")]
    reg_key: &'static str,
    
    #[cfg(target_os = "linux")]
    desktop_file: &'static str,
}

impl PlatformAutostart {
    /// 创建新的 PlatformAutostart 实例
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            service_name: "com.nuwax.agent",
            
            #[cfg(target_os = "windows")]
            reg_key: r"Software\Microsoft\Windows\CurrentVersion\Run",
            
            #[cfg(target_os = "linux")]
            desktop_file: "nuwax-agent.desktop",
        }
    }

    /// 检查是否已启用自动启动
    pub fn is_enabled(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            let Some(home) = dirs::home_dir() else { return false };
            let plist_path = home
                .join("Library/Application Support/com.apple.sharing.launchd/")
                .join(format!("{}.plist", self.service_name));
            plist_path.exists()
        }

        #[cfg(target_os = "windows")]
        {
            let Ok(hkcu) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER) else { return false };
            let Ok(key) = hkcu.open_subkey(self.reg_key) else { return false };
            key.get_value::<String, _>("nuwax-agent").is_ok()
        }

        #[cfg(target_os = "linux")]
        {
            let Ok(xdg) = xdg::BaseDirectories::new() else { return false };
            let autostart_path = xdg.get_data_home().join("autostart").join(self.desktop_file);
            autostart_path.exists()
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }

    /// 启用自动启动
    pub fn enable(&self) -> Result<(), Error> {
        #[cfg(target_os = "macos")]
        {
            use std::fs;
            let Some(home) = dirs::home_dir() else {
                return Err(Error::Config("Cannot find home directory".to_string()));
            };
            let plist_dir = home.join("Library/Application Support/com.apple.sharing.launchd/");
            if !plist_dir.exists() {
                fs::create_dir_all(&plist_dir)?;
            }
            let plist_path = plist_dir.join(format!("{}.plist", self.service_name));
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
            fs::write(&plist_path, plist_content)?;
            Ok(())
        }

        #[cfg(target_os = "windows")]
        {
            let exe_path = std::env::current_exe()
                .map_err(|e| Error::Platform(format!("Failed to get exe path: {}", e)))?;
            let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
            let key = hkcu.open_subkey_with_flags(self.reg_key, winreg::enums::KEY_WRITE)?;
            key.set_value("nuwax-agent", &exe_path.to_string_lossy().to_string())?;
            Ok(())
        }

        #[cfg(target_os = "linux")]
        {
            let exe_path = std::env::current_exe()
                .map_err(|e| Error::Platform(format!("Failed to get exe path: {}", e)))?;
            let xdg = xdg::BaseDirectories::new()
                .map_err(|e| Error::Config(format!("Failed to get xdg dirs: {}", e)))?;
            let autostart_dir = xdg.get_data_home().join("autostart");
            std::fs::create_dir_all(&autostart_dir)?;
            let desktop_file = autostart_dir.join(self.desktop_file);
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

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err(Error::Platform("Unsupported platform".to_string()))
        }
    }

    /// 禁用自动启动
    pub fn disable(&self) -> Result<(), Error> {
        #[cfg(target_os = "macos")]
        {
            use std::fs;
            let Some(home) = dirs::home_dir() else {
                return Err(Error::Config("Cannot find home directory".to_string()));
            };
            let plist_path = home
                .join("Library/Application Support/com.apple.sharing.launchd/")
                .join(format!("{}.plist", self.service_name));
            if plist_path.exists() {
                fs::remove_file(&plist_path)?;
            }
            Ok(())
        }

        #[cfg(target_os = "windows")]
        {
            let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
            let key = hkcu.open_subkey_with_flags(self.reg_key, winreg::enums::KEY_WRITE)?;
            let _ = key.delete_value("nuwax-agent");
            Ok(())
        }

        #[cfg(target_os = "linux")]
        {
            let Ok(xdg) = xdg::BaseDirectories::new() else {
                return Err(Error::Config("Failed to get xdg dirs".to_string()));
            };
            let autostart_path = xdg.get_data_home().join("autostart").join(self.desktop_file);
            if autostart_path.exists() {
                std::fs::remove_file(&autostart_path)?;
            }
            Ok(())
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err(Error::Platform("Unsupported platform".to_string()))
        }
    }

    /// 获取自动启动文件/注册表路径
    pub fn path(&self) -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        {
            dirs::home_dir().map(|h| {
                h.join("Library/Application Support/com.apple.sharing.launchd/")
                    .join(format!("{}.plist", self.service_name))
            })
        }

        #[cfg(target_os = "windows")]
        {
            Some(PathBuf::from(self.reg_key))
        }

        #[cfg(target_os = "linux")]
        {
            xdg::BaseDirectories::new()
                .ok()?
                .get_data_home()
                .join("autostart")
                .join(self.desktop_file)
                .into()
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            None
        }
    }
}

impl Default for PlatformAutostart {
    fn default() -> Self {
        Self::new()
    }
}

/// 创建自动启动管理器
#[inline]
pub fn autostart() -> PlatformAutostart {
    PlatformAutostart::new()
}

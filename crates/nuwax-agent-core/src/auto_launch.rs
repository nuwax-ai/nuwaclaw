//! 开机自启动管理模块
//!
//! 支持跨平台开机自启动功能

use thiserror::Error;

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

/// 开机自启动管理器
pub struct AutoLaunchManager {
    /// 应用名称
    app_name: String,
    /// 应用路径
    app_path: String,
}

impl AutoLaunchManager {
    /// 创建新的开机自启动管理器
    pub fn new() -> Result<Self, AutoLaunchError> {
        let app_name = std::env::current_exe()
            .ok()
            .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
            .unwrap_or_else(|| "nuwax-agent".to_string());

        let app_path = std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .ok()
            .ok_or_else(|| AutoLaunchError::EnableFailed("无法获取应用路径".to_string()))?;

        Ok(Self { app_name, app_path })
    }

    /// 启用开机自启动
    pub async fn enable(&self) -> Result<(), AutoLaunchError> {
        #[cfg(target_os = "macos")]
        {
            use crate::utils::CommandNoWindowExt;
            use std::process::Command;
            let launch_agents_dir = dirs::home_dir()
                .ok_or_else(|| AutoLaunchError::EnableFailed("无法获取 home 目录".to_string()))?
                .join("Library/LaunchAgents");
            let plist_path = launch_agents_dir.join(format!("com.nuwax.{}.plist", self.app_name));

            let plist_content = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nuwax.{}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>"#,
                self.app_name, self.app_path
            );

            std::fs::create_dir_all(&launch_agents_dir)
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
            std::fs::write(&plist_path, plist_content)
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;

            Command::new("launchctl")
                .no_window()
                .args(["load", "-w", &plist_path.to_string_lossy()])
                .output()
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
        }

        #[cfg(target_os = "windows")]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (key, _) = hkcu
                .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
            key.set_value("NuWaxAgent", &format!("\"{}\"", self.app_path))
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
        }

        #[cfg(target_os = "linux")]
        {
            let desktop_entry_dir = dirs::config_dir()
                .ok_or_else(|| AutoLaunchError::EnableFailed("无法获取配置目录".to_string()))?
                .join("autostart");
            let desktop_entry_path = desktop_entry_dir.join("nuwax-agent.desktop");

            let desktop_entry = format!(
                r#"[Desktop Entry]
Type=Application
Name=Nuwax Agent
Exec={}
Terminal=false
X-GNOME-Autostart-enabled=true
"#,
                self.app_path
            );

            std::fs::create_dir_all(&desktop_entry_dir)
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
            std::fs::write(&desktop_entry_path, desktop_entry)
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
        }

        Ok(())
    }

    /// 禁用开机自启动
    pub async fn disable(&self) -> Result<(), AutoLaunchError> {
        #[cfg(target_os = "macos")]
        {
            use crate::utils::CommandNoWindowExt;
            use std::process::Command;
            let plist_path = dirs::home_dir()
                .ok_or_else(|| AutoLaunchError::DisableFailed("无法获取 home 目录".to_string()))?
                .join(format!(
                    "Library/LaunchAgents/com.nuwax.{}.plist",
                    self.app_name
                ));

            if plist_path.exists() {
                Command::new("launchctl")
                    .no_window()
                    .args(["unload", "-w", &plist_path.to_string_lossy()])
                    .output()
                    .ok();
                std::fs::remove_file(&plist_path)
                    .map_err(|e| AutoLaunchError::DisableFailed(e.to_string()))?;
            }
        }

        #[cfg(target_os = "windows")]
        {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};
            use winreg::RegKey;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(key) = hkcu
                .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", KEY_WRITE)
            {
                let _ = key.delete_value("NuWaxAgent");
            }
        }

        #[cfg(target_os = "linux")]
        {
            let desktop_entry_path = dirs::config_dir()
                .ok_or_else(|| AutoLaunchError::DisableFailed("无法获取配置目录".to_string()))?
                .join("autostart/nuwax-agent.desktop");
            if desktop_entry_path.exists() {
                std::fs::remove_file(&desktop_entry_path)
                    .map_err(|e| AutoLaunchError::DisableFailed(e.to_string()))?;
            }
        }

        Ok(())
    }

    /// 检查是否已启用开机自启动
    pub async fn is_enabled(&self) -> Result<bool, AutoLaunchError> {
        #[cfg(target_os = "macos")]
        {
            use crate::utils::CommandNoWindowExt;
            use std::process::Command;
            let output = Command::new("launchctl")
                .no_window()
                .args(["list", &format!("com.nuwax.{}", self.app_name)])
                .output()
                .map_err(|e| AutoLaunchError::StatusCheckFailed(e.to_string()))?;
            Ok(output.status.success())
        }

        #[cfg(target_os = "windows")]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(key) = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") {
                Ok(key.get_value::<String, _>("NuWaxAgent").is_ok())
            } else {
                Ok(false)
            }
        }

        #[cfg(target_os = "linux")]
        {
            let desktop_entry_path = dirs::config_dir()
                .map(|d| d.join("autostart/nuwax-agent.desktop"))
                .unwrap_or_default();
            Ok(desktop_entry_path.exists())
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Ok(false)
        }
    }
}

impl Default for AutoLaunchManager {
    fn default() -> Self {
        Self::new().unwrap_or_else(|_| Self {
            app_name: "nuwax-agent".to_string(),
            app_path: String::new(),
        })
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

    #[test]
    fn test_auto_launch_manager_default() {
        let manager = AutoLaunchManager::default();
        // default() uses new() which derives app_name from the current executable
        // In test environment the binary name differs, so just check it's non-empty
        assert!(!manager.app_name.is_empty());
    }

    #[test]
    fn test_auto_launch_manager_has_app_path() {
        let manager = AutoLaunchManager::new().unwrap();
        // app_path 在正常环境应非空（指向当前可执行文件）
        assert!(!manager.app_path.is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_linux_autostart_path_is_user_level() {
        // 验证 Linux 自启动配置写入用户目录而非系统目录
        let config_dir = dirs::config_dir().expect("config_dir should exist");
        let autostart_path = config_dir.join("autostart/nuwax-agent.desktop");
        let path_str = autostart_path.to_string_lossy();

        // 不应使用系统级别路径
        assert!(!path_str.starts_with("/etc/xdg"));
        // 应在用户配置目录下
        assert!(path_str.contains(".config/autostart") || path_str.contains("config/autostart"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_macos_plist_path_uses_dirs() {
        let home = dirs::home_dir().expect("home_dir should exist");
        let plist_path = home.join("Library/LaunchAgents");
        // 验证路径构造正确
        assert!(plist_path
            .to_string_lossy()
            .contains("Library/LaunchAgents"));
    }
}

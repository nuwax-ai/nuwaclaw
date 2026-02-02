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
            use std::process::Command;
            let launch_agents_dir = std::env::home_dir()
                .ok_or_else(|| AutoLaunchError::EnableFailed("无法获取 home 目录".to_string()))?
                .join("Library/LaunchAgents");
            let plist_path = launch_agents_dir.join(&format!("com.nuwax.{}.plist", self.app_name));

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
                .args(&["load", "-w", &plist_path.to_string_lossy()])
                .output()
                .map_err(|e| AutoLaunchError::EnableFailed(e.to_string()))?;
        }

        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::System::Registry::{
                RegSetValueExW, RegCreateKeyExW, RegCloseKey, HKEY_CURRENT_USER,
                KEY_WRITE, REG_SZ,
            };

            let key_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
            let value_name = format!("NuWaxAgent");
            let value_data: Vec<u16> = format!("\"{}\"", self.app_path)
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();

            unsafe {
                let mut hkey: windows_sys::Win32::System::Registry::HKEY = 0;
                if RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    key_path.as_ptr() as *const u16,
                    0,
                    None,
                    0,
                    KEY_WRITE,
                    None,
                    &mut hkey,
                    None,
                ) == 0 {
                    RegSetValueExW(
                        hkey,
                        value_name.encode_utf16().collect::<Vec<u16>>().as_ptr(),
                        0,
                        REG_SZ,
                        value_data.as_ptr() as *const u8,
                        (value_data.len() * 2) as u32,
                    );
                    RegCloseKey(hkey);
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            let desktop_entry_dir = std::path::PathBuf::from("/etc/xdg/autostart");
            let desktop_entry_path = desktop_entry_dir.join(&format!("nuwax-agent.desktop"));

            let desktop_entry = format!(
                r#"[Desktop Entry]
Type=Application
Name=NuWax Agent
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
            use std::process::Command;
            let plist_path = std::env::home_dir()
                .ok_or_else(|| AutoLaunchError::DisableFailed("无法获取 home 目录".to_string()))?
                .join(format!("Library/LaunchAgents/com.nuwax.{}.plist", self.app_name));

            if plist_path.exists() {
                Command::new("launchctl")
                    .args(&["unload", "-w", &plist_path.to_string_lossy()])
                    .output()
                    .ok();
                std::fs::remove_file(&plist_path)
                    .map_err(|e| AutoLaunchError::DisableFailed(e.to_string()))?;
            }
        }

        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::System::Registry::{
                RegDeleteValueW, RegOpenKeyExW, HKEY_CURRENT_USER, KEY_WRITE,
            };

            let key_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
            let value_name: Vec<u16> = "NuWaxAgent".encode_utf16().chain(std::iter::once(0)).collect();

            unsafe {
                let mut hkey: windows_sys::Win32::System::Registry::HKEY = 0;
                if RegOpenKeyExW(HKEY_CURRENT_USER, key_path.as_ptr() as *const u16, 0, KEY_WRITE, &mut hkey) == 0 {
                    RegDeleteValueW(hkey, value_name.as_ptr());
                    RegCloseKey(hkey);
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            let desktop_entry_path = std::path::PathBuf::from("/etc/xdg/autostart/nuwax-agent.desktop");
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
            use std::process::Command;
            let output = Command::new("launchctl")
                .args(&["list", &format!("com.nuwax.{}", self.app_name)])
                .output()
                .map_err(|e| AutoLaunchError::StatusCheckFailed(e.to_string()))?;
            Ok(output.status.success())
        }

        #[cfg(target_os = "windows")]
        {
            use windows_sys::Win32::System::Registry::{
                RegGetValueW, RegOpenKeyExW, HKEY_CURRENT_USER, KEY_READ, REG_SZ,
            };

            let key_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
            let value_name: Vec<u16> = "NuWaxAgent".encode_utf16().chain(std::iter::once(0)).collect();

            let mut value_data = [0u16; 1024];
            let mut data_size = 1024u32;

            unsafe {
                let mut hkey: windows_sys::Win32::System::Registry::HKEY = 0;
                if RegOpenKeyExW(HKEY_CURRENT_USER, key_path.as_ptr() as *const u16, 0, KEY_READ, &mut hkey) == 0 {
                    let result = RegGetValueW(
                        hkey,
                        None,
                        value_name.as_ptr(),
                        REG_SZ,
                        None,
                        value_data.as_ptr() as *mut u8,
                        &mut data_size,
                    );
                    RegCloseKey(hkey);
                    Ok(result == 0)
                } else {
                    Ok(false)
                }
            }
        }

        #[cfg(target_os = "linux")]
        {
            let desktop_entry_path = std::path::PathBuf::from("/etc/xdg/autostart/nuwax-agent.desktop");
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
}

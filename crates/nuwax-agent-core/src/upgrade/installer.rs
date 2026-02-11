//! 安装逻辑

use std::path::Path;
use tracing::{info, warn};

use crate::utils::CommandNoWindowExt;

use super::error::UpgradeError;

/// 安装管理器
pub struct Installer;

impl Installer {
    /// 安装更新（平台特定）
    pub async fn install(download_path: &Path) -> Result<(), UpgradeError> {
        info!("Installing update from: {}", download_path.display());

        let os = std::env::consts::OS;
        match os {
            "macos" => Self::install_macos(download_path).await,
            "windows" => Self::install_windows(download_path).await,
            "linux" => Self::install_linux(download_path).await,
            _ => Err(UpgradeError::InstallFailed(format!(
                "Unsupported platform: {}",
                os
            ))),
        }
    }

    /// macOS 安装：mount DMG -> copy .app -> unmount
    async fn install_macos(path: &Path) -> Result<(), UpgradeError> {
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match extension {
            "dmg" => {
                info!("Installing DMG: {}", path.display());

                // 1. Mount DMG and capture the mount point
                let output = tokio::process::Command::new("hdiutil")
                    .no_window()
                    .args(["attach", "-nobrowse", "-noverify", "-noautoopen", "-plist"])
                    .arg(path)
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    return Err(UpgradeError::InstallFailed(format!(
                        "Failed to mount DMG: {}",
                        String::from_utf8_lossy(&output.stderr)
                    )));
                }

                // 2. Parse plist output to find mount point
                let plist_output = String::from_utf8_lossy(&output.stdout);
                let mount_point = Self::parse_dmg_mount_point(&plist_output).ok_or_else(|| {
                    UpgradeError::InstallFailed("Could not determine DMG mount point".to_string())
                })?;

                info!("DMG mounted at: {}", mount_point);

                // 3. Find .app in mounted volume
                let volume_path = Path::new(&mount_point);
                let app_path = Self::find_app_in_volume(volume_path).await?;

                info!("Found app: {}", app_path.display());

                // 4. Get app name and destination
                let app_name = app_path
                    .file_name()
                    .ok_or_else(|| UpgradeError::InstallFailed("Invalid app path".to_string()))?;
                let dest_path = Path::new("/Applications").join(app_name);

                // 5. Remove old app if exists
                if dest_path.exists() {
                    info!("Removing old app: {}", dest_path.display());
                    tokio::fs::remove_dir_all(&dest_path).await.map_err(|e| {
                        UpgradeError::InstallFailed(format!("Failed to remove old app: {}", e))
                    })?;
                }

                // 6. Copy new app to /Applications
                info!("Copying {} to /Applications", app_name.to_string_lossy());
                let copy_status = tokio::process::Command::new("cp")
                    .no_window()
                    .args(["-R"])
                    .arg(&app_path)
                    .arg("/Applications/")
                    .status()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !copy_status.success() {
                    // Cleanup: unmount before returning error
                    let _ = Self::unmount_dmg(&mount_point).await;
                    return Err(UpgradeError::InstallFailed(
                        "Failed to copy app to /Applications".to_string(),
                    ));
                }

                // 7. Unmount DMG
                Self::unmount_dmg(&mount_point).await?;

                info!("DMG install completed: {}", dest_path.display());
                Ok(())
            }
            "zip" => {
                info!("Extracting ZIP: {}", path.display());
                let dest = path.parent().unwrap_or(Path::new("/tmp"));
                let file = std::fs::File::open(path)?;
                let mut archive = zip::ZipArchive::new(file)
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                // Extract to temp location
                archive
                    .extract(dest)
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                // Find and copy .app to /Applications
                let app_path = Self::find_app_in_volume(dest).await?;
                let app_name = app_path
                    .file_name()
                    .ok_or_else(|| UpgradeError::InstallFailed("Invalid app path".to_string()))?;
                let dest_app = Path::new("/Applications").join(app_name);

                // Remove old app if exists
                if dest_app.exists() {
                    tokio::fs::remove_dir_all(&dest_app).await.map_err(|e| {
                        UpgradeError::InstallFailed(format!("Failed to remove old app: {}", e))
                    })?;
                }

                // Move extracted app to /Applications
                match tokio::fs::rename(&app_path, &dest_app).await {
                    Ok(()) => {
                        info!("ZIP install completed: {}", dest_app.display());
                    }
                    Err(_) => {
                        // If rename fails (cross-device), use cp -R
                        let status = tokio::process::Command::new("cp")
                            .no_window()
                            .args(["-R"])
                            .arg(&app_path)
                            .arg("/Applications/")
                            .status()
                            .await
                            .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                        if status.success() {
                            // Remove source after successful copy
                            let _ = tokio::fs::remove_dir_all(&app_path).await;
                            info!("ZIP install completed: {}", dest_app.display());
                        } else {
                            return Err(UpgradeError::InstallFailed(
                                "Failed to copy app".to_string(),
                            ));
                        }
                    }
                }

                Ok(())
            }
            _ => Err(UpgradeError::InstallFailed(format!(
                "Unsupported file format: {}",
                extension
            ))),
        }
    }

    /// 解析 hdiutil attach plist 输出，提取挂载点
    fn parse_dmg_mount_point(plist_output: &str) -> Option<String> {
        // plist 格式包含 <key>mount-point</key><string>/Volumes/xxx</string>
        // 简单的字符串匹配
        let mount_point_key = "<key>mount-point</key>";
        if let Some(pos) = plist_output.find(mount_point_key) {
            let after_key = &plist_output[pos + mount_point_key.len()..];
            if let Some(start) = after_key.find("<string>") {
                let value_start = &after_key[start + 8..];
                if let Some(end) = value_start.find("</string>") {
                    return Some(value_start[..end].to_string());
                }
            }
        }
        None
    }

    /// 在 volume 中查找 .app 文件
    async fn find_app_in_volume(volume_path: &Path) -> Result<std::path::PathBuf, UpgradeError> {
        let mut entries = tokio::fs::read_dir(volume_path)
            .await
            .map_err(|e| UpgradeError::InstallFailed(format!("Failed to read volume: {}", e)))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?
        {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext == "app" {
                    return Ok(path);
                }
            }
        }

        Err(UpgradeError::InstallFailed(
            "No .app found in volume".to_string(),
        ))
    }

    /// 卸载 DMG
    async fn unmount_dmg(mount_point: &str) -> Result<(), UpgradeError> {
        info!("Unmounting DMG: {}", mount_point);
        let output = tokio::process::Command::new("hdiutil")
            .no_window()
            .args(["detach", "-quiet"])
            .arg(mount_point)
            .output()
            .await
            .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

        if !output.status.success() {
            warn!(
                "Failed to unmount DMG (non-fatal): {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        Ok(())
    }

    /// Windows 安装：MSI silent install
    async fn install_windows(path: &Path) -> Result<(), UpgradeError> {
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match extension {
            "msi" => {
                info!("Installing MSI: {}", path.display());
                let output = tokio::process::Command::new("msiexec")
                    .no_window()
                    .args(["/i", &path.to_string_lossy(), "/quiet", "/norestart"])
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    return Err(UpgradeError::InstallFailed(format!(
                        "MSI install failed with exit code: {:?}",
                        output.status.code()
                    )));
                }
                info!("MSI install completed");
                Ok(())
            }
            "exe" => {
                info!("Running installer: {}", path.display());
                let output = tokio::process::Command::new(path)
                    .no_window()
                    .args(["/S"]) // Silent mode (NSIS convention)
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    return Err(UpgradeError::InstallFailed(format!(
                        "Installer failed with exit code: {:?}",
                        output.status.code()
                    )));
                }
                Ok(())
            }
            _ => Err(UpgradeError::InstallFailed(format!(
                "Unsupported file format: {}",
                extension
            ))),
        }
    }

    /// Linux 安装：dpkg / AppImage replace
    async fn install_linux(path: &Path) -> Result<(), UpgradeError> {
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match extension {
            "deb" => {
                info!("Installing DEB: {}", path.display());
                let output = tokio::process::Command::new("sudo")
                    .no_window()
                    .args(["dpkg", "-i"])
                    .arg(path)
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(UpgradeError::InstallFailed(format!(
                        "dpkg install failed: {}",
                        stderr
                    )));
                }
                info!("DEB install completed");
                Ok(())
            }
            "AppImage" | "appimage" => {
                info!("Replacing AppImage: {}", path.display());
                let current_exe = std::env::current_exe()?;

                // 备份当前文件
                let backup = current_exe.with_extension("bak");
                std::fs::rename(&current_exe, &backup)?;

                // 复制新文件
                std::fs::copy(path, &current_exe)?;

                // 设置可执行权限
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let perms = std::fs::Permissions::from_mode(0o755);
                    std::fs::set_permissions(&current_exe, perms)?;
                }

                info!("AppImage replaced successfully");
                Ok(())
            }
            _ => Err(UpgradeError::InstallFailed(format!(
                "Unsupported file format: {}",
                extension
            ))),
        }
    }

    /// 请求应用重启
    pub fn request_restart() {
        info!("Requesting application restart for update");
        // 通知应用层需要重启
        // 应用层应监听此信号并优雅退出后重新启动
    }
}

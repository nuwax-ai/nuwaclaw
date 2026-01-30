//! 升级检查模块
//!
//! 检查和管理客户端版本升级

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, debug, warn};
use std::path::{Path, PathBuf};

/// 升级错误
#[derive(Error, Debug)]
pub enum UpgradeError {
    #[error("检查更新失败: {0}")]
    CheckFailed(String),
    #[error("下载失败: {0}")]
    DownloadFailed(String),
    #[error("安装失败: {0}")]
    InstallFailed(String),
    #[error("校验失败: {0}")]
    VerifyFailed(String),
    #[error("网络错误: {0}")]
    NetworkError(String),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}

/// 版本信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    /// 版本号
    pub version: String,
    /// 更新说明
    pub release_notes: String,
    /// 下载 URL
    pub download_url: String,
    /// 文件大小（字节）
    pub file_size: u64,
    /// 发布日期
    pub release_date: String,
    /// 是否强制更新
    pub mandatory: bool,
    /// SHA256 校验和
    #[serde(default)]
    pub sha256: String,
}

/// 更新状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateStatus {
    /// 未检查
    Unknown,
    /// 检查中
    Checking,
    /// 已是最新
    UpToDate,
    /// 有可用更新
    UpdateAvailable(String),
    /// 下载中
    Downloading(u8),
    /// 准备安装
    ReadyToInstall,
    /// 检查失败
    Failed(String),
}

/// 升级管理器
pub struct UpgradeManager {
    /// 当前版本
    current_version: String,
    /// 更新检查 URL
    check_url: String,
    /// 更新状态
    status: UpdateStatus,
    /// 最新版本信息
    latest_version: Option<VersionInfo>,
    /// 下载文件路径
    download_path: Option<PathBuf>,
}

impl Default for UpgradeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl UpgradeManager {
    /// 创建新的升级管理器
    pub fn new() -> Self {
        Self {
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            check_url: "https://api.github.com/repos/nuwax/nuwax-agent/releases/latest".to_string(),
            status: UpdateStatus::Unknown,
            latest_version: None,
            download_path: None,
        }
    }

    /// 设置检查 URL
    pub fn with_check_url(mut self, url: impl Into<String>) -> Self {
        self.check_url = url.into();
        self
    }

    /// 获取当前版本
    pub fn current_version(&self) -> &str {
        &self.current_version
    }

    /// 获取更新状态
    pub fn status(&self) -> &UpdateStatus {
        &self.status
    }

    /// 获取最新版本信息
    pub fn latest_version(&self) -> Option<&VersionInfo> {
        self.latest_version.as_ref()
    }

    /// 检查更新
    pub async fn check_update(&mut self) -> Result<bool, UpgradeError> {
        self.status = UpdateStatus::Checking;
        info!("Checking for updates... current: {}", self.current_version);

        // 获取最新版本信息
        match self.fetch_latest_version().await {
            Ok(version_info) => {
                let has_update = self.compare_versions(&version_info.version);

                if has_update {
                    info!("Update available: {} -> {}", self.current_version, version_info.version);
                    self.status = UpdateStatus::UpdateAvailable(version_info.version.clone());
                    self.latest_version = Some(version_info);
                } else {
                    info!("Already up to date: {}", self.current_version);
                    self.status = UpdateStatus::UpToDate;
                }

                Ok(has_update)
            }
            Err(e) => {
                self.status = UpdateStatus::Failed(e.to_string());
                Err(e)
            }
        }
    }

    /// 获取最新版本信息（从远程）
    async fn fetch_latest_version(&self) -> Result<VersionInfo, UpgradeError> {
        debug!("Fetching latest version from: {}", self.check_url);

        #[cfg(feature = "dependency-management")]
        {
            let response = reqwest::get(&self.check_url)
                .await
                .map_err(|e| UpgradeError::NetworkError(e.to_string()))?;

            if !response.status().is_success() {
                return Err(UpgradeError::CheckFailed(format!(
                    "HTTP {}", response.status()
                )));
            }

            // GitHub release API 响应格式
            let release: serde_json::Value = response
                .json()
                .await
                .map_err(|e| UpgradeError::CheckFailed(e.to_string()))?;

            let tag_name = release["tag_name"]
                .as_str()
                .unwrap_or("")
                .trim_start_matches('v')
                .to_string();

            let body = release["body"].as_str().unwrap_or("").to_string();
            let published_at = release["published_at"].as_str().unwrap_or("").to_string();

            // 查找当前平台对应的资产
            let (download_url, file_size, sha256) = self.find_platform_asset(&release)?;

            return Ok(VersionInfo {
                version: tag_name,
                release_notes: body,
                download_url,
                file_size,
                release_date: published_at,
                mandatory: false,
                sha256,
            });
        }

        #[cfg(not(feature = "dependency-management"))]
        Err(UpgradeError::CheckFailed("HTTP client not available (enable dependency-management feature)".to_string()))
    }

    /// 从 GitHub release 中查找当前平台的资产
    #[cfg(feature = "dependency-management")]
    fn find_platform_asset(&self, release: &serde_json::Value) -> Result<(String, u64, String), UpgradeError> {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;

        let platform_suffix = match (os, arch) {
            ("macos", "aarch64") => "darwin-arm64",
            ("macos", "x86_64") => "darwin-x64",
            ("windows", "x86_64") => "windows-x64",
            ("linux", "x86_64") => "linux-x64",
            ("linux", "aarch64") => "linux-arm64",
            _ => return Err(UpgradeError::CheckFailed(format!(
                "Unsupported platform: {}/{}", os, arch
            ))),
        };

        let assets = release["assets"]
            .as_array()
            .ok_or_else(|| UpgradeError::CheckFailed("No assets in release".to_string()))?;

        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            if name.contains(platform_suffix) {
                let url = asset["browser_download_url"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let size = asset["size"].as_u64().unwrap_or(0);
                return Ok((url, size, String::new()));
            }
        }

        Err(UpgradeError::CheckFailed(format!(
            "No asset found for platform: {}", platform_suffix
        )))
    }

    /// 下载更新
    pub async fn download(&mut self) -> Result<PathBuf, UpgradeError> {
        let version_info = self.latest_version.as_ref()
            .ok_or_else(|| UpgradeError::DownloadFailed("No version info available".to_string()))?;

        info!("Downloading update: {} ({} bytes)", version_info.version, version_info.file_size);

        let temp_dir = std::env::temp_dir().join("nuwax-agent-update");
        std::fs::create_dir_all(&temp_dir)?;

        let file_name = version_info.download_url
            .split('/')
            .last()
            .unwrap_or("update-package");
        let file_path = temp_dir.join(file_name);

        #[cfg(feature = "dependency-management")]
        {
            self.status = UpdateStatus::Downloading(0);

            let response = reqwest::get(&version_info.download_url)
                .await
                .map_err(|e| UpgradeError::DownloadFailed(e.to_string()))?;

            if !response.status().is_success() {
                return Err(UpgradeError::DownloadFailed(format!(
                    "HTTP {}", response.status()
                )));
            }

            let bytes = response.bytes()
                .await
                .map_err(|e| UpgradeError::DownloadFailed(e.to_string()))?;

            std::fs::write(&file_path, &bytes)?;

            self.status = UpdateStatus::Downloading(100);

            // 校验 SHA256
            if !version_info.sha256.is_empty() {
                self.verify_sha256(&file_path, &version_info.sha256)?;
            }

            self.download_path = Some(file_path.clone());
            self.status = UpdateStatus::ReadyToInstall;
            info!("Download complete: {}", file_path.display());
            return Ok(file_path);
        }

        #[cfg(not(feature = "dependency-management"))]
        Err(UpgradeError::DownloadFailed("HTTP client not available".to_string()))
    }

    /// 验证 SHA256 校验和
    fn verify_sha256(&self, file_path: &Path, expected: &str) -> Result<(), UpgradeError> {
        use std::io::Read;

        let mut file = std::fs::File::open(file_path)?;
        let mut hasher = sha2_digest::Sha256Hasher::new();
        let mut buffer = [0u8; 8192];

        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }

        let hash = hasher.finalize_hex();
        if hash != expected {
            return Err(UpgradeError::VerifyFailed(format!(
                "SHA256 mismatch: expected {}, got {}", expected, hash
            )));
        }

        info!("SHA256 verification passed");
        Ok(())
    }

    /// 安装更新（平台特定）
    pub async fn install(&self) -> Result<(), UpgradeError> {
        let download_path = self.download_path.as_ref()
            .ok_or_else(|| UpgradeError::InstallFailed("No download available".to_string()))?;

        info!("Installing update from: {}", download_path.display());

        let os = std::env::consts::OS;
        match os {
            "macos" => self.install_macos(download_path).await,
            "windows" => self.install_windows(download_path).await,
            "linux" => self.install_linux(download_path).await,
            _ => Err(UpgradeError::InstallFailed(format!(
                "Unsupported platform: {}", os
            ))),
        }
    }

    /// macOS 安装：mount DMG → 复制 .app → unmount
    async fn install_macos(&self, path: &Path) -> Result<(), UpgradeError> {
        let extension = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        match extension {
            "dmg" => {
                info!("Installing DMG: {}", path.display());

                // 1. Mount DMG and capture the mount point
                let output = tokio::process::Command::new("hdiutil")
                    .args(["attach", "-nobrowse", "-noverify", "-noautoopen", "-plist"])
                    .arg(path)
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    return Err(UpgradeError::InstallFailed(
                        format!("Failed to mount DMG: {}", String::from_utf8_lossy(&output.stderr))
                    ));
                }

                // 2. Parse plist output to find mount point
                let plist_output = String::from_utf8_lossy(&output.stdout);
                let mount_point = Self::parse_dmg_mount_point(&plist_output)
                    .ok_or_else(|| UpgradeError::InstallFailed(
                        "Could not determine DMG mount point".to_string()
                    ))?;

                info!("DMG mounted at: {}", mount_point);

                // 3. Find .app in mounted volume
                let volume_path = Path::new(&mount_point);
                let app_path = Self::find_app_in_volume(volume_path).await?;

                info!("Found app: {}", app_path.display());

                // 4. Get app name and destination
                let app_name = app_path.file_name()
                    .ok_or_else(|| UpgradeError::InstallFailed("Invalid app path".to_string()))?;
                let dest_path = Path::new("/Applications").join(app_name);

                // 5. Remove old app if exists
                if dest_path.exists() {
                    info!("Removing old app: {}", dest_path.display());
                    tokio::fs::remove_dir_all(&dest_path).await
                        .map_err(|e| UpgradeError::InstallFailed(
                            format!("Failed to remove old app: {}", e)
                        ))?;
                }

                // 6. Copy new app to /Applications
                info!("Copying {} to /Applications", app_name.to_string_lossy());
                let copy_status = tokio::process::Command::new("cp")
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
                        "Failed to copy app to /Applications".to_string()
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
                archive.extract(dest)
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                // Find and copy .app to /Applications
                let app_path = Self::find_app_in_volume(dest).await?;
                let app_name = app_path.file_name()
                    .ok_or_else(|| UpgradeError::InstallFailed("Invalid app path".to_string()))?;
                let dest_app = Path::new("/Applications").join(app_name);

                // Remove old app if exists
                if dest_app.exists() {
                    tokio::fs::remove_dir_all(&dest_app).await
                        .map_err(|e| UpgradeError::InstallFailed(
                            format!("Failed to remove old app: {}", e)
                        ))?;
                }

                // Move extracted app to /Applications
                match tokio::fs::rename(&app_path, &dest_app).await {
                    Ok(()) => {
                        info!("ZIP install completed: {}", dest_app.display());
                    }
                    Err(_) => {
                        // If rename fails (cross-device), use cp -R
                        let status = tokio::process::Command::new("cp")
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
                            return Err(UpgradeError::InstallFailed("Failed to copy app".to_string()));
                        }
                    }
                }

                Ok(())
            }
            _ => Err(UpgradeError::InstallFailed(format!(
                "Unsupported file format: {}", extension
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
    async fn find_app_in_volume(volume_path: &Path) -> Result<PathBuf, UpgradeError> {
        let mut entries = tokio::fs::read_dir(volume_path).await
            .map_err(|e| UpgradeError::InstallFailed(
                format!("Failed to read volume: {}", e)
            ))?;

        while let Some(entry) = entries.next_entry().await
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
            "No .app found in volume".to_string()
        ))
    }

    /// 卸载 DMG
    async fn unmount_dmg(mount_point: &str) -> Result<(), UpgradeError> {
        info!("Unmounting DMG: {}", mount_point);
        let output = tokio::process::Command::new("hdiutil")
            .args(["detach", "-quiet"])
            .arg(mount_point)
            .output()
            .await
            .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

        if !output.status.success() {
            warn!("Failed to unmount DMG (non-fatal): {}", String::from_utf8_lossy(&output.stderr));
        }
        Ok(())
    }

    /// Windows 安装：MSI silent install
    async fn install_windows(&self, path: &Path) -> Result<(), UpgradeError> {
        let extension = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        match extension {
            "msi" => {
                info!("Installing MSI: {}", path.display());
                let output = tokio::process::Command::new("msiexec")
                    .args(["/i", &path.to_string_lossy(), "/quiet", "/norestart"])
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    return Err(UpgradeError::InstallFailed(format!(
                        "MSI install failed with exit code: {:?}", output.status.code()
                    )));
                }
                info!("MSI install completed");
                Ok(())
            }
            "exe" => {
                info!("Running installer: {}", path.display());
                let output = tokio::process::Command::new(path)
                    .args(["/S"])  // Silent mode (NSIS convention)
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    return Err(UpgradeError::InstallFailed(format!(
                        "Installer failed with exit code: {:?}", output.status.code()
                    )));
                }
                Ok(())
            }
            _ => Err(UpgradeError::InstallFailed(format!(
                "Unsupported file format: {}", extension
            ))),
        }
    }

    /// Linux 安装：dpkg / AppImage replace
    async fn install_linux(&self, path: &Path) -> Result<(), UpgradeError> {
        let extension = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        match extension {
            "deb" => {
                info!("Installing DEB: {}", path.display());
                let output = tokio::process::Command::new("sudo")
                    .args(["dpkg", "-i"])
                    .arg(path)
                    .output()
                    .await
                    .map_err(|e| UpgradeError::InstallFailed(e.to_string()))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(UpgradeError::InstallFailed(format!(
                        "dpkg install failed: {}", stderr
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
                "Unsupported file format: {}", extension
            ))),
        }
    }

    /// 请求应用重启
    pub fn request_restart(&self) {
        info!("Requesting application restart for update");
        // 通知应用层需要重启
        // 应用层应监听此信号并优雅退出后重新启动
    }

    /// 版本比较
    fn compare_versions(&self, remote_version: &str) -> bool {
        let current = semver::Version::parse(&self.current_version).ok();
        let remote = semver::Version::parse(remote_version).ok();

        match (current, remote) {
            (Some(c), Some(r)) => r > c,
            _ => false,
        }
    }

    /// 是否有可用更新
    pub fn has_update(&self) -> bool {
        matches!(self.status, UpdateStatus::UpdateAvailable(_))
    }
}

/// SHA256 哈希器（使用 sha2 crate）
mod sha2_digest {
    use sha2::{Sha256, Digest};

    pub struct Sha256Hasher {
        hasher: Sha256,
    }

    impl Sha256Hasher {
        pub fn new() -> Self {
            Self { hasher: Sha256::new() }
        }

        pub fn update(&mut self, data: &[u8]) {
            self.hasher.update(data);
        }

        pub fn finalize_hex(self) -> String {
            let result = self.hasher.finalize();
            // 转换为十六进制字符串
            result.iter().map(|b| format!("{:02x}", b)).collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manager_creation() {
        let manager = UpgradeManager::new();
        assert_eq!(manager.status(), &UpdateStatus::Unknown);
        assert!(!manager.has_update());
    }

    #[test]
    fn test_version_comparison() {
        let manager = UpgradeManager::new();

        // 远程版本更新
        assert!(manager.compare_versions("99.0.0"));
        // 远程版本相同或更旧
        assert!(!manager.compare_versions("0.0.1"));
    }

    #[test]
    fn test_current_version() {
        let manager = UpgradeManager::new();
        assert!(!manager.current_version().is_empty());
    }

    #[test]
    fn test_sha256_hasher() {
        let mut hasher = sha2_digest::Sha256Hasher::new();
        hasher.update(b"hello");
        let result = hasher.finalize_hex();
        assert!(!result.is_empty());
    }
}

//! 升级检查模块
//!
//! 检查和管理客户端版本升级

pub mod checker;
pub mod downloader;
pub mod error;
pub mod installer;
pub mod version;

use std::path::PathBuf;
use tracing::info;

pub use checker::VersionChecker;
pub use downloader::{Downloader, Sha256Hasher};
pub use error::UpgradeError;
pub use installer::Installer;
pub use version::{UpdateStatus, VersionInfo};

/// 升级管理器
pub struct UpgradeManager {
    /// 版本检查器
    checker: VersionChecker,
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
        let current_version = env!("CARGO_PKG_VERSION").to_string();
        let check_url =
            "https://api.github.com/repos/nuwax/nuwax-agent/releases/latest".to_string();

        Self {
            checker: VersionChecker::new(current_version, check_url),
            status: UpdateStatus::Unknown,
            latest_version: None,
            download_path: None,
        }
    }

    /// 设置检查 URL
    pub fn with_check_url(mut self, url: impl Into<String>) -> Self {
        let current_version = self.checker.current_version().to_string();
        self.checker = VersionChecker::new(current_version, url.into());
        self
    }

    /// 获取当前版本
    pub fn current_version(&self) -> &str {
        self.checker.current_version()
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
        info!(
            "Checking for updates... current: {}",
            self.checker.current_version()
        );

        // 获取最新版本信息
        match self.checker.fetch_latest_version().await {
            Ok(version_info) => {
                let has_update = self.checker.compare_versions(&version_info.version);

                if has_update {
                    info!(
                        "Update available: {} -> {}",
                        self.checker.current_version(),
                        version_info.version
                    );
                    self.status = UpdateStatus::UpdateAvailable(version_info.version.clone());
                    self.latest_version = Some(version_info);
                } else {
                    info!("Already up to date: {}", self.checker.current_version());
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

    /// 下载更新
    pub async fn download(&mut self) -> Result<PathBuf, UpgradeError> {
        let version_info = self
            .latest_version
            .as_ref()
            .ok_or_else(|| UpgradeError::DownloadFailed("No version info available".to_string()))?;

        self.status = UpdateStatus::Downloading(0);

        let file_path = Downloader::download(version_info).await?;

        self.status = UpdateStatus::ReadyToInstall;
        self.download_path = Some(file_path.clone());

        Ok(file_path)
    }

    /// 安装更新（平台特定）
    pub async fn install(&self) -> Result<(), UpgradeError> {
        let download_path = self
            .download_path
            .as_ref()
            .ok_or_else(|| UpgradeError::InstallFailed("No download available".to_string()))?;

        Installer::install(download_path).await
    }

    /// 请求应用重启
    pub fn request_restart(&self) {
        Installer::request_restart();
    }

    /// 是否有可用更新
    pub fn has_update(&self) -> bool {
        matches!(self.status, UpdateStatus::UpdateAvailable(_))
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
        let checker = VersionChecker::new(env!("CARGO_PKG_VERSION").to_string(), "".to_string());

        // 远程版本更新
        assert!(checker.compare_versions("99.0.0"));
        // 远程版本相同或更旧
        assert!(!checker.compare_versions("0.0.1"));
    }

    #[test]
    fn test_current_version() {
        let manager = UpgradeManager::new();
        assert!(!manager.current_version().is_empty());
    }

    #[test]
    fn test_sha256_hasher() {
        let mut hasher = Sha256Hasher::new();
        hasher.update(b"hello");
        let result = hasher.finalize_hex();
        assert!(!result.is_empty());
    }
}

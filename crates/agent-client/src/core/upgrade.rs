//! 升级检查模块
//!
//! 检查和管理客户端版本升级

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, debug};

/// 升级错误
#[derive(Error, Debug)]
pub enum UpgradeError {
    #[error("检查更新失败: {0}")]
    CheckFailed(String),
    #[error("下载失败: {0}")]
    DownloadFailed(String),
    #[error("安装失败: {0}")]
    InstallFailed(String),
    #[error("网络错误: {0}")]
    NetworkError(String),
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
        // 实际实现需要 HTTP 请求
        // 当前返回一个占位实现
        debug!("Fetching latest version from: {}", self.check_url);

        // TODO: 实际实现时使用 reqwest 获取 GitHub Release 信息
        Err(UpgradeError::CheckFailed("升级检查功能正在开发中".to_string()))
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
}

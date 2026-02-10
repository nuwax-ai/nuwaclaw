//! 版本检查逻辑

use tracing::debug;

use super::error::UpgradeError;
use super::version::VersionInfo;

/// 版本检查器
pub struct VersionChecker {
    /// 当前版本
    current_version: String,
    /// 更新检查 URL
    check_url: String,
}

impl VersionChecker {
    /// 创建新的版本检查器
    pub fn new(current_version: String, check_url: String) -> Self {
        Self {
            current_version,
            check_url,
        }
    }

    /// 获取最新版本信息（从远程）
    pub async fn fetch_latest_version(&self) -> Result<VersionInfo, UpgradeError> {
        debug!("Fetching latest version from: {}", self.check_url);

        #[cfg(feature = "dependency-management")]
        {
            let response = reqwest::get(&self.check_url)
                .await
                .map_err(|e| UpgradeError::NetworkError(e.to_string()))?;

            if !response.status().is_success() {
                return Err(UpgradeError::CheckFailed(format!(
                    "HTTP {}",
                    response.status()
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

            Ok(VersionInfo {
                version: tag_name,
                release_notes: body,
                download_url,
                file_size,
                release_date: published_at,
                mandatory: false,
                sha256,
            })
        }

        #[cfg(not(feature = "dependency-management"))]
        Err(UpgradeError::CheckFailed(
            "HTTP client not available (enable dependency-management feature)".to_string(),
        ))
    }

    /// 从 GitHub release 中查找当前平台的资产
    #[cfg(feature = "dependency-management")]
    fn find_platform_asset(
        &self,
        release: &serde_json::Value,
    ) -> Result<(String, u64, String), UpgradeError> {
        let os = std::env::consts::OS;
        let arch = std::env::consts::ARCH;

        let platform_suffix = match (os, arch) {
            ("macos", "aarch64") => "darwin-arm64",
            ("macos", "x86_64") => "darwin-x64",
            ("windows", "x86_64") => "windows-x64",
            ("linux", "x86_64") => "linux-x64",
            ("linux", "aarch64") => "linux-arm64",
            _ => {
                return Err(UpgradeError::CheckFailed(format!(
                    "Unsupported platform: {}/{}",
                    os, arch
                )))
            }
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
            "No asset found for platform: {}",
            platform_suffix
        )))
    }

    /// 版本比较
    pub fn compare_versions(&self, remote_version: &str) -> bool {
        let current = semver::Version::parse(&self.current_version).ok();
        let remote = semver::Version::parse(remote_version).ok();

        match (current, remote) {
            (Some(c), Some(r)) => r > c,
            _ => false,
        }
    }

    /// 获取当前版本
    pub fn current_version(&self) -> &str {
        &self.current_version
    }
}

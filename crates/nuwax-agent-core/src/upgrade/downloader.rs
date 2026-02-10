//! 下载管理

use std::path::{Path, PathBuf};
use tracing::info;

use super::error::UpgradeError;
use super::version::VersionInfo;

/// 下载管理器
pub struct Downloader;

impl Downloader {
    /// 下载更新
    pub async fn download(version_info: &VersionInfo) -> Result<PathBuf, UpgradeError> {
        info!(
            "Downloading update: {} ({} bytes)",
            version_info.version, version_info.file_size
        );

        let temp_dir = std::env::temp_dir().join("nuwax-agent-update");
        std::fs::create_dir_all(&temp_dir)?;

        let file_name = version_info
            .download_url
            .split('/')
            .next_back()
            .unwrap_or("update-package");
        let file_path = temp_dir.join(file_name);

        #[cfg(feature = "dependency-management")]
        {
            let response = reqwest::get(&version_info.download_url)
                .await
                .map_err(|e| UpgradeError::DownloadFailed(e.to_string()))?;

            if !response.status().is_success() {
                return Err(UpgradeError::DownloadFailed(format!(
                    "HTTP {}",
                    response.status()
                )));
            }

            let bytes = response
                .bytes()
                .await
                .map_err(|e| UpgradeError::DownloadFailed(e.to_string()))?;

            std::fs::write(&file_path, &bytes)?;

            // 校验 SHA256
            if !version_info.sha256.is_empty() {
                Self::verify_sha256(&file_path, &version_info.sha256)?;
            }

            info!("Download complete: {}", file_path.display());
            Ok(file_path)
        }

        #[cfg(not(feature = "dependency-management"))]
        Err(UpgradeError::DownloadFailed(
            "HTTP client not available".to_string(),
        ))
    }

    /// 验证 SHA256 校验和
    pub fn verify_sha256(file_path: &Path, expected: &str) -> Result<(), UpgradeError> {
        use std::io::Read;

        let mut file = std::fs::File::open(file_path)?;
        let mut hasher = Sha256Hasher::new();
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
                "SHA256 mismatch: expected {}, got {}",
                expected, hash
            )));
        }

        info!("SHA256 verification passed");
        Ok(())
    }
}

/// SHA256 哈希器（使用 sha2 crate）
pub struct Sha256Hasher {
    hasher: sha2::Sha256,
}

impl Sha256Hasher {
    pub fn new() -> Self {
        use sha2::Digest;
        Self {
            hasher: sha2::Sha256::new(),
        }
    }

    pub fn update(&mut self, data: &[u8]) {
        use sha2::Digest;
        self.hasher.update(data);
    }

    pub fn finalize_hex(self) -> String {
        use sha2::Digest;
        let result = self.hasher.finalize();
        // 转换为十六进制字符串
        result.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

impl Default for Sha256Hasher {
    fn default() -> Self {
        Self::new()
    }
}

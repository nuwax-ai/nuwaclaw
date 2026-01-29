//! 协议版本管理

use semver::Version;
use thiserror::Error;

/// 协议版本
pub const PROTOCOL_VERSION: &str = "1.0.0";

/// 支持的最低版本
pub const MIN_SUPPORTED_VERSION: &str = "1.0.0";

/// 版本协商错误
#[derive(Error, Debug)]
pub enum VersionError {
    #[error("协议版本不兼容: 需要 >= {min}, 实际 {actual}")]
    Incompatible { min: String, actual: String },
    #[error("无效的版本格式: {0}")]
    InvalidFormat(String),
}

/// 版本协商器
pub struct VersionNegotiator {
    /// 当前协议版本
    current: Version,
    /// 最低支持版本
    min_supported: Version,
}

impl Default for VersionNegotiator {
    fn default() -> Self {
        Self::new()
    }
}

impl VersionNegotiator {
    pub fn new() -> Self {
        Self {
            current: Version::parse(PROTOCOL_VERSION).unwrap(),
            min_supported: Version::parse(MIN_SUPPORTED_VERSION).unwrap(),
        }
    }

    /// 检查版本兼容性
    pub fn check_compatibility(&self, remote_version: &str) -> Result<bool, VersionError> {
        let remote = Version::parse(remote_version)
            .map_err(|_| VersionError::InvalidFormat(remote_version.to_string()))?;

        if remote < self.min_supported {
            return Err(VersionError::Incompatible {
                min: self.min_supported.to_string(),
                actual: remote.to_string(),
            });
        }

        Ok(true)
    }

    /// 获取当前版本
    pub fn current_version(&self) -> &str {
        PROTOCOL_VERSION
    }

    /// 协商版本（返回双方都支持的最高版本）
    pub fn negotiate(&self, remote_version: &str) -> Result<String, VersionError> {
        let remote = Version::parse(remote_version)
            .map_err(|_| VersionError::InvalidFormat(remote_version.to_string()))?;

        // 检查兼容性
        self.check_compatibility(remote_version)?;

        // 返回较低的版本作为协商结果
        let negotiated = if remote < self.current {
            remote
        } else {
            self.current.clone()
        };

        Ok(negotiated.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compatible_version() {
        let negotiator = VersionNegotiator::new();
        assert!(negotiator.check_compatibility("1.0.0").is_ok());
        assert!(negotiator.check_compatibility("1.1.0").is_ok());
        assert!(negotiator.check_compatibility("2.0.0").is_ok());
    }

    #[test]
    fn test_incompatible_version() {
        let negotiator = VersionNegotiator::new();
        assert!(negotiator.check_compatibility("0.9.0").is_err());
    }

    #[test]
    fn test_negotiate() {
        let negotiator = VersionNegotiator::new();
        // 远程版本更高，使用本地版本
        assert_eq!(negotiator.negotiate("2.0.0").unwrap(), "1.0.0");
        // 远程版本相同
        assert_eq!(negotiator.negotiate("1.0.0").unwrap(), "1.0.0");
    }
}

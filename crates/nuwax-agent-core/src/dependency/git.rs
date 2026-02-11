//! Git 检测器
//!
//! 检测系统中已安装的 Git

use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::utils::CommandNoWindowExt;

use super::detector::{DependencyDetector, DetectionResult, DetectorError};

/// Git 最低要求版本
pub const MIN_GIT_VERSION: &str = "2.20.0";

/// Git 信息
#[derive(Debug, Clone)]
pub struct GitInfo {
    /// 版本
    pub version: String,
    /// 安装路径
    pub path: PathBuf,
    /// 来源
    pub source: GitSource,
}

/// Git 来源
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitSource {
    /// 系统全局安装
    System,
    /// Xcode Command Line Tools (macOS)
    Xcode,
    /// 其他来源
    Other,
}

/// Git 错误
#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git 未找到")]
    NotFound,
    #[error("版本过低: 需要 >= {min}, 实际 {actual}")]
    VersionTooLow { min: String, actual: String },
    #[error("执行命令失败: {0}")]
    CommandFailed(String),
    #[error("版本解析失败: {0}")]
    ParseError(String),
}

/// Git 检测器
pub struct GitDetector {
    /// 最低版本要求
    min_version: String,
}

impl Default for GitDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl GitDetector {
    /// 创建新的检测器
    pub fn new() -> Self {
        Self {
            min_version: MIN_GIT_VERSION.to_string(),
        }
    }

    /// 从 PATH 检测
    fn detect_from_path(&self) -> Result<GitInfo, GitError> {
        let output = Command::new("git")
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| GitError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(GitError::NotFound);
        }

        let version = self.parse_version_output(&output.stdout)?;
        let path = self.find_git_path()?;

        // 判断来源
        let source = self.detect_source(&path);

        info!("Found Git in PATH: v{} at {:?}", version, path);

        Ok(GitInfo {
            version,
            path,
            source,
        })
    }

    /// 解析版本输出
    fn parse_version_output(&self, output: &[u8]) -> Result<String, GitError> {
        let version_str = String::from_utf8_lossy(output);

        // 格式: "git version 2.39.1" 或 "git version 2.39.1 (Apple Git-130)"
        if let Some(version) = version_str.strip_prefix("git version ") {
            let version = version
                .split_whitespace()
                .next()
                .ok_or_else(|| GitError::ParseError(format!("无法解析版本: {}", version_str)))?
                .to_string();
            return Ok(version);
        }

        Err(GitError::ParseError(format!(
            "无法解析版本输出: {}",
            version_str
        )))
    }

    /// 查找 Git 路径
    fn find_git_path(&self) -> Result<PathBuf, GitError> {
        let output = Command::new("which")
            .no_window()
            .arg("git")
            .output()
            .map_err(|e| GitError::CommandFailed(e.to_string()))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok(PathBuf::from(path));
        }

        Err(GitError::NotFound)
    }

    /// 检测 Git 来源
    fn detect_source(&self, path: &Path) -> GitSource {
        let path_str = path.to_string_lossy();

        // macOS Xcode Command Line Tools
        if path_str.contains("/Library/Developer/CommandLineTools/") {
            return GitSource::Xcode;
        }

        // Homebrew
        if path_str.contains("/opt/homebrew/") || path_str.contains("/usr/local/") {
            return GitSource::Other;
        }

        GitSource::System
    }

    /// 检测 macOS 特定路径
    #[cfg(target_os = "macos")]
    fn detect_macos_paths(&self) -> Result<GitInfo, GitError> {
        let paths = vec![
            "/Library/Developer/CommandLineTools/usr/bin/git",
            "/usr/local/bin/git",
            "/opt/homebrew/bin/git",
            "/usr/bin/git",
        ];

        for path in paths {
            let path_buf = PathBuf::from(path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Git at {}: v{}", path, version);
                    let source = self.detect_source(&path_buf);
                    return Ok(GitInfo {
                        version,
                        path: path_buf,
                        source,
                    });
                }
            }
        }

        Err(GitError::NotFound)
    }

    /// 检测 Windows 特定路径
    #[cfg(target_os = "windows")]
    fn detect_windows_paths(&self) -> Result<GitInfo, GitError> {
        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

        let paths = vec![
            format!(r"{}\Git\bin\git.exe", program_files),
            format!(r"{}\Git\bin\git.exe", program_files_x86),
        ];

        for path in paths {
            let path_buf = PathBuf::from(&path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Git at {}: v{}", path, version);
                    return Ok(GitInfo {
                        version,
                        path: path_buf,
                        source: GitSource::System,
                    });
                }
            }
        }

        Err(GitError::NotFound)
    }

    /// 从路径获取版本
    fn get_version_from_path(&self, path: &PathBuf) -> Result<String, GitError> {
        let output = Command::new(path)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| GitError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(GitError::CommandFailed("git --version failed".to_string()));
        }

        self.parse_version_output(&output.stdout)
    }

    /// 比较版本
    fn check_version(&self, version: &str) -> Result<bool, GitError> {
        // 简单版本比较 (major.minor.patch)
        let min_parts: Vec<u32> = self
            .min_version
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect();
        let version_parts: Vec<u32> = version.split('.').filter_map(|s| s.parse().ok()).collect();

        if min_parts.is_empty() || version_parts.is_empty() {
            return Err(GitError::ParseError(format!("无效版本号: {}", version)));
        }

        // 逐级比较
        for (min, actual) in min_parts.iter().zip(version_parts.iter()) {
            if actual < min {
                warn!(
                    "Git version {} is below minimum required {}",
                    version, self.min_version
                );
                return Ok(false);
            } else if actual > min {
                return Ok(true);
            }
        }

        // 版本相等，满足要求
        Ok(true)
    }
}

// ============================================================================
// DependencyDetector trait implementation
// ============================================================================

impl DependencyDetector for GitDetector {
    fn name(&self) -> &str {
        "git"
    }

    fn display_name(&self) -> &str {
        "Git"
    }

    fn detect(&self) -> Result<DetectionResult, DetectorError> {
        match self.detect_git() {
            Ok(info) => {
                let source = match info.source {
                    GitSource::System => "system",
                    GitSource::Xcode => "xcode",
                    GitSource::Other => "other",
                };
                Ok(DetectionResult::found(info.version, info.path, source))
            }
            Err(GitError::NotFound) => Ok(DetectionResult::not_found()),
            Err(GitError::VersionTooLow { min, actual }) => {
                Err(DetectorError::VersionTooLow { min, actual })
            }
            Err(GitError::CommandFailed(msg)) => Err(DetectorError::CommandFailed(msg)),
            Err(GitError::ParseError(msg)) => Err(DetectorError::ParseError(msg)),
        }
    }

    fn is_required(&self) -> bool {
        true
    }

    fn description(&self) -> &str {
        "版本控制工具"
    }
}

impl GitDetector {
    /// 内部检测方法，返回 GitInfo
    fn detect_git(&self) -> Result<GitInfo, GitError> {
        // 1. 检测 PATH 中的 git
        if let Ok(info) = self.detect_from_path() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        // 2. 检测平台特定路径
        #[cfg(target_os = "macos")]
        if let Ok(info) = self.detect_macos_paths() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        #[cfg(target_os = "windows")]
        if let Ok(info) = self.detect_windows_paths() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        Err(GitError::NotFound)
    }

    /// 获取 GitInfo（便捷方法）
    pub fn detect_with_info(&self) -> Result<GitInfo, GitError> {
        self.detect_git()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_detector_creation() {
        let detector = GitDetector::new();
        assert_eq!(detector.min_version, "2.20.0");
    }

    #[test]
    fn test_parse_version_output() {
        let detector = GitDetector::new();

        // 标准格式
        let output = b"git version 2.39.1\n";
        let version = detector.parse_version_output(output).unwrap();
        assert_eq!(version, "2.39.1");

        // Apple Git 格式
        let output = b"git version 2.39.1 (Apple Git-130)";
        let version = detector.parse_version_output(output).unwrap();
        assert_eq!(version, "2.39.1");
    }

    #[test]
    fn test_check_version() {
        let detector = GitDetector::new();

        assert!(detector.check_version("2.40.0").unwrap());
        assert!(detector.check_version("2.20.0").unwrap());
        assert!(!detector.check_version("2.19.0").unwrap());
    }
}

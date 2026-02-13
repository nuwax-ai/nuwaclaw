//! uv 检测和安装
//!
//! 检测系统中已安装的 uv，支持从打包资源安装

use semver::Version;
use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::utils::CommandNoWindowExt;

use super::detector::{DependencyDetector, DetectionResult, DetectorError};

/// uv 最低要求版本
pub const MIN_UV_VERSION: &str = "0.5.0";

/// uv 信息
#[derive(Debug, Clone)]
pub struct UvInfo {
    /// 版本
    pub version: String,
    /// 安装路径
    pub path: PathBuf,
    /// 来源
    pub source: UvSource,
}

/// uv 来源
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UvSource {
    /// 系统全局安装
    System,
    /// 客户端目录安装
    Local,
}

/// uv 错误
#[derive(Error, Debug)]
pub enum UvError {
    #[error("uv 未找到")]
    NotFound,
    #[error("版本过低: 需要 >= {min}, 实际 {actual}")]
    VersionTooLow { min: String, actual: String },
    #[error("执行命令失败: {0}")]
    CommandFailed(String),
    #[error("版本解析失败: {0}")]
    ParseError(String),
    #[error("安装失败: {0}")]
    InstallFailed(String),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}

/// uv 检测器
pub struct UvDetector {
    min_version: Version,
}

impl Default for UvDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl UvDetector {
    pub fn new() -> Self {
        Self {
            min_version: Version::parse(MIN_UV_VERSION).unwrap(),
        }
    }

    /// 从 PATH 检测
    fn detect_from_path(&self) -> Result<UvInfo, UvError> {
        let output = Command::new("uv")
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| UvError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(UvError::NotFound);
        }

        let version = Self::parse_version_output(&output.stdout)?;
        let path = self.get_uv_path()?;

        info!("Found uv in PATH: v{} at {:?}", version, path);

        Ok(UvInfo {
            version,
            path,
            source: UvSource::System,
        })
    }

    /// 解析 uv --version 输出，格式: "uv 0.10.0 (xxx)"
    fn parse_version_output(stdout: &[u8]) -> Result<String, UvError> {
        let output_str = String::from_utf8_lossy(stdout).trim().to_string();
        output_str
            .split_whitespace()
            .nth(1)
            .map(|s| s.to_string())
            .ok_or_else(|| UvError::ParseError(output_str))
    }

    /// 获取 uv 可执行文件路径
    fn get_uv_path(&self) -> Result<PathBuf, UvError> {
        #[cfg(unix)]
        {
            let output = Command::new("which")
                .no_window()
                .arg("uv")
                .output()
                .map_err(|e| UvError::CommandFailed(e.to_string()))?;

            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Ok(PathBuf::from(path));
            }
        }

        #[cfg(windows)]
        {
            let output = Command::new("where")
                .no_window()
                .arg("uv")
                .output()
                .map_err(|e| UvError::CommandFailed(e.to_string()))?;

            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                return Ok(PathBuf::from(path));
            }
        }

        Err(UvError::NotFound)
    }

    /// 检测本地安装
    fn detect_local(&self) -> Result<UvInfo, UvError> {
        let local_path = Self::get_local_uv_path();
        debug!(
            "[UvDetector] 检测本地路径: {:?}, exists={}",
            local_path,
            local_path.exists()
        );

        if local_path.exists() {
            let version = self.get_version_from_path(&local_path)?;
            info!("[UvDetector] 找到本地 uv: v{} at {:?}", version, local_path);
            return Ok(UvInfo {
                version,
                path: local_path,
                source: UvSource::Local,
            });
        }

        Err(UvError::NotFound)
    }

    /// 从路径获取版本
    fn get_version_from_path(&self, path: &PathBuf) -> Result<String, UvError> {
        let output = Command::new(path)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| UvError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(UvError::CommandFailed("uv --version failed".to_string()));
        }

        Self::parse_version_output(&output.stdout)
    }

    /// 检查版本是否满足要求
    fn check_version(&self, version: &str) -> Result<bool, UvError> {
        let parsed =
            Version::parse(version).map_err(|_| UvError::ParseError(version.to_string()))?;

        if parsed < self.min_version {
            warn!(
                "uv version {} is below minimum required {}",
                version, MIN_UV_VERSION
            );
            return Ok(false);
        }

        Ok(true)
    }

    /// 获取全局安装的 uv 路径
    /// macOS/Linux: ~/.local/bin/uv
    /// Windows: %USERPROFILE%\.local\bin\uv.exe
    pub fn get_local_uv_path() -> PathBuf {
        let bin_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local")
            .join("bin");

        #[cfg(unix)]
        {
            bin_dir.join("uv")
        }

        #[cfg(windows)]
        {
            bin_dir.join("uv.exe")
        }
    }

    /// 内部检测方法
    fn detect_uv(&self) -> Result<UvInfo, UvError> {
        // 1. 检测本地路径（优先）
        debug!("[UvDetector] 开始检测 uv...");
        if let Ok(info) = self.detect_local() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
            warn!("[UvDetector] 本地 uv 版本不满足要求: v{}", info.version);
        }

        // 2. 检测 PATH
        debug!("[UvDetector] 本地路径未找到，检测 PATH...");
        if let Ok(info) = self.detect_from_path() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
            warn!("[UvDetector] PATH 中 uv 版本不满足要求: v{}", info.version);
        }

        debug!("[UvDetector] uv 未找到");
        Err(UvError::NotFound)
    }

    pub fn detect_with_info(&self) -> Result<UvInfo, UvError> {
        self.detect_uv()
    }
}

impl DependencyDetector for UvDetector {
    fn name(&self) -> &str {
        "uv"
    }

    fn display_name(&self) -> &str {
        "uv"
    }

    fn detect(&self) -> Result<DetectionResult, DetectorError> {
        match self.detect_uv() {
            Ok(info) => {
                let source = match info.source {
                    UvSource::System => "system",
                    UvSource::Local => "local",
                };
                Ok(DetectionResult::found(info.version, info.path, source))
            }
            Err(UvError::NotFound) => Ok(DetectionResult::not_found()),
            Err(UvError::VersionTooLow { min, actual }) => {
                Err(DetectorError::VersionTooLow { min, actual })
            }
            Err(UvError::CommandFailed(msg)) => Err(DetectorError::CommandFailed(msg)),
            Err(UvError::ParseError(msg)) => Err(DetectorError::ParseError(msg)),
            Err(e) => Err(DetectorError::IoError(e.to_string())),
        }
    }

    fn is_required(&self) -> bool {
        true
    }

    fn description(&self) -> &str {
        "Python 包管理器"
    }
}

/// uv 安装器
/// 验证打包的 uv 资源存在（新架构：不再复制，直接使用 .app 包内资源）
pub struct UvInstaller {
    /// 目标目录（保留字段用于兼容性，新架构中不再使用）
    #[allow(dead_code)]
    target_dir: PathBuf,
}

impl Default for UvInstaller {
    fn default() -> Self {
        Self::new()
    }
}

impl UvInstaller {
    pub fn new() -> Self {
        let target_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local")
            .join("bin");

        Self { target_dir }
    }

    /// 使用自定义目标目录创建安装器
    pub fn with_target_dir(target_dir: PathBuf) -> Self {
        Self { target_dir }
    }

    fn read_version_from_path(path: &PathBuf) -> Result<String, UvError> {
        let output = Command::new(path)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| UvError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(UvError::CommandFailed("uv --version failed".to_string()));
        }

        let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        output_str
            .split_whitespace()
            .nth(1)
            .map(|s| s.to_string())
            .ok_or_else(|| UvError::ParseError(output_str))
    }

    /// 验证打包的 uv 资源存在并返回信息
    ///
    /// 新架构：不再复制到 ~/.local/bin/，直接验证打包资源
    /// 优势：保持 macOS 代码签名
    ///
    /// bundled_uv_dir 结构: bundled_uv_dir/bin/{uv,uvx}
    pub fn install_from_bundled(&self, bundled_uv_dir: &PathBuf) -> Result<UvInfo, UvError> {
        info!(
            "[UvInstaller] 验证打包的 uv 资源: {:?}",
            bundled_uv_dir
        );

        if !bundled_uv_dir.exists() {
            return Err(UvError::InstallFailed(format!(
                "打包的 uv 资源目录不存在: {:?}",
                bundled_uv_dir
            )));
        }

        // 验证 bin/uv 存在
        #[cfg(unix)]
        let bundled_uv_bin = bundled_uv_dir.join("bin").join("uv");
        #[cfg(windows)]
        let bundled_uv_bin = bundled_uv_dir.join("bin").join("uv.exe");

        if !bundled_uv_bin.exists() {
            // 列出 bundled_uv_dir 内容以便排查
            if let Ok(entries) = std::fs::read_dir(bundled_uv_dir) {
                let files: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| format!("{:?}", e.path()))
                    .collect();
                warn!("[UvInstaller] 资源目录内容: {:?}", files);
            }
            return Err(UvError::InstallFailed(format!(
                "打包的 uv 二进制文件不存在: {:?}",
                bundled_uv_bin
            )));
        }

        // 获取版本信息
        let version = Self::read_version_from_path(&bundled_uv_bin)?;

        info!(
            "[UvInstaller] uv 资源验证通过: v{} at {:?}",
            version, bundled_uv_bin
        );

        // 写入本地 env 脚本（用于终端环境）
        if let Err(e) = crate::utils::ensure_local_bin_env() {
            warn!("写入本地 env 脚本失败（不影响使用）: {}", e);
        }

        Ok(UvInfo {
            version,
            path: bundled_uv_bin,
            source: UvSource::Local,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uv_detector_creation() {
        let detector = UvDetector::new();
        assert!(detector.min_version >= Version::parse("0.5.0").unwrap());
    }

    #[test]
    fn test_local_uv_path() {
        let path = UvDetector::get_local_uv_path();
        assert!(path.to_string_lossy().contains("nuwax-agent"));
    }

    #[test]
    fn test_parse_version_output() {
        let output = b"uv 0.10.0 (homebrew)";
        let version = UvDetector::parse_version_output(output).unwrap();
        assert_eq!(version, "0.10.0");
    }
}

//! Docker 检测器
//!
//! 检测系统中已安装的 Docker（如果可用）

use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;
use tracing::{debug, info};

use crate::utils::CommandNoWindowExt;

use super::detector::{DependencyDetector, DetectionResult, DetectorError};

/// Docker 信息
#[derive(Debug, Clone)]
pub struct DockerInfo {
    /// 版本
    pub version: String,
    /// 安装路径
    pub path: PathBuf,
    /// Docker Desktop 或 Docker Engine
    pub variant: DockerVariant,
    /// 是否正在运行
    pub running: bool,
}

/// Docker 变体
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DockerVariant {
    /// Docker Desktop (macOS/Windows)
    Desktop,
    /// Docker Engine (Linux)
    Engine,
    /// Rancher Desktop
    Rancher,
    /// 其他
    Other,
}

/// Docker 错误
#[derive(Error, Debug)]
pub enum DockerError {
    #[error("Docker 未找到")]
    NotFound,
    #[error("Docker 未运行")]
    NotRunning,
    #[error("执行命令失败: {0}")]
    CommandFailed(String),
    #[error("版本解析失败: {0}")]
    ParseError(String),
}

/// Docker 检测器
pub struct DockerDetector;

impl Default for DockerDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl DockerDetector {
    /// 创建新的检测器
    pub fn new() -> Self {
        Self
    }

    /// 从 PATH 检测
    fn detect_from_path(&self) -> Result<DockerInfo, DockerError> {
        let output = Command::new("docker")
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| DockerError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(DockerError::NotFound);
        }

        let version = self.parse_version_output(&output.stdout)?;
        let path = self.find_docker_path()?;

        // 判断变体
        let variant = self.detect_variant();

        // 检查是否运行
        let running = self.check_docker_running()?;

        info!(
            "Found Docker: v{} at {:?} ({:?}, running: {})",
            version, path, variant, running
        );

        Ok(DockerInfo {
            version,
            path,
            variant,
            running,
        })
    }

    /// 解析版本输出
    fn parse_version_output(&self, output: &[u8]) -> Result<String, DockerError> {
        let version_str = String::from_utf8_lossy(output);

        // 格式: "Docker version 20.10.21, build baeda1f" 或 "Docker version 4.16.2, build aa83ca2, desktop"
        if let Some(version) = version_str.strip_prefix("Docker version ") {
            let version = version
                .split_whitespace()
                .next()
                .ok_or_else(|| DockerError::ParseError(format!("无法解析版本: {}", version_str)))?
                .trim_end_matches(',')
                .to_string();
            return Ok(version);
        }

        Err(DockerError::ParseError(format!(
            "无法解析版本输出: {}",
            version_str
        )))
    }

    /// 查找 Docker 路径
    fn find_docker_path(&self) -> Result<PathBuf, DockerError> {
        let output = Command::new("which")
            .no_window()
            .arg("docker")
            .output()
            .map_err(|e| DockerError::CommandFailed(e.to_string()))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok(PathBuf::from(path));
        }

        Err(DockerError::NotFound)
    }

    /// 检测 Docker 变体
    fn detect_variant(&self) -> DockerVariant {
        // 检查 Docker Desktop
        #[cfg(target_os = "macos")]
        {
            if std::path::Path::new("/Applications/Docker.app").exists() {
                return DockerVariant::Desktop;
            }
        }

        #[cfg(target_os = "windows")]
        {
            let program_files = std::env::var("ProgramFiles").unwrap_or_default();
            let docker_path = format!(r"{}\Docker\Docker Desktop.exe", program_files);
            if std::path::Path::new(&docker_path).exists() {
                return DockerVariant::Desktop;
            }
        }

        // 检查 Rancher Desktop
        #[cfg(target_os = "macos")]
        {
            if std::path::Path::new("/Applications/Rancher Desktop.app").exists() {
                return DockerVariant::Rancher;
            }
        }

        // 检查 Docker Engine（Linux）
        #[cfg(target_os = "linux")]
        {
            if std::path::Path::new("/var/run/docker.sock").exists() {
                return DockerVariant::Engine;
            }
        }

        DockerVariant::Other
    }

    /// 检查 Docker 是否运行
    fn check_docker_running(&self) -> Result<bool, DockerError> {
        let output = Command::new("docker")
            .no_window()
            .arg("info")
            .output()
            .map_err(|e| DockerError::CommandFailed(e.to_string()))?;

        Ok(output.status.success())
    }

    /// 检测 macOS 特定路径
    #[cfg(target_os = "macos")]
    fn detect_macos_paths(&self) -> Result<DockerInfo, DockerError> {
        let paths = vec![
            "/usr/local/bin/docker",
            "/opt/homebrew/bin/docker",
            "/usr/bin/docker",
        ];

        for path in paths {
            let path_buf = PathBuf::from(path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Docker at {}: v{}", path, version);
                    return Ok(DockerInfo {
                        version,
                        path: path_buf,
                        variant: self.detect_variant(),
                        running: self.check_docker_running()?,
                    });
                }
            }
        }

        Err(DockerError::NotFound)
    }

    /// 检测 Windows 特定路径
    #[cfg(target_os = "windows")]
    fn detect_windows_paths(&self) -> Result<DockerInfo, DockerError> {
        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

        let paths = vec![
            format!(r"{}\Docker\Docker Resources\bin\docker.exe", program_files),
            format!(
                r"{}\Docker\Docker Resources\bin\docker.exe",
                program_files_x86
            ),
        ];

        for path in paths {
            let path_buf = PathBuf::from(&path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Docker at {}: v{}", path, version);
                    return Ok(DockerInfo {
                        version,
                        path: path_buf,
                        variant: DockerVariant::Desktop,
                        running: self.check_docker_running()?,
                    });
                }
            }
        }

        Err(DockerError::NotFound)
    }

    /// 从路径获取版本
    fn get_version_from_path(&self, path: &PathBuf) -> Result<String, DockerError> {
        let output = Command::new(path)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| DockerError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(DockerError::CommandFailed(
                "docker --version failed".to_string(),
            ));
        }

        self.parse_version_output(&output.stdout)
    }
}

// ============================================================================
// DependencyDetector trait implementation
// ============================================================================

impl DependencyDetector for DockerDetector {
    fn name(&self) -> &str {
        "docker"
    }

    fn display_name(&self) -> &str {
        "Docker"
    }

    fn detect(&self) -> Result<DetectionResult, DetectorError> {
        match self.detect_docker() {
            Ok(info) => {
                let source = match info.variant {
                    DockerVariant::Desktop => "docker-desktop",
                    DockerVariant::Engine => "docker-engine",
                    DockerVariant::Rancher => "rancher-desktop",
                    DockerVariant::Other => "other",
                };
                let found = info.running || matches!(info.variant, DockerVariant::Engine);
                if !found {
                    // Docker 已安装但未运行
                    return Ok(DetectionResult::found(info.version, info.path, source));
                }
                Ok(DetectionResult::found(info.version, info.path, source))
            }
            Err(DockerError::NotFound) => Ok(DetectionResult::not_found()),
            Err(DockerError::CommandFailed(msg)) => Err(DetectorError::CommandFailed(msg)),
            Err(DockerError::ParseError(msg)) => Err(DetectorError::ParseError(msg)),
            // NotRunning 不是错误，而是"未运行"的正常结果
            Err(DockerError::NotRunning) => {
                // Docker 已安装但未运行
                Ok(DetectionResult::not_found())
            }
        }
    }

    fn is_required(&self) -> bool {
        false
    }

    fn description(&self) -> &str {
        "容器运行时（用于容器化开发）"
    }
}

impl DockerDetector {
    /// 内部检测方法，返回 DockerInfo
    fn detect_docker(&self) -> Result<DockerInfo, DockerError> {
        // 1. 检测 PATH 中的 docker
        if let Ok(info) = self.detect_from_path() {
            return Ok(info);
        }

        // 2. 检测平台特定路径
        #[cfg(target_os = "macos")]
        if let Ok(info) = self.detect_macos_paths() {
            return Ok(info);
        }

        #[cfg(target_os = "windows")]
        if let Ok(info) = self.detect_windows_paths() {
            return Ok(info);
        }

        Err(DockerError::NotFound)
    }

    /// 获取 DockerInfo（便捷方法）
    pub fn detect_with_info(&self) -> Result<DockerInfo, DockerError> {
        self.detect_docker()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_docker_detector_creation() {
        let _detector = DockerDetector::new();
        // 只测试创建
    }

    #[test]
    fn test_parse_version_output() {
        let detector = DockerDetector::new();

        // 标准格式
        let output = b"Docker version 20.10.21, build baeda1f\n";
        let version = detector.parse_version_output(output).unwrap();
        assert_eq!(version, "20.10.21");

        // Docker Desktop 格式
        let output = b"Docker version 4.16.2, build aa83ca2, desktop";
        let version = detector.parse_version_output(output).unwrap();
        assert_eq!(version, "4.16.2");
    }
}

//! Python 检测器
//!
//! 检测系统中已安装的 Python 运行时

use semver::Version;
use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;
use tracing::{debug, warn};

use crate::utils::CommandNoWindowExt;

use super::detector::{DependencyDetector, DetectionResult, DetectorError};

/// Python 最低要求版本
pub const MIN_PYTHON_VERSION: &str = "3.8.0";

/// Python 信息
#[derive(Debug, Clone)]
pub struct PythonInfo {
    /// 版本
    pub version: String,
    /// 安装路径
    pub path: PathBuf,
    /// 来源
    pub source: PythonSource,
}

/// Python 来源
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PythonSource {
    /// 系统全局安装
    System,
    /// pyenv 安装
    Pyenv,
    /// conda 环境
    Conda,
    /// 其他来源
    Other,
}

/// Python 错误
#[derive(Error, Debug)]
pub enum PythonError {
    #[error("Python 未找到")]
    NotFound,
    #[error("版本过低: 需要 >= {min}, 实际 {actual}")]
    VersionTooLow { min: String, actual: String },
    #[error("执行命令失败: {0}")]
    CommandFailed(String),
    #[error("版本解析失败: {0}")]
    ParseError(String),
}

/// Python 检测器
pub struct PythonDetector {
    /// 最低版本要求
    min_version: Version,
}

impl Default for PythonDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl PythonDetector {
    /// 创建新的检测器
    pub fn new() -> Self {
        Self {
            min_version: Version::parse(MIN_PYTHON_VERSION).unwrap(),
        }
    }

    /// 从 PATH 检测
    fn detect_from_path(&self) -> Result<PythonInfo, PythonError> {
        // 尝试 python3
        let output = Command::new("python3")
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

        if output.status.success() {
            let version = self.parse_version_output(&output.stdout)?;
            let path = self.find_python_path("python3")?;
            return Ok(PythonInfo {
                version,
                path,
                source: PythonSource::System,
            });
        }

        // 尝试 python
        let output = Command::new("python")
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

        if output.status.success() {
            let version = self.parse_version_output(&output.stdout)?;
            let path = self.find_python_path("python")?;
            return Ok(PythonInfo {
                version,
                path,
                source: PythonSource::System,
            });
        }

        Err(PythonError::NotFound)
    }

    /// 解析版本输出
    fn parse_version_output(&self, output: &[u8]) -> Result<String, PythonError> {
        let version_str = String::from_utf8_lossy(output);

        // 尝试多种格式: "Python 3.11.5", "Python 3.11.5\n"
        for line in version_str.lines() {
            if line.starts_with("Python ") {
                let version = line.trim_start_matches("Python ").trim().to_string();
                return Ok(version);
            }
        }

        Err(PythonError::ParseError(format!(
            "无法解析版本输出: {}",
            version_str
        )))
    }

    /// 查找 Python 路径
    fn find_python_path(&self, name: &str) -> Result<PathBuf, PythonError> {
        let output = Command::new("which")
            .no_window()
            .arg(name)
            .output()
            .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok(PathBuf::from(path));
        }

        Err(PythonError::NotFound)
    }

    /// 检测 pyenv 安装
    fn detect_pyenv(&self) -> Result<PythonInfo, PythonError> {
        // 获取 pyenv 当前版本
        let output = Command::new("pyenv")
            .no_window()
            .args(["global"])
            .output()
            .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(PythonError::NotFound);
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let home = std::env::var("PYENV_ROOT")
            .or_else(|_| std::env::var("HOME").map(|h| format!("{}/.pyenv", h)))
            .unwrap_or_else(|_| format!("{}/.pyenv", std::env::var("HOME").unwrap_or_default()));

        let python_path = PathBuf::from(&home)
            .join("versions")
            .join(&version)
            .join("bin")
            .join("python3");

        if python_path.exists() {
            // 获取版本信息
            let output = Command::new(&python_path)
                .no_window()
                .arg("--version")
                .output()
                .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

            let version = self.parse_version_output(&output.stdout)?;
            return Ok(PythonInfo {
                version,
                path: python_path,
                source: PythonSource::Pyenv,
            });
        }

        Err(PythonError::NotFound)
    }

    /// 检测 conda 环境
    fn detect_conda(&self) -> Result<PythonInfo, PythonError> {
        // 获取当前 conda 环境的 Python
        let output = Command::new("conda")
            .no_window()
            .args(["info", "--envs"])
            .output()
            .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(PythonError::NotFound);
        }

        // 查找 base 环境或当前激活的环境
        let conda_path = std::env::var("CONDA_PREFIX")
            .or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_default();
                // 尝试常见路径
                let base_path = format!("{}/anaconda3", home);
                if std::path::Path::new(&base_path).exists() {
                    Ok(base_path)
                } else {
                    let miniconda_path = format!("{}/miniconda3", home);
                    if std::path::Path::new(&miniconda_path).exists() {
                        Ok(miniconda_path)
                    } else {
                        Err(())
                    }
                }
            })
            .ok();

        if let Some(conda_prefix) = conda_path {
            let python_path = PathBuf::from(&conda_prefix).join("bin").join("python3");

            if python_path.exists() {
                let output = Command::new(&python_path)
                    .no_window()
                    .arg("--version")
                    .output()
                    .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

                let version = self.parse_version_output(&output.stdout)?;
                return Ok(PythonInfo {
                    version,
                    path: python_path,
                    source: PythonSource::Conda,
                });
            }
        }

        Err(PythonError::NotFound)
    }

    /// 检测 macOS 特定路径
    #[cfg(target_os = "macos")]
    fn detect_macos_paths(&self) -> Result<PythonInfo, PythonError> {
        let paths = vec![
            "/usr/bin/python3",
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
        ];

        for path in paths {
            let path_buf = PathBuf::from(path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Python at {}: v{}", path, version);
                    return Ok(PythonInfo {
                        version,
                        path: path_buf,
                        source: PythonSource::System,
                    });
                }
            }
        }

        Err(PythonError::NotFound)
    }

    /// 检测 Windows 特定路径
    #[cfg(target_os = "windows")]
    fn detect_windows_paths(&self) -> Result<PythonInfo, PythonError> {
        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

        let paths = vec![
            format!(r"{}\Python39\python.exe", program_files),
            format!(r"{}\Python310\python.exe", program_files),
            format!(r"{}\Python311\python.exe", program_files),
            format!(r"{}\Python39\python.exe", program_files_x86),
            format!(r"{}\Python310\python.exe", program_files_x86),
            format!(r"{}\Python311\python.exe", program_files_x86),
        ];

        for path in paths {
            let path_buf = PathBuf::from(&path);
            if path_buf.exists() {
                if let Ok(version) = self.get_version_from_path(&path_buf) {
                    debug!("Found Python at {}: v{}", path, version);
                    return Ok(PythonInfo {
                        version,
                        path: path_buf,
                        source: PythonSource::System,
                    });
                }
            }
        }

        Err(PythonError::NotFound)
    }

    /// 从路径获取版本
    fn get_version_from_path(&self, path: &PathBuf) -> Result<String, PythonError> {
        let output = Command::new(path)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| PythonError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(PythonError::CommandFailed(
                "python --version failed".to_string(),
            ));
        }

        self.parse_version_output(&output.stdout)
    }

    /// 检查版本是否满足要求
    fn check_version(&self, version: &str) -> Result<bool, PythonError> {
        let parsed =
            Version::parse(version).map_err(|_| PythonError::ParseError(version.to_string()))?;

        if parsed < self.min_version {
            warn!(
                "Python version {} is below minimum required {}",
                version, MIN_PYTHON_VERSION
            );
            return Ok(false);
        }

        Ok(true)
    }
}

// ============================================================================
// DependencyDetector trait implementation
// ============================================================================

impl DependencyDetector for PythonDetector {
    fn name(&self) -> &str {
        "python"
    }

    fn display_name(&self) -> &str {
        "Python"
    }

    fn detect(&self) -> Result<DetectionResult, DetectorError> {
        match self.detect_python() {
            Ok(info) => {
                let source = match info.source {
                    PythonSource::System => "system",
                    PythonSource::Pyenv => "pyenv",
                    PythonSource::Conda => "conda",
                    PythonSource::Other => "other",
                };
                Ok(DetectionResult::found(info.version, info.path, source))
            }
            // NotFound 不是错误，而是"未找到"的正常结果
            Err(PythonError::NotFound) => Ok(DetectionResult::not_found()),
            // 版本过低是检测器层面的错误
            Err(PythonError::VersionTooLow { min, actual }) => {
                Err(DetectorError::VersionTooLow { min, actual })
            }
            // 命令执行和解析错误直接转换
            Err(PythonError::CommandFailed(msg)) => Err(DetectorError::CommandFailed(msg)),
            Err(PythonError::ParseError(msg)) => Err(DetectorError::ParseError(msg)),
        }
    }

    fn is_required(&self) -> bool {
        false
    }

    fn description(&self) -> &str {
        "Python 运行时环境"
    }
}

impl PythonDetector {
    /// 内部检测方法，返回 PythonInfo
    fn detect_python(&self) -> Result<PythonInfo, PythonError> {
        // 1. 检测 PATH 中的 python3
        if let Ok(info) = self.detect_from_path() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        // 2. 检测 pyenv
        if let Ok(info) = self.detect_pyenv() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        // 3. 检测 conda
        if let Ok(info) = self.detect_conda() {
            if self.check_version(&info.version)? {
                return Ok(info);
            }
        }

        // 4. 检测平台特定路径
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

        Err(PythonError::NotFound)
    }

    /// 获取 PythonInfo（便捷方法）
    pub fn detect_with_info(&self) -> Result<PythonInfo, PythonError> {
        self.detect_python()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_python_detector_creation() {
        let detector = PythonDetector::new();
        assert!(detector.min_version >= Version::parse("3.8.0").unwrap());
    }

    #[test]
    fn test_parse_version_output() {
        let detector = PythonDetector::new();

        // Python 3.11.5 格式
        let output = b"Python 3.11.5\n";
        let version = detector.parse_version_output(output).unwrap();
        assert_eq!(version, "3.11.5");

        // Python 3.8.0 格式
        let output = b"Python 3.8.0";
        let version = detector.parse_version_output(output).unwrap();
        assert_eq!(version, "3.8.0");
    }
}

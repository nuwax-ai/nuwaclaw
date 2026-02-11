//! 常用 CLI 工具检测器
//!
//! 检测系统中已安装的常用 CLI 工具（ffmpeg, pandoc 等）

use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;

use crate::utils::CommandNoWindowExt;

use super::detector::{DependencyDetector, DetectionResult, DetectorError};

/// CLI 工具错误
#[derive(Error, Debug)]
pub enum CliToolError {
    #[error("工具未找到: {0}")]
    NotFound(String),
    #[error("执行命令失败: {0}")]
    CommandFailed(String),
    #[error("版本解析失败: {0}")]
    ParseError(String),
}

/// CLI 工具信息
#[derive(Debug, Clone)]
pub struct CliToolInfo {
    /// 工具名称
    pub name: String,
    /// 版本
    pub version: Option<String>,
    /// 安装路径
    pub path: Option<PathBuf>,
}

/// CLI 工具检测器（通用）
pub struct CliToolDetector {
    /// 工具名称
    name: String,
    /// 显示名称
    display_name: String,
    /// 是否必需
    required: bool,
    /// 版本解析函数
    version_parser: fn(&[u8]) -> Result<String, CliToolError>,
    /// 最低版本要求（可选）
    min_version: Option<String>,
    /// 描述
    description: &'static str,
}

impl CliToolDetector {
    /// 创建新的检测器
    pub fn new(
        name: &str,
        display_name: &str,
        version_parser: fn(&[u8]) -> Result<String, CliToolError>,
    ) -> Self {
        Self {
            name: name.to_string(),
            display_name: display_name.to_string(),
            required: false,
            version_parser,
            min_version: None,
            description: "",
        }
    }

    /// 设置必需
    pub fn required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    /// 设置最低版本
    pub fn min_version(mut self, version: &str) -> Self {
        self.min_version = Some(version.to_string());
        self
    }

    /// 设置描述
    pub fn description(mut self, desc: &'static str) -> Self {
        self.description = desc;
        self
    }

    /// 检测工具
    fn detect_tool(&self) -> Result<CliToolInfo, CliToolError> {
        // 检测命令
        let output = Command::new(&self.name)
            .no_window()
            .arg("--version")
            .output()
            .map_err(|e| CliToolError::CommandFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(CliToolError::NotFound(self.name.clone()));
        }

        // 解析版本
        let version = (self.version_parser)(&output.stdout)?;

        // 查找路径
        let path = self.find_path()?;

        Ok(CliToolInfo {
            name: self.name.clone(),
            version: Some(version),
            path: Some(path),
        })
    }

    /// 查找工具路径
    fn find_path(&self) -> Result<PathBuf, CliToolError> {
        let output = Command::new("which")
            .no_window()
            .arg(&self.name)
            .output()
            .map_err(|e| CliToolError::CommandFailed(e.to_string()))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok(PathBuf::from(path));
        }

        Err(CliToolError::NotFound(self.name.clone()))
    }
}

// ============================================================================
// DependencyDetector trait implementation
// ============================================================================

impl DependencyDetector for CliToolDetector {
    fn name(&self) -> &str {
        &self.name
    }

    fn display_name(&self) -> &str {
        &self.display_name
    }

    fn detect(&self) -> Result<DetectionResult, DetectorError> {
        match self.detect_tool() {
            Ok(info) => {
                let path = info.path.unwrap_or_default();
                Ok(DetectionResult::found(
                    info.version.unwrap_or_default(),
                    path,
                    "system",
                ))
            }
            Err(CliToolError::NotFound(_)) => Ok(DetectionResult::not_found()),
            Err(CliToolError::CommandFailed(msg)) => Err(DetectorError::CommandFailed(msg)),
            Err(CliToolError::ParseError(msg)) => Err(DetectorError::ParseError(msg)),
        }
    }

    fn is_required(&self) -> bool {
        self.required
    }

    fn description(&self) -> &str {
        self.description
    }
}

// ============================================================================
// 常用工具检测器工厂
// ============================================================================

/// FFmpeg 检测器
pub fn create_ffmpeg_detector() -> CliToolDetector {
    CliToolDetector::new("ffmpeg", "FFmpeg", |output: &[u8]| {
        let version_str = String::from_utf8_lossy(output);
        // 格式: "ffmpeg version 5.1.2 Copyright (c) 2000-2022 ..."
        if let Some(version) = version_str.split("version ").nth(1) {
            let version = version.split_whitespace().next().unwrap_or(version);
            return Ok(version.to_string());
        }
        Err(CliToolError::ParseError("无法解析 FFmpeg 版本".to_string()))
    })
    .description("多媒体处理工具（视频/音频转换）")
}

/// Pandoc 检测器
pub fn create_pandoc_detector() -> CliToolDetector {
    CliToolDetector::new("pandoc", "Pandoc", |output: &[u8]| {
        let version_str = String::from_utf8_lossy(output);
        // 格式: "pandoc 3.1.2" 或 "pandoc.exe 3.1.2"
        if let Some(version) = version_str
            .split_whitespace()
            .next()
            .filter(|s| !s.contains("pandoc.exe"))
        {
            return Ok(version.to_string());
        }
        Err(CliToolError::ParseError("无法解析 Pandoc 版本".to_string()))
    })
    .description("文档转换工具（Markdown ↔ 其他格式）")
}

/// Rust/Cargo 检测器
pub fn create_rust_detector() -> CliToolDetector {
    CliToolDetector::new("cargo", "Rust/Cargo", |output: &[u8]| {
        let version_str = String::from_utf8_lossy(output);
        // 格式: "cargo 1.72.0 (..."
        if let Some(version) = version_str.split_whitespace().nth(1) {
            return Ok(version.to_string());
        }
        Err(CliToolError::ParseError("无法解析 Rust 版本".to_string()))
    })
    .min_version("1.60.0")
    .description("Rust 工具链（用于 Rust 开发）")
}

/// Tar 检测器（macOS 常用）
pub fn create_tar_detector() -> CliToolDetector {
    CliToolDetector::new("tar", "tar", |_output: &[u8]| {
        // tar 通常没有 --version 或输出不固定，仅检查是否存在即可
        Ok("available".to_string())
    })
    .description("归档工具")
}

/// Curl 检测器
pub fn create_curl_detector() -> CliToolDetector {
    CliToolDetector::new("curl", "cURL", |output: &[u8]| {
        let version_str = String::from_utf8_lossy(output);
        // 格式: "curl 7.88.1 (x86_64-apple-darwin22.0) libcurl/7.88.1 ..."
        if let Some(version) = version_str.split_whitespace().nth(1) {
            return Ok(version.to_string());
        }
        Err(CliToolError::ParseError("无法解析 cURL 版本".to_string()))
    })
    .description("HTTP 客户端工具")
}

/// Wget 检测器
pub fn create_wget_detector() -> CliToolDetector {
    CliToolDetector::new("wget", "Wget", |output: &[u8]| {
        let version_str = String::from_utf8_lossy(output);
        // 格式: "GNU Wget 1.21.4 ..."
        if let Some(version) = version_str.split_whitespace().nth(2) {
            return Ok(version.to_string());
        }
        Err(CliToolError::ParseError("无法解析 Wget 版本".to_string()))
    })
    .description("下载工具")
}

/// jq 检测器（JSON 处理）
pub fn create_jq_detector() -> CliToolDetector {
    CliToolDetector::new("jq", "jq", |output: &[u8]| {
        let version_str = String::from_utf8_lossy(output);
        // 格式: "jq-1.6"
        let version = version_str
            .trim()
            .strip_prefix("jq-")
            .unwrap_or(&version_str)
            .to_string();
        Ok(version)
    })
    .description("JSON 处理工具")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ffmpeg_version_parse() {
        let detector = create_ffmpeg_detector();
        let output = b"ffmpeg version 5.1.2 Copyright (c) 2000-2022 the FFmpeg developers\n";
        let version = (detector.version_parser)(output).unwrap();
        assert_eq!(version, "5.1.2");
    }

    #[test]
    fn test_pandoc_version_parse() {
        let detector = create_pandoc_detector();
        let output = b"pandoc 3.1.2\n";
        let version = (detector.version_parser)(output).unwrap();
        assert_eq!(version, "3.1.2");
    }

    #[test]
    fn test_rust_version_parse() {
        let detector = create_rust_detector();
        let output = b"cargo 1.72.0 (...\n";
        let version = (detector.version_parser)(output).unwrap();
        assert_eq!(version, "1.72.0");
    }
}

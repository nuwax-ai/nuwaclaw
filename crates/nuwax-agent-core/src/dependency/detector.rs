//! 依赖检测器 trait
//!
//! 定义依赖检测和工具安装的抽象接口

use std::path::PathBuf;
use thiserror::Error;

/// 检测器错误
#[derive(Error, Debug, Clone)]
pub enum DetectorError {
    #[error("未找到: {0}")]
    NotFound(String),
    #[error("版本过低: 需要 >= {min}, 实际 {actual}")]
    VersionTooLow { min: String, actual: String },
    #[error("执行命令失败: {0}")]
    CommandFailed(String),
    #[error("版本解析失败: {0}")]
    ParseError(String),
    #[error("IO 错误: {0}")]
    IoError(String),
}

/// 检测结果
#[derive(Debug, Clone)]
pub struct DetectionResult {
    /// 是否找到
    pub found: bool,
    /// 版本号
    pub version: Option<String>,
    /// 安装路径
    pub path: Option<PathBuf>,
    /// 来源描述
    pub source: Option<String>,
}

impl DetectionResult {
    /// 创建"找到"的结果
    pub fn found(version: String, path: PathBuf, source: &str) -> Self {
        Self {
            found: true,
            version: Some(version),
            path: Some(path),
            source: Some(source.to_string()),
        }
    }

    /// 创建"未找到"的结果
    pub fn not_found() -> Self {
        Self {
            found: false,
            version: None,
            path: None,
            source: None,
        }
    }
}

/// 依赖检测器 trait
///
/// 定义依赖项检测的抽象接口。
/// 每个检测器负责检测一种特定的依赖（如 Node.js）。
pub trait DependencyDetector: Send + Sync {
    /// 检测器名称
    fn name(&self) -> &str;

    /// 显示名称（用于 UI）
    fn display_name(&self) -> &str;

    /// 执行检测
    fn detect(&self) -> Result<DetectionResult, DetectorError>;

    /// 是否为必需依赖
    fn is_required(&self) -> bool {
        true
    }

    /// 依赖描述
    fn description(&self) -> &str {
        ""
    }
}

/// 安装器错误
#[derive(Error, Debug, Clone)]
pub enum InstallerError {
    #[error("安装失败: {0}")]
    InstallFailed(String),
    #[error("未找到: {0}")]
    NotFound(String),
    #[error("命令执行失败: {0}")]
    CommandFailed(String),
    #[error("工具不支持安装: {0}")]
    ToolNotFound(String),
}

/// 工具信息
#[derive(Debug, Clone)]
pub struct ToolInfo {
    /// 工具名称
    pub name: String,
    /// 版本
    pub version: Option<String>,
    /// 是否已安装
    pub installed: bool,
}

impl ToolInfo {
    /// 创建已安装的工具信息
    pub fn installed(name: &str, version: Option<String>) -> Self {
        Self {
            name: name.to_string(),
            version,
            installed: true,
        }
    }

    /// 创建未安装的工具信息
    pub fn not_installed(name: &str) -> Self {
        Self {
            name: name.to_string(),
            version: None,
            installed: false,
        }
    }
}

/// 工具安装器 trait
///
/// 定义工具安装的抽象接口。
/// 用于安装 npm 全局工具等。
pub trait ToolInstaller: Send + Sync {
    /// 检查工具是否已安装
    fn check_tool(&self, name: &str) -> Result<ToolInfo, InstallerError>;

    /// 安装工具
    fn install_tool(&self, name: &str) -> Result<ToolInfo, InstallerError>;

    /// 卸载工具
    fn uninstall_tool(&self, name: &str) -> Result<(), InstallerError>;

    /// 更新工具
    fn update_tool(&self, name: &str) -> Result<ToolInfo, InstallerError>;
}

// ============================================================================
// Mock implementations for testing
// ============================================================================

#[cfg(test)]
pub mod mock {
    use super::*;
    use std::collections::HashMap;
    use std::sync::RwLock;

    /// Mock 依赖检测器
    pub struct MockDetector {
        name: String,
        display_name: String,
        result: Result<DetectionResult, DetectorError>,
        required: bool,
        description: String,
    }

    impl MockDetector {
        /// 创建返回"找到"的 Mock 检测器
        #[must_use]
        pub fn found(name: &str, version: &str) -> Self {
            Self {
                name: name.to_string(),
                display_name: name.to_string(),
                result: Ok(DetectionResult::found(
                    version.to_string(),
                    PathBuf::from("/mock/path"),
                    "mock",
                )),
                required: true,
                description: String::new(),
            }
        }

        /// 创建返回"未找到"的 Mock 检测器
        #[must_use]
        pub fn not_found(name: &str) -> Self {
            Self {
                name: name.to_string(),
                display_name: name.to_string(),
                result: Ok(DetectionResult::not_found()),
                required: true,
                description: String::new(),
            }
        }

        /// 创建返回"版本过低"的 Mock 检测器
        #[must_use]
        pub fn outdated(name: &str, min: &str, actual: &str) -> Self {
            Self {
                name: name.to_string(),
                display_name: name.to_string(),
                result: Err(DetectorError::VersionTooLow {
                    min: min.to_string(),
                    actual: actual.to_string(),
                }),
                required: true,
                description: String::new(),
            }
        }

        /// 设置是否必需
        #[must_use]
        pub fn required(mut self, required: bool) -> Self {
            self.required = required;
            self
        }

        /// 设置描述
        #[must_use]
        pub fn with_description(mut self, desc: &str) -> Self {
            self.description = desc.to_string();
            self
        }
    }

    impl DependencyDetector for MockDetector {
        fn name(&self) -> &str {
            &self.name
        }

        fn display_name(&self) -> &str {
            &self.display_name
        }

        fn detect(&self) -> Result<DetectionResult, DetectorError> {
            self.result.clone()
        }

        fn is_required(&self) -> bool {
            self.required
        }

        fn description(&self) -> &str {
            &self.description
        }
    }

    /// Mock 工具安装器
    ///
    /// 注意：使用 `std::sync::RwLock` 而非 `tokio::sync::RwLock`，
    /// 因为 `ToolInstaller` trait 的方法是同步的，不能使用 async。
    pub struct MockInstaller {
        /// 预设的工具状态
        tools: RwLock<HashMap<String, ToolInfo>>,
        /// 安装是否应该失败
        should_fail: bool,
    }

    impl MockInstaller {
        /// 创建新的 Mock 安装器
        #[must_use]
        pub fn new() -> Self {
            Self {
                tools: RwLock::new(HashMap::new()),
                should_fail: false,
            }
        }

        /// 添加预设的工具
        #[must_use]
        pub fn with_tool(self, name: &str, version: Option<&str>) -> Self {
            self.tools.write().unwrap().insert(
                name.to_string(),
                ToolInfo::installed(name, version.map(|v| v.to_string())),
            );
            self
        }

        /// 设置安装是否失败
        pub fn set_should_fail(&mut self, should_fail: bool) {
            self.should_fail = should_fail;
        }
    }

    impl Default for MockInstaller {
        fn default() -> Self {
            Self::new()
        }
    }

    impl ToolInstaller for MockInstaller {
        fn check_tool(&self, name: &str) -> Result<ToolInfo, InstallerError> {
            let tools = self.tools.read().unwrap();
            if let Some(info) = tools.get(name) {
                Ok(info.clone())
            } else {
                Ok(ToolInfo::not_installed(name))
            }
        }

        fn install_tool(&self, name: &str) -> Result<ToolInfo, InstallerError> {
            if self.should_fail {
                return Err(InstallerError::InstallFailed(
                    "Mock install failed".to_string(),
                ));
            }

            let info = ToolInfo::installed(name, Some("1.0.0".to_string()));
            self.tools
                .write()
                .unwrap()
                .insert(name.to_string(), info.clone());
            Ok(info)
        }

        fn uninstall_tool(&self, name: &str) -> Result<(), InstallerError> {
            if self.should_fail {
                return Err(InstallerError::InstallFailed(
                    "Mock uninstall failed".to_string(),
                ));
            }

            self.tools.write().unwrap().remove(name);
            Ok(())
        }

        fn update_tool(&self, name: &str) -> Result<ToolInfo, InstallerError> {
            if self.should_fail {
                return Err(InstallerError::InstallFailed(
                    "Mock update failed".to_string(),
                ));
            }

            let info = ToolInfo::installed(name, Some("2.0.0".to_string()));
            self.tools
                .write()
                .unwrap()
                .insert(name.to_string(), info.clone());
            Ok(info)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mock::*;
    use super::*;

    #[test]
    fn test_detection_result_found() {
        let result = DetectionResult::found(
            "1.0.0".to_string(),
            PathBuf::from("/usr/bin/node"),
            "system",
        );
        assert!(result.found);
        assert_eq!(result.version, Some("1.0.0".to_string()));
        assert_eq!(result.path, Some(PathBuf::from("/usr/bin/node")));
        assert_eq!(result.source, Some("system".to_string()));
    }

    #[test]
    fn test_detection_result_not_found() {
        let result = DetectionResult::not_found();
        assert!(!result.found);
        assert!(result.version.is_none());
        assert!(result.path.is_none());
    }

    #[test]
    fn test_mock_detector_found() {
        let detector = MockDetector::found("nodejs", "20.0.0");
        assert_eq!(detector.name(), "nodejs");

        let result = detector.detect().unwrap();
        assert!(result.found);
        assert_eq!(result.version, Some("20.0.0".to_string()));
    }

    #[test]
    fn test_mock_detector_not_found() {
        let detector = MockDetector::not_found("nodejs");
        let result = detector.detect().unwrap();
        assert!(!result.found);
    }

    #[test]
    fn test_mock_detector_outdated() {
        let detector = MockDetector::outdated("nodejs", "18.0.0", "16.0.0");
        let result = detector.detect();
        assert!(result.is_err());

        match result.unwrap_err() {
            DetectorError::VersionTooLow { min, actual } => {
                assert_eq!(min, "18.0.0");
                assert_eq!(actual, "16.0.0");
            }
            _ => panic!("Expected VersionTooLow error"),
        }
    }

    #[test]
    fn test_mock_installer_check_tool() {
        let installer = MockInstaller::new().with_tool("npm", Some("10.0.0"));

        let info = installer.check_tool("npm").unwrap();
        assert!(info.installed);
        assert_eq!(info.version, Some("10.0.0".to_string()));

        let info = installer.check_tool("unknown").unwrap();
        assert!(!info.installed);
    }

    #[test]
    fn test_mock_installer_install_tool() {
        let installer = MockInstaller::new();

        // 安装前不存在
        let info = installer.check_tool("opencode").unwrap();
        assert!(!info.installed);

        // 安装
        let info = installer.install_tool("opencode").unwrap();
        assert!(info.installed);

        // 安装后存在
        let info = installer.check_tool("opencode").unwrap();
        assert!(info.installed);
    }

    #[test]
    fn test_mock_installer_failure() {
        let mut installer = MockInstaller::new();
        installer.set_should_fail(true);

        let result = installer.install_tool("test");
        assert!(result.is_err());
    }
}

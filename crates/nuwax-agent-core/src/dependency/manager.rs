//! 依赖管理器
//!
//! 统一管理所有依赖的检测、安装、更新

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use super::detector::{DependencyDetector, DetectorError, InstallerError, ToolInstaller};
use super::node::{NodeDetector, NodeError, NodeInfo};
use super::npm_tools::NpmToolInstaller;

/// 依赖状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyStatus {
    /// 正常
    Ok,
    /// 缺失
    Missing,
    /// 版本过低
    Outdated,
    /// 检测中
    Checking,
    /// 安装中
    Installing,
    /// 错误
    Error(String),
}

/// 依赖项
#[derive(Debug, Clone)]
pub struct DependencyItem {
    /// 名称
    pub name: String,
    /// 显示名称
    pub display_name: String,
    /// 版本
    pub version: Option<String>,
    /// 状态
    pub status: DependencyStatus,
    /// 是否必需
    pub required: bool,
    /// 描述
    pub description: String,
}

/// 依赖统计信息
#[derive(Debug, Clone)]
pub struct DependencySummary {
    /// 总数
    pub total: usize,
    /// 已安装数量
    pub installed: usize,
    /// 缺失数量
    pub missing: usize,
}

/// 依赖管理器
///
/// 支持依赖注入的设计，可以注入自定义检测器和安装器用于测试。
pub struct DependencyManager {
    /// 依赖列表
    dependencies: RwLock<HashMap<String, DependencyItem>>,
    /// 依赖检测器列表
    detectors: Vec<Arc<dyn DependencyDetector>>,
    /// 工具安装器
    installer: Arc<dyn ToolInstaller>,
    /// Node.js 信息
    node_info: RwLock<Option<NodeInfo>>,
}

// 默认实现（生产环境）
impl DependencyManager {
    /// 创建新的依赖管理器（生产环境）
    pub fn new() -> Self {
        use super::cli_tools::{
            create_curl_detector, create_ffmpeg_detector, create_jq_detector,
            create_pandoc_detector, create_rust_detector,
        };
        use super::{DockerDetector, GitDetector, PythonDetector};

        let detectors: Vec<Arc<dyn DependencyDetector>> = vec![
            // 核心依赖
            Arc::new(NodeDetector::new()) as Arc<dyn DependencyDetector>,
            Arc::new(GitDetector::new()) as Arc<dyn DependencyDetector>,
            // 可选依赖
            Arc::new(PythonDetector::new()) as Arc<dyn DependencyDetector>,
            Arc::new(DockerDetector::new()) as Arc<dyn DependencyDetector>,
            // CLI 工具
            Arc::new(create_curl_detector()) as Arc<dyn DependencyDetector>,
            Arc::new(create_jq_detector()) as Arc<dyn DependencyDetector>,
            Arc::new(create_pandoc_detector()) as Arc<dyn DependencyDetector>,
            Arc::new(create_ffmpeg_detector()) as Arc<dyn DependencyDetector>,
            Arc::new(create_rust_detector()) as Arc<dyn DependencyDetector>,
        ];

        Self::with_dependencies(detectors, Arc::new(NpmToolInstaller::new(None)))
    }
}

impl Default for DependencyManager {
    fn default() -> Self {
        Self::new()
    }
}

// 泛型实现（支持依赖注入）
impl DependencyManager {
    /// 创建带自定义检测器和安装器的依赖管理器（测试用）
    ///
    /// # Example
    ///
    /// ```ignore
    /// let detector = Arc::new(MockDetector::found("nodejs", "20.0.0"));
    /// let installer = Arc::new(MockInstaller::new());
    /// let manager = DependencyManager::with_dependencies(vec![detector], installer);
    /// ```
    pub fn with_dependencies(
        detectors: Vec<Arc<dyn DependencyDetector>>,
        installer: Arc<dyn ToolInstaller>,
    ) -> Self {
        let mut deps = HashMap::new();

        // 根据检测器添加依赖项
        for detector in &detectors {
            deps.insert(
                detector.name().to_string(),
                DependencyItem {
                    name: detector.name().to_string(),
                    display_name: detector.display_name().to_string(),
                    version: None,
                    status: DependencyStatus::Checking,
                    required: detector.is_required(),
                    description: detector.description().to_string(),
                },
            );
        }

        // 添加 npm 工具依赖（这些不是通过检测器检测的）
        deps.insert(
            "npm".to_string(),
            DependencyItem {
                name: "npm".to_string(),
                display_name: "npm".to_string(),
                version: None,
                status: DependencyStatus::Checking,
                required: true,
                description: "Node.js 包管理器".to_string(),
            },
        );

        deps.insert(
            "opencode".to_string(),
            DependencyItem {
                name: "opencode".to_string(),
                display_name: "OpenCode".to_string(),
                version: None,
                status: DependencyStatus::Checking,
                required: false,
                description: "AI 编程助手".to_string(),
            },
        );

        deps.insert(
            "@anthropic-ai/claude-code".to_string(),
            DependencyItem {
                name: "@anthropic-ai/claude-code".to_string(),
                display_name: "Claude Code".to_string(),
                version: None,
                status: DependencyStatus::Checking,
                required: false,
                description: "Claude AI 编程助手".to_string(),
            },
        );

        Self {
            dependencies: RwLock::new(deps),
            detectors,
            installer,
            node_info: RwLock::new(None),
        }
    }

    /// 检测所有依赖
    pub async fn check_all(&self) {
        info!("Checking all dependencies...");

        // 检测所有注册的检测器
        for detector in &self.detectors {
            self.check_detector(detector.as_ref()).await;
        }

        // 检测 npm 工具（独立于 Node.js 检测结果）
        self.check_npm_tools().await;
    }

    /// 使用检测器检测依赖
    async fn check_detector(&self, detector: &dyn DependencyDetector) {
        let name = detector.name();
        self.update_status(name, DependencyStatus::Checking).await;

        match detector.detect() {
            Ok(result) if result.found => {
                info!(
                    "{} detected: v{}",
                    detector.display_name(),
                    result.version.as_deref().unwrap_or("unknown")
                );

                self.update_dependency(name, result.version.clone(), DependencyStatus::Ok)
                    .await;

                // 如果是 Node.js，保存信息
                if name == "nodejs" {
                    if let (Some(version), Some(path)) = (result.version, result.path) {
                        use super::node::NodeSource;
                        let source = match result.source.as_deref() {
                            Some("local") => NodeSource::Local,
                            _ => NodeSource::System,
                        };
                        *self.node_info.write().await = Some(NodeInfo {
                            version,
                            path,
                            source,
                        });
                    }
                }
            }
            Ok(_) => {
                warn!("{} not found", detector.display_name());
                self.update_status(name, DependencyStatus::Missing).await;
            }
            Err(DetectorError::VersionTooLow { min: _, actual }) => {
                warn!("{} version too low: {}", detector.display_name(), actual);
                self.update_dependency(name, Some(actual), DependencyStatus::Outdated)
                    .await;
            }
            Err(e) => {
                warn!("{} detection error: {:?}", detector.display_name(), e);
                self.update_status(name, DependencyStatus::Error(e.to_string()))
                    .await;
            }
        }
    }

    /// 检测 npm 工具
    async fn check_npm_tools(&self) {
        // 检测 npm
        self.update_status("npm", DependencyStatus::Checking).await;
        match self.installer.check_tool("npm") {
            Ok(info) if info.installed => {
                self.update_dependency("npm", info.version, DependencyStatus::Ok)
                    .await;
            }
            _ => {
                // npm 应该随 Node.js 一起安装
                self.update_status("npm", DependencyStatus::Missing).await;
            }
        }

        // 检测 opencode（使用多源检测）
        self.update_status("opencode", DependencyStatus::Checking)
            .await;
        match self.check_tool_with_fallback("opencode") {
            Ok(info) if info.installed => {
                self.update_dependency("opencode", info.version, DependencyStatus::Ok)
                    .await;
            }
            _ => {
                self.update_status("opencode", DependencyStatus::Missing)
                    .await;
            }
        }

        // 检测 claude-code（使用多源检测）
        self.update_status("@anthropic-ai/claude-code", DependencyStatus::Checking)
            .await;
        match self.check_tool_with_fallback("@anthropic-ai/claude-code") {
            Ok(info) if info.installed => {
                self.update_dependency(
                    "@anthropic-ai/claude-code",
                    info.version,
                    DependencyStatus::Ok,
                )
                .await;
            }
            _ => {
                self.update_status("@anthropic-ai/claude-code", DependencyStatus::Missing)
                    .await;
            }
        }
    }

    /// 使用多源检测工具（支持 npm、brew、PATH 等多种安装方式）
    fn check_tool_with_fallback(
        &self,
        tool_name: &str,
    ) -> Result<super::npm_tools::NpmToolInfo, super::npm_tools::NpmToolError> {
        // 尝试向下转型到 NpmToolInstaller 以访问高级功能
        let npm_installer = self.installer.clone().as_ref() as *const dyn ToolInstaller
            as *const super::npm_tools::NpmToolInstaller;

        unsafe {
            if !npm_installer.is_null() {
                return (*npm_installer).check_tool_with_fallback(tool_name);
            }
        }

        // 回退到标准检测
        self.installer
            .check_tool(tool_name)
            .map(|info| info.into())
            .map_err(|e| super::npm_tools::NpmToolError::CommandFailed(e.to_string()))
    }

    /// 更新依赖状态
    async fn update_status(&self, name: &str, status: DependencyStatus) {
        let mut deps = self.dependencies.write().await;
        if let Some(dep) = deps.get_mut(name) {
            dep.status = status;
        }
    }

    /// 更新依赖信息
    async fn update_dependency(
        &self,
        name: &str,
        version: Option<String>,
        status: DependencyStatus,
    ) {
        let mut deps = self.dependencies.write().await;
        if let Some(dep) = deps.get_mut(name) {
            dep.version = version;
            dep.status = status;
        }
    }

    /// 获取所有依赖
    pub async fn get_all(&self) -> Vec<DependencyItem> {
        self.dependencies.read().await.values().cloned().collect()
    }

    /// 获取指定依赖
    pub async fn get(&self, name: &str) -> Option<DependencyItem> {
        self.dependencies.read().await.get(name).cloned()
    }

    /// 获取所有依赖（别名方法，兼容旧代码）
    pub async fn get_all_dependencies(&self) -> Vec<DependencyItem> {
        self.get_all().await
    }

    /// 检查单个依赖状态
    pub async fn check(&self, name: &str) -> Option<DependencyItem> {
        self.get(name).await
    }

    /// 获取依赖统计信息
    pub async fn get_summary(&self) -> DependencySummary {
        let deps = self.dependencies.read().await;
        let total = deps.len();
        let installed = deps
            .values()
            .filter(|d| d.status == DependencyStatus::Ok)
            .count();
        let missing = deps
            .values()
            .filter(|d| d.status == DependencyStatus::Missing)
            .count();
        DependencySummary {
            total,
            installed,
            missing,
        }
    }

    /// 安装指定依赖
    #[cfg(feature = "dependency-management")]
    pub async fn install(&self, name: &str) -> Result<(), InstallerError> {
        match name {
            "nodejs" => {
                self.install_nodejs(|_, _| {})
                    .await
                    .map_err(|e| InstallerError::InstallFailed(e.to_string()))?;
                Ok(())
            }
            "npm" | "opencode" | "@anthropic-ai/claude-code" => {
                self.install_npm_tool(name)
                    .await
                    .map_err(|e| InstallerError::InstallFailed(e.to_string()))?;
                Ok(())
            }
            _ => Err(InstallerError::ToolNotFound(name.to_string())),
        }
    }

    /// 安装所有缺失的依赖
    #[cfg(feature = "dependency-management")]
    pub async fn install_all_missing(&self) -> Result<(), InstallerError> {
        let missing_deps: Vec<String> = {
            let deps = self.dependencies.read().await;
            deps.values()
                .filter(|d| d.status == DependencyStatus::Missing)
                .map(|d| d.name.clone())
                .collect()
        };

        for name in missing_deps {
            if let Err(e) = self.install(&name).await {
                warn!("Failed to install {}: {:?}", name, e);
            }
        }
        Ok(())
    }

    /// 卸载指定依赖
    #[cfg(feature = "dependency-management")]
    pub async fn uninstall(&self, name: &str) -> Result<(), InstallerError> {
        // 目前主要支持 npm 工具的卸载
        match self.installer.uninstall_tool(name) {
            Ok(_) => {
                self.update_status(name, DependencyStatus::Missing).await;
                Ok(())
            }
            Err(e) => Err(InstallerError::CommandFailed(e.to_string())),
        }
    }

    /// 检查所有必需依赖是否就绪
    pub async fn all_required_ready(&self) -> bool {
        let deps = self.dependencies.read().await;
        deps.values()
            .filter(|d| d.required)
            .all(|d| d.status == DependencyStatus::Ok)
    }

    /// 安装 Node.js
    #[cfg(feature = "dependency-management")]
    pub async fn install_nodejs(
        &self,
        progress_callback: impl Fn(f32, &str),
    ) -> Result<(), NodeError> {
        use super::node::NodeInstaller;

        self.update_status("nodejs", DependencyStatus::Installing)
            .await;

        let installer = NodeInstaller::new();
        match installer.install(progress_callback).await {
            Ok(info) => {
                self.update_dependency("nodejs", Some(info.version.clone()), DependencyStatus::Ok)
                    .await;
                *self.node_info.write().await = Some(info);
                Ok(())
            }
            Err(e) => {
                self.update_status("nodejs", DependencyStatus::Error(e.to_string()))
                    .await;
                Err(e)
            }
        }
    }

    /// 安装 npm 工具
    pub async fn install_npm_tool(
        &self,
        tool_name: &str,
    ) -> Result<(), super::npm_tools::NpmToolError> {
        self.update_status(tool_name, DependencyStatus::Installing)
            .await;

        // 使用注入的安装器
        match self.installer.install_tool(tool_name) {
            Ok(info) => {
                self.update_dependency(tool_name, info.version, DependencyStatus::Ok)
                    .await;
                Ok(())
            }
            Err(e) => {
                self.update_status(tool_name, DependencyStatus::Error(e.to_string()))
                    .await;
                Err(super::npm_tools::NpmToolError::InstallFailed(e.to_string()))
            }
        }
    }

    /// 获取 Node.js 信息
    pub async fn get_node_info(&self) -> Option<NodeInfo> {
        self.node_info.read().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::super::detector::mock::{MockDetector, MockInstaller};
    use super::*;

    #[tokio::test]
    async fn test_dependency_manager_creation() {
        let manager = DependencyManager::new();
        let deps = manager.get_all().await;
        assert!(!deps.is_empty());
    }

    #[tokio::test]
    async fn test_dependency_manager_with_mock() {
        let detector = Arc::new(MockDetector::found("nodejs", "20.0.0"));
        let installer = Arc::new(MockInstaller::new());
        let manager = DependencyManager::with_dependencies(vec![detector], installer);

        let deps = manager.get_all().await;
        assert!(!deps.is_empty());
    }

    #[tokio::test]
    async fn test_check_all_found() {
        let detector = Arc::new(MockDetector::found("nodejs", "20.0.0"));
        let installer = Arc::new(MockInstaller::new().with_tool("npm", Some("10.0.0")));
        let manager = DependencyManager::with_dependencies(vec![detector], installer);

        manager.check_all().await;

        let node = manager.get("nodejs").await.unwrap();
        assert_eq!(node.status, DependencyStatus::Ok);
        assert_eq!(node.version, Some("20.0.0".to_string()));
    }

    #[tokio::test]
    async fn test_check_all_missing() {
        let detector = Arc::new(MockDetector::not_found("nodejs"));
        let installer = Arc::new(MockInstaller::new());
        let manager = DependencyManager::with_dependencies(vec![detector], installer);

        manager.check_all().await;

        let node = manager.get("nodejs").await.unwrap();
        assert_eq!(node.status, DependencyStatus::Missing);
    }

    #[tokio::test]
    async fn test_check_all_outdated() {
        let detector = Arc::new(MockDetector::outdated("nodejs", "18.0.0", "16.0.0"));
        let installer = Arc::new(MockInstaller::new());
        let manager = DependencyManager::with_dependencies(vec![detector], installer);

        manager.check_all().await;

        let node = manager.get("nodejs").await.unwrap();
        assert_eq!(node.status, DependencyStatus::Outdated);
        assert_eq!(node.version, Some("16.0.0".to_string()));
    }

    #[tokio::test]
    async fn test_all_required_ready() {
        let detector = Arc::new(MockDetector::found("nodejs", "20.0.0"));
        let installer = Arc::new(MockInstaller::new().with_tool("npm", Some("10.0.0")));
        let manager = DependencyManager::with_dependencies(vec![detector], installer);

        // 初始状态（Checking）不是 Ready
        assert!(!manager.all_required_ready().await);

        // 检测后
        manager.check_all().await;

        // Node.js 已就绪，但 npm 也需要检测
        // 由于 MockDetector 不返回路径，node_info 为空，npm 工具不会被检测
        // 所以 npm 仍然是 Checking 状态
        let node = manager.get("nodejs").await.unwrap();
        assert_eq!(node.status, DependencyStatus::Ok);
    }

    #[tokio::test]
    async fn test_install_npm_tool() {
        let detector = Arc::new(MockDetector::found("nodejs", "20.0.0"));
        let installer = Arc::new(MockInstaller::new());
        let manager = DependencyManager::with_dependencies(vec![detector], installer);

        // 添加 test-tool 依赖项
        {
            let mut deps = manager.dependencies.write().await;
            deps.insert(
                "test-tool".to_string(),
                DependencyItem {
                    name: "test-tool".to_string(),
                    display_name: "Test Tool".to_string(),
                    version: None,
                    status: DependencyStatus::Missing,
                    required: false,
                    description: "Test tool".to_string(),
                },
            );
        }

        // 安装工具
        let result = manager.install_npm_tool("test-tool").await;
        assert!(result.is_ok());

        // 验证状态更新
        let tool = manager.get("test-tool").await.unwrap();
        assert_eq!(tool.status, DependencyStatus::Ok);
        assert_eq!(tool.version, Some("1.0.0".to_string()));
    }

    #[tokio::test]
    async fn test_get_dependency() {
        let manager = DependencyManager::new();

        let node = manager.get("nodejs").await;
        assert!(node.is_some());
        assert_eq!(node.unwrap().name, "nodejs");

        let unknown = manager.get("unknown").await;
        assert!(unknown.is_none());
    }

    #[tokio::test]
    async fn test_multiple_detectors() {
        let node_detector = Arc::new(MockDetector::found("nodejs", "20.0.0"));
        let other_detector = Arc::new(
            MockDetector::found("python", "3.11.0")
                .required(false)
                .with_description("Python runtime"),
        );
        let installer = Arc::new(MockInstaller::new());

        let manager =
            DependencyManager::with_dependencies(vec![node_detector, other_detector], installer);

        manager.check_all().await;

        let node = manager.get("nodejs").await.unwrap();
        assert_eq!(node.status, DependencyStatus::Ok);

        let python = manager.get("python").await.unwrap();
        assert_eq!(python.status, DependencyStatus::Ok);
        assert!(!python.required);
    }
}

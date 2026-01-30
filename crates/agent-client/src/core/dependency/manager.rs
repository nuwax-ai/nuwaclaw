//! 依赖管理器
//!
//! 统一管理所有依赖的检测、安装、更新

use std::collections::HashMap;
use tokio::sync::RwLock;
use tracing::{info, warn};

use super::node::{NodeDetector, NodeInfo, NodeError};
use super::npm_tools::{NpmToolInstaller, NpmToolError};

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

/// 依赖管理器
pub struct DependencyManager {
    /// 依赖列表
    dependencies: RwLock<HashMap<String, DependencyItem>>,
    /// Node.js 检测器
    node_detector: NodeDetector,
    /// Node.js 信息
    node_info: RwLock<Option<NodeInfo>>,
}

impl DependencyManager {
    /// 创建新的依赖管理器
    pub fn new() -> Self {
        let mut deps = HashMap::new();

        // 添加默认依赖项
        deps.insert(
            "nodejs".to_string(),
            DependencyItem {
                name: "nodejs".to_string(),
                display_name: "Node.js".to_string(),
                version: None,
                status: DependencyStatus::Checking,
                required: true,
                description: "JavaScript 运行时".to_string(),
            },
        );

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
            node_detector: NodeDetector::new(),
            node_info: RwLock::new(None),
        }
    }

    /// 检测所有依赖
    pub async fn check_all(&self) {
        info!("Checking all dependencies...");

        // 检测 Node.js
        self.check_nodejs().await;

        // 如果 Node.js 存在，检测 npm 工具
        if self.node_info.read().await.is_some() {
            self.check_npm_tools().await;
        }
    }

    /// 检测 Node.js
    async fn check_nodejs(&self) {
        self.update_status("nodejs", DependencyStatus::Checking).await;

        match self.node_detector.detect() {
            Ok(info) => {
                info!("Node.js detected: v{}", info.version);

                self.update_dependency(
                    "nodejs",
                    Some(info.version.clone()),
                    DependencyStatus::Ok,
                )
                .await;

                *self.node_info.write().await = Some(info);
            }
            Err(NodeError::NotFound) => {
                warn!("Node.js not found");
                self.update_status("nodejs", DependencyStatus::Missing).await;
            }
            Err(NodeError::VersionTooLow { min, actual }) => {
                warn!("Node.js version too low: {} < {}", actual, min);
                self.update_dependency("nodejs", Some(actual), DependencyStatus::Outdated)
                    .await;
            }
            Err(e) => {
                warn!("Node.js detection error: {:?}", e);
                self.update_status("nodejs", DependencyStatus::Error(e.to_string()))
                    .await;
            }
        }
    }

    /// 检测 npm 工具
    async fn check_npm_tools(&self) {
        let node_info = self.node_info.read().await;
        let node_path = node_info.as_ref().map(|i| i.path.clone());
        drop(node_info);

        let installer = NpmToolInstaller::new(node_path);

        // 检测 npm
        self.update_status("npm", DependencyStatus::Checking).await;
        match installer.check_tool("npm") {
            Ok(info) if info.installed => {
                self.update_dependency("npm", info.version, DependencyStatus::Ok)
                    .await;
            }
            _ => {
                // npm 应该随 Node.js 一起安装
                self.update_status("npm", DependencyStatus::Missing).await;
            }
        }

        // 检测 opencode
        self.update_status("opencode", DependencyStatus::Checking).await;
        match installer.check_tool("opencode") {
            Ok(info) if info.installed => {
                self.update_dependency("opencode", info.version, DependencyStatus::Ok)
                    .await;
            }
            _ => {
                self.update_status("opencode", DependencyStatus::Missing)
                    .await;
            }
        }

        // 检测 claude-code
        self.update_status("@anthropic-ai/claude-code", DependencyStatus::Checking)
            .await;
        match installer.check_tool("@anthropic-ai/claude-code") {
            Ok(info) if info.installed => {
                self.update_dependency("@anthropic-ai/claude-code", info.version, DependencyStatus::Ok)
                    .await;
            }
            _ => {
                self.update_status("@anthropic-ai/claude-code", DependencyStatus::Missing)
                    .await;
            }
        }
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

        self.update_status("nodejs", DependencyStatus::Installing).await;

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
    pub async fn install_npm_tool(&self, tool_name: &str) -> Result<(), NpmToolError> {
        let node_info = self.node_info.read().await;
        let node_path = node_info.as_ref().map(|i| i.path.clone());
        drop(node_info);

        self.update_status(tool_name, DependencyStatus::Installing).await;

        let installer = NpmToolInstaller::new(node_path);
        match installer.install_tool(tool_name) {
            Ok(info) => {
                self.update_dependency(tool_name, info.version, DependencyStatus::Ok)
                    .await;
                Ok(())
            }
            Err(e) => {
                self.update_status(tool_name, DependencyStatus::Error(e.to_string()))
                    .await;
                Err(e)
            }
        }
    }

    /// 获取 Node.js 信息
    pub async fn get_node_info(&self) -> Option<NodeInfo> {
        self.node_info.read().await.clone()
    }
}

impl Default for DependencyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dependency_manager_creation() {
        let manager = DependencyManager::new();
        let deps = manager.get_all().await;
        assert!(!deps.is_empty());
    }
}

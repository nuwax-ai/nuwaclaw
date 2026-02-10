//! 依赖管理 ViewModel
//!
//! 负责将 core::dependency 的业务数据转换为 UI 友好的格式
//! 使用字符串图标名称以支持不同 UI 框架

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::{Mutex, RwLock};

use super::super::api::traits::DependencyApi;
use super::super::dependency::manager::DependencyManager as CoreDependencyManager;
use super::super::dependency::manager::DependencyStatus as CoreDependencyStatus;
use super::super::dependency::node::NodeSource;

/// UI 图标名称类型
///
/// 使用字符串而非特定 UI 框架的图标类型
/// 允许不同 UI 层自行映射到对应的图标实现
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum UIIconName {
    Globe,
    Eye,
    Settings,
    Palette,
    File,
    Loader,
    CircleCheck,
    CircleX,
    TriangleAlert,
    #[default]
    Unknown,
}

impl UIIconName {
    /// 获取图标名称字符串
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Globe => "globe",
            Self::Eye => "eye",
            Self::Settings => "settings",
            Self::Palette => "palette",
            Self::File => "file",
            Self::Loader => "loader",
            Self::CircleCheck => "circle-check",
            Self::CircleX => "circle-x",
            Self::TriangleAlert => "triangle-alert",
            Self::Unknown => "unknown",
        }
    }
}

/// 依赖名称映射配置
struct DependencyNameMapping {
    /// 内部名称（用于 core 层操作）
    core_name: &'static str,
    /// UI 显示名称
    display_name: &'static str,
    /// 是否必需
    required: bool,
}

/// 预定义的依赖映射表
const DEPENDENCY_MAPPINGS: &[DependencyNameMapping] = &[
    // 必需依赖
    DependencyNameMapping {
        core_name: "nodejs",
        display_name: "Node.js",
        required: true,
    },
    DependencyNameMapping {
        core_name: "git",
        display_name: "Git",
        required: true,
    },
    DependencyNameMapping {
        core_name: "npm",
        display_name: "npm",
        required: true,
    },
    // 可选依赖
    DependencyNameMapping {
        core_name: "python",
        display_name: "Python",
        required: false,
    },
    DependencyNameMapping {
        core_name: "docker",
        display_name: "Docker",
        required: false,
    },
    DependencyNameMapping {
        core_name: "rust",
        display_name: "Rust/Cargo",
        required: false,
    },
    // CLI 工具
    DependencyNameMapping {
        core_name: "curl",
        display_name: "cURL",
        required: false,
    },
    DependencyNameMapping {
        core_name: "jq",
        display_name: "jq",
        required: false,
    },
    DependencyNameMapping {
        core_name: "pandoc",
        display_name: "Pandoc",
        required: false,
    },
    DependencyNameMapping {
        core_name: "ffmpeg",
        display_name: "FFmpeg",
        required: false,
    },
    // npm 工具
    DependencyNameMapping {
        core_name: "opencode",
        display_name: "OpenCode",
        required: false,
    },
    DependencyNameMapping {
        core_name: "@anthropic-ai/claude-code",
        display_name: "Claude Code",
        required: false,
    },
];

/// UI 层的依赖状态（与 core::DependencyStatus 解耦）
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UIDependencyStatus {
    /// 检查中
    Checking,
    /// 已安装
    Ok,
    /// 未安装
    Missing,
    /// 版本过低
    Outdated,
    /// 安装中
    Installing,
    /// 错误（保留错误信息）
    Error(String),
}

impl UIDependencyStatus {
    /// 从核心状态转换
    pub fn from_core(status: &CoreDependencyStatus) -> Self {
        match status {
            CoreDependencyStatus::Ok => Self::Ok,
            CoreDependencyStatus::Missing => Self::Missing,
            CoreDependencyStatus::Outdated => Self::Outdated,
            CoreDependencyStatus::Checking => Self::Checking,
            CoreDependencyStatus::Installing => Self::Installing,
            CoreDependencyStatus::Error(msg) => Self::Error(msg.clone()),
        }
    }

    /// 获取状态标签
    pub fn label(&self) -> &str {
        match self {
            Self::Checking => "检查中...",
            Self::Ok => "已安装",
            Self::Missing => "未安装",
            Self::Outdated => "需要更新",
            Self::Installing => "安装中...",
            Self::Error(_) => "安装失败",
        }
    }

    /// 获取图标
    pub fn icon(&self) -> UIIconName {
        match self {
            Self::Checking | Self::Installing => UIIconName::Loader,
            Self::Ok => UIIconName::CircleCheck,
            Self::Missing | Self::Error(_) => UIIconName::CircleX,
            Self::Outdated => UIIconName::TriangleAlert,
        }
    }

    /// 是否可以安装
    pub fn can_install(&self) -> bool {
        matches!(self, Self::Missing | Self::Outdated)
    }

    /// 是否为错误状态
    pub fn is_error(&self) -> bool {
        matches!(self, Self::Error(_))
    }

    /// 获取错误信息
    pub fn error_message(&self) -> Option<&str> {
        match self {
            Self::Error(msg) => Some(msg),
            _ => None,
        }
    }
}

/// UI 层的依赖项（与 core::DependencyItem 解耦）
#[derive(Debug, Clone, serde::Serialize)]
pub struct UIDependencyItem {
    /// 内部名称（用于操作）
    pub name: String,
    /// 显示名称
    pub display_name: String,
    /// 版本
    pub version: Option<String>,
    /// 来源描述
    pub source: Option<String>,
    /// 状态
    pub status: UIDependencyStatus,
    /// 是否必需
    pub required: bool,
    /// 是否显示安装按钮
    pub can_install: bool,
}

impl UIDependencyItem {
    /// 根据名称获取核心层名称
    pub fn to_core_name(&self) -> &str {
        Self::map_to_core_name(&self.name)
    }

    /// 将 UI 名称映射到核心层名称
    fn map_to_core_name(name: &str) -> &str {
        match name {
            "Node.js" | "nodejs" => "nodejs",
            "claude-code" => "@anthropic-ai/claude-code",
            _ => name,
        }
    }

    /// 将核心层名称映射到 UI 显示名称
    #[allow(dead_code)]
    fn map_to_display_name(core_name: &str) -> &str {
        DEPENDENCY_MAPPINGS
            .iter()
            .find(|m| m.core_name == core_name)
            .map(|m| m.display_name)
            .unwrap_or(core_name)
    }
}

/// 用户操作
#[derive(Debug, Clone)]
pub enum DependencyAction {
    /// 刷新所有依赖状态
    Refresh,
    /// 安装指定依赖
    Install(String),
    /// 安装所有缺失依赖
    InstallAll,
}

/// 依赖管理 ViewModel 状态
#[derive(Debug, Clone, serde::Serialize)]
pub struct DependencyViewModelState {
    /// 依赖项列表
    pub items: Vec<UIDependencyItem>,
    /// 是否正在加载
    pub is_loading: bool,
    /// 是否正在安装
    pub is_installing: bool,
}

impl Default for DependencyViewModelState {
    fn default() -> Self {
        Self {
            items: Self::default_items(),
            is_loading: false,
            is_installing: false,
        }
    }
}

impl DependencyViewModelState {
    /// 从依赖映射表创建默认依赖项列表
    fn default_items() -> Vec<UIDependencyItem> {
        DEPENDENCY_MAPPINGS
            .iter()
            .map(|mapping| UIDependencyItem {
                name: mapping.core_name.to_string(),
                display_name: mapping.display_name.to_string(),
                version: None,
                source: None,
                status: UIDependencyStatus::Checking,
                required: mapping.required,
                can_install: false,
            })
            .collect()
    }

    /// 获取缺失依赖数量
    pub fn missing_count(&self) -> usize {
        self.items
            .iter()
            .filter(|d| {
                d.status == UIDependencyStatus::Missing || d.status == UIDependencyStatus::Outdated
            })
            .count()
    }
}

/// 依赖管理 ViewModel
///
/// 负责：
/// - 将业务数据转换为 UI 友好的格式
/// - 处理用户操作
/// - 管理加载/错误状态
pub struct DependencyViewModel {
    /// UI 状态
    state: Arc<RwLock<DependencyViewModelState>>,
    /// 业务层引用
    core_manager: Arc<CoreDependencyManager>,
    /// 刷新操作锁（防止并发刷新）
    refresh_lock: Arc<Mutex<()>>,
    /// 安装操作锁（防止并发安装）
    install_lock: Arc<Mutex<()>>,
}

impl DependencyViewModel {
    /// 创建新的 ViewModel
    pub fn new(core_manager: Arc<CoreDependencyManager>) -> Self {
        Self {
            state: Arc::new(RwLock::new(DependencyViewModelState::default())),
            core_manager,
            refresh_lock: Arc::new(Mutex::new(())),
            install_lock: Arc::new(Mutex::new(())),
        }
    }

    /// 创建默认的 ViewModel（使用默认的 CoreDependencyManager）
    pub fn with_default_manager() -> Self {
        Self::new(Arc::new(CoreDependencyManager::new()))
    }

    /// 获取当前状态的快照
    pub async fn get_state(&self) -> DependencyViewModelState {
        self.state.read().await.clone()
    }

    /// 处理用户操作
    pub async fn handle_action(&self, action: DependencyAction) {
        match action {
            DependencyAction::Refresh => self.refresh().await,
            DependencyAction::Install(name) => self.install(&name).await,
            DependencyAction::InstallAll => self.install_all().await,
        }
    }

    /// 刷新依赖状态
    ///
    /// 使用互斥锁防止并发刷新
    pub async fn refresh(&self) {
        // 获取刷新锁，防止并发刷新
        let _guard = self.refresh_lock.lock().await;

        // 设置加载状态
        {
            let mut state = self.state.write().await;
            state.is_loading = true;
        }

        // 调用核心检测逻辑
        self.core_manager.check_all().await;

        // 获取检测结果并转换
        let core_deps = self.core_manager.get_all().await;
        let node_info = self.core_manager.get_node_info().await;

        // 更新 UI 状态
        let mut state = self.state.write().await;
        for ui_item in &mut state.items {
            // 查找对应的核心依赖（使用 name 直接匹配，因为 default_items 使用 core_name）
            let core_dep = core_deps.iter().find(|d| {
                d.name == ui_item.name
                    || (ui_item.name == "nodejs" && d.name == "nodejs")
                    || (ui_item.name == "@anthropic-ai/claude-code"
                        && d.name == "@anthropic-ai/claude-code")
            });

            if let Some(core_dep) = core_dep {
                let core_name = &core_dep.name;
                ui_item.status = UIDependencyStatus::from_core(&core_dep.status);
                ui_item.version = core_dep.version.clone();
                ui_item.can_install =
                    ui_item.status.can_install() && Self::is_installable(&ui_item.name);

                // Node.js 特殊处理：添加来源信息
                if core_name == "nodejs" {
                    if let Some(ref info) = node_info {
                        ui_item.source = Some(match info.source {
                            NodeSource::System => "系统全局".to_string(),
                            NodeSource::Local => "客户端目录".to_string(),
                        });
                    }
                }

                // npm 来源
                if core_name == "npm" && ui_item.status == UIDependencyStatus::Ok {
                    ui_item.source = Some("系统全局".to_string());
                }
            }
        }

        state.is_loading = false;
    }

    /// 安装单个依赖
    ///
    /// 使用互斥锁防止并发安装
    pub async fn install(&self, name: &str) {
        // 获取安装锁，防止并发安装
        let _guard = self.install_lock.lock().await;

        // 更新安装状态
        {
            let mut state = self.state.write().await;
            if let Some(item) = state
                .items
                .iter_mut()
                .find(|d| d.display_name == name || d.name == name)
            {
                item.status = UIDependencyStatus::Installing;
                item.can_install = false;
            }
            state.is_installing = true;
        }

        // 获取核心名称
        let tool_name = UIDependencyItem::map_to_core_name(name);

        // 执行安装
        if tool_name == "nodejs" {
            #[cfg(feature = "dependency-management")]
            {
                if let Err(e) = self
                    .core_manager
                    .install_nodejs(|progress, msg| {
                        tracing::info!(
                            "Node.js install progress: {:.0}% - {}",
                            progress * 100.0,
                            msg
                        );
                    })
                    .await
                {
                    tracing::error!("Failed to install Node.js: {}", e);
                    // 更新错误状态
                    let mut state = self.state.write().await;
                    if let Some(item) = state.items.iter_mut().find(|d| d.name == "nodejs") {
                        item.status = UIDependencyStatus::Error(e.to_string());
                    }
                }
            }
        } else if tool_name != "npm" {
            if let Err(e) = self.core_manager.install_npm_tool(tool_name).await {
                tracing::error!("Failed to install '{}': {}", name, e);
                // 更新错误状态
                let mut state = self.state.write().await;
                if let Some(item) = state
                    .items
                    .iter_mut()
                    .find(|d| d.name == tool_name || d.display_name == name)
                {
                    item.status = UIDependencyStatus::Error(e.to_string());
                }
            }
        }

        // 更新安装状态
        {
            let mut state = self.state.write().await;
            state.is_installing = false;
        }

        // 刷新状态（释放 install_lock 后刷新，避免死锁）
        drop(_guard);
        self.refresh().await;
    }

    /// 安装所有缺失依赖
    ///
    /// 使用互斥锁防止并发安装
    pub async fn install_all(&self) {
        // 获取安装锁，防止并发安装
        let _guard = self.install_lock.lock().await;

        {
            let mut state = self.state.write().await;
            state.is_installing = true;
        }

        // 检查是否需要安装 Node.js
        let node_info = self.core_manager.get_node_info().await;
        if node_info.is_none() {
            #[cfg(feature = "dependency-management")]
            {
                if let Err(e) = self
                    .core_manager
                    .install_nodejs(|progress, msg| {
                        tracing::info!(
                            "Node.js install progress: {:.0}% - {}",
                            progress * 100.0,
                            msg
                        );
                    })
                    .await
                {
                    tracing::error!("Failed to install Node.js: {}", e);
                }
            }
        }

        // 安装缺失的 npm 工具
        let deps = self.core_manager.get_all().await;
        for dep in deps {
            if dep.status == CoreDependencyStatus::Missing
                && dep.name != "nodejs"
                && dep.name != "npm"
            {
                if let Err(e) = self.core_manager.install_npm_tool(&dep.name).await {
                    tracing::error!("Failed to install npm tool '{}': {}", dep.name, e);
                }
            }
        }

        {
            let mut state = self.state.write().await;
            state.is_installing = false;
        }

        // 刷新状态（释放 install_lock 后刷新，避免死锁）
        drop(_guard);
        self.refresh().await;
    }

    /// 判断依赖是否可安装
    #[cfg(feature = "dependency-management")]
    fn is_installable(name: &str) -> bool {
        match name {
            "nodejs" => {
                #[cfg(feature = "dependency-management")]
                {
                    true
                }
                #[cfg(not(feature = "dependency-management"))]
                {
                    false
                }
            }
            "npm" => false, // npm 随 Node.js 一起安装
            _ => true,      // npm 工具可以安装
        }
    }
}

#[async_trait]
impl DependencyApi for DependencyViewModel {
    type State = DependencyViewModelState;

    async fn state(&self) -> Self::State {
        self.get_state().await
    }

    fn state_snapshot(&self) -> Self::State {
        futures::executor::block_on(self.get_state())
    }

    async fn refresh(&self) {
        self.refresh().await
    }

    async fn install(&self, name: &str) {
        self.install(name).await
    }

    async fn install_all(&self) {
        self.install_all().await
    }
}

#[cfg(feature = "dependency-management")]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ui_dependency_status_conversion() {
        assert_eq!(
            UIDependencyStatus::from_core(&CoreDependencyStatus::Ok),
            UIDependencyStatus::Ok
        );
        assert_eq!(
            UIDependencyStatus::from_core(&CoreDependencyStatus::Missing),
            UIDependencyStatus::Missing
        );
        assert_eq!(
            UIDependencyStatus::from_core(&CoreDependencyStatus::Outdated),
            UIDependencyStatus::Outdated
        );
        assert_eq!(
            UIDependencyStatus::from_core(&CoreDependencyStatus::Checking),
            UIDependencyStatus::Checking
        );
        assert_eq!(
            UIDependencyStatus::from_core(&CoreDependencyStatus::Installing),
            UIDependencyStatus::Installing
        );
        assert_eq!(
            UIDependencyStatus::from_core(&CoreDependencyStatus::Error("test error".to_string())),
            UIDependencyStatus::Error("test error".to_string())
        );
    }

    #[test]
    fn test_ui_dependency_status_can_install() {
        assert!(UIDependencyStatus::Missing.can_install());
        assert!(UIDependencyStatus::Outdated.can_install());
        assert!(!UIDependencyStatus::Ok.can_install());
        assert!(!UIDependencyStatus::Checking.can_install());
        assert!(!UIDependencyStatus::Installing.can_install());
        assert!(!UIDependencyStatus::Error("error".to_string()).can_install());
    }

    #[test]
    fn test_ui_dependency_status_error_message() {
        let status = UIDependencyStatus::Error("test error".to_string());
        assert!(status.is_error());
        assert_eq!(status.error_message(), Some("test error"));

        let ok_status = UIDependencyStatus::Ok;
        assert!(!ok_status.is_error());
        assert_eq!(ok_status.error_message(), None);
    }

    #[test]
    fn test_name_mapping() {
        assert_eq!(UIDependencyItem::map_to_core_name("Node.js"), "nodejs");
        assert_eq!(UIDependencyItem::map_to_core_name("nodejs"), "nodejs");
        assert_eq!(
            UIDependencyItem::map_to_core_name("claude-code"),
            "@anthropic-ai/claude-code"
        );
        assert_eq!(UIDependencyItem::map_to_core_name("opencode"), "opencode");
    }

    #[test]
    fn test_display_name_mapping() {
        assert_eq!(UIDependencyItem::map_to_display_name("nodejs"), "Node.js");
        assert_eq!(
            UIDependencyItem::map_to_display_name("@anthropic-ai/claude-code"),
            "claude-code"
        );
        assert_eq!(
            UIDependencyItem::map_to_display_name("opencode"),
            "opencode"
        );
        assert_eq!(UIDependencyItem::map_to_display_name("unknown"), "unknown");
    }

    #[test]
    fn test_default_state() {
        let state = DependencyViewModelState::default();
        assert_eq!(state.items.len(), 4);
        assert!(!state.is_loading);
        assert!(!state.is_installing);

        // 验证依赖项来自映射表
        assert_eq!(state.items[0].name, "nodejs");
        assert_eq!(state.items[0].display_name, "Node.js");
        assert!(state.items[0].required);
    }

    #[test]
    fn test_missing_count() {
        let mut state = DependencyViewModelState::default();
        assert_eq!(state.missing_count(), 0);

        state.items[0].status = UIDependencyStatus::Missing;
        assert_eq!(state.missing_count(), 1);

        state.items[1].status = UIDependencyStatus::Outdated;
        assert_eq!(state.missing_count(), 2);

        // Error 状态不计入 missing
        state.items[2].status = UIDependencyStatus::Error("error".to_string());
        assert_eq!(state.missing_count(), 2);
    }

    #[tokio::test]
    async fn test_viewmodel_creation() {
        let vm = DependencyViewModel::with_default_manager();
        let state = vm.get_state().await;
        assert_eq!(state.items.len(), 4);
    }
}

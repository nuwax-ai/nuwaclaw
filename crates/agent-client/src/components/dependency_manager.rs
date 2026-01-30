//! 依赖管理组件
//!
//! 显示依赖列表和状态，支持安装操作

use gpui::*;
use gpui::prelude::FluentBuilder as _;
use gpui_component::{
    button::Button, h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable,
};
use std::sync::Arc;

use crate::core::dependency::manager::DependencyManager as CoreDependencyManager;
use crate::core::dependency::manager::DependencyStatus as CoreDependencyStatus;
use crate::core::dependency::node::NodeSource;

/// 依赖状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DependencyStatus {
    /// 检查中
    Checking,
    /// 已安装
    Installed,
    /// 未安装
    NotInstalled,
    /// 版本过低
    Outdated,
    /// 安装中
    Installing,
    /// 安装失败
    Failed,
}

impl DependencyStatus {
    /// 从核心状态转换
    fn from_core(status: &CoreDependencyStatus) -> Self {
        match status {
            CoreDependencyStatus::Ok => Self::Installed,
            CoreDependencyStatus::Missing => Self::NotInstalled,
            CoreDependencyStatus::Outdated => Self::Outdated,
            CoreDependencyStatus::Checking => Self::Checking,
            CoreDependencyStatus::Installing => Self::Installing,
            CoreDependencyStatus::Error(_) => Self::Failed,
        }
    }

    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Checking => "检查中...",
            Self::Installed => "已安装",
            Self::NotInstalled => "未安装",
            Self::Outdated => "需要更新",
            Self::Installing => "安装中...",
            Self::Failed => "安装失败",
        }
    }

    /// 获取图标
    pub fn icon(&self) -> IconName {
        match self {
            Self::Checking | Self::Installing => IconName::Loader,
            Self::Installed => IconName::CircleCheck,
            Self::NotInstalled | Self::Failed => IconName::CircleX,
            Self::Outdated => IconName::TriangleAlert,
        }
    }
}

/// 依赖项信息
#[derive(Debug, Clone)]
pub struct DependencyItem {
    /// 名称
    pub name: String,
    /// 版本
    pub version: Option<String>,
    /// 来源
    pub source: Option<String>,
    /// 状态
    pub status: DependencyStatus,
    /// 是否必需
    pub required: bool,
}

impl DependencyItem {
    /// 创建新的依赖项
    pub fn new(name: &str, required: bool) -> Self {
        Self {
            name: name.to_string(),
            version: None,
            source: None,
            status: DependencyStatus::Checking,
            required,
        }
    }
}

/// 依赖管理视图
pub struct DependencyManagerView {
    /// 依赖列表
    dependencies: Vec<DependencyItem>,
    /// 是否正在检查
    _checking: bool,
    /// 是否正在安装
    _installing: bool,
    /// 核心依赖管理器
    core_manager: Arc<CoreDependencyManager>,
}

impl DependencyManagerView {
    /// 创建新的依赖管理视图
    pub fn new() -> Self {
        let core_manager = Arc::new(CoreDependencyManager::new());

        let mut view = Self {
            dependencies: Vec::new(),
            _checking: false,
            _installing: false,
            core_manager,
        };
        view.init_dependencies();
        view
    }

    /// 初始化依赖列表
    fn init_dependencies(&mut self) {
        self.dependencies = vec![
            DependencyItem::new("Node.js", true),
            DependencyItem::new("npm", true),
            DependencyItem::new("opencode", false),
            DependencyItem::new("claude-code", false),
        ];
    }

    /// 刷新依赖状态
    fn refresh_status(&mut self, cx: &mut Context<Self>) {
        self._checking = true;
        cx.notify();

        let core_manager = self.core_manager.clone();

        cx.spawn(async move |view, cx| {
            // 调用核心检测逻辑
            core_manager.check_all().await;

            // 获取检测结果
            let core_deps = core_manager.get_all().await;
            let node_info = core_manager.get_node_info().await;

            // 更新 UI
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view, cx| {
                        // 更新 Node.js 状态
                        if let Some(node_dep) = core_deps.iter().find(|d| d.name == "nodejs") {
                            if let Some(ui_dep) = view.dependencies.iter_mut().find(|d| d.name == "Node.js") {
                                ui_dep.status = DependencyStatus::from_core(&node_dep.status);
                                ui_dep.version = node_dep.version.clone();
                                if let Some(ref info) = node_info {
                                    ui_dep.source = Some(match info.source {
                                        NodeSource::System => "系统全局".to_string(),
                                        NodeSource::Local => "客户端目录".to_string(),
                                    });
                                }
                            }
                        }

                        // 更新 npm 状态
                        if let Some(npm_dep) = core_deps.iter().find(|d| d.name == "npm") {
                            if let Some(ui_dep) = view.dependencies.iter_mut().find(|d| d.name == "npm") {
                                ui_dep.status = DependencyStatus::from_core(&npm_dep.status);
                                ui_dep.version = npm_dep.version.clone();
                                ui_dep.source = Some("系统全局".to_string());
                            }
                        }

                        // 更新 opencode 状态
                        if let Some(opencode_dep) = core_deps.iter().find(|d| d.name == "opencode") {
                            if let Some(ui_dep) = view.dependencies.iter_mut().find(|d| d.name == "opencode") {
                                ui_dep.status = DependencyStatus::from_core(&opencode_dep.status);
                                ui_dep.version = opencode_dep.version.clone();
                            }
                        }

                        // 更新 claude-code 状态
                        if let Some(claude_dep) = core_deps.iter().find(|d| d.name == "@anthropic-ai/claude-code") {
                            if let Some(ui_dep) = view.dependencies.iter_mut().find(|d| d.name == "claude-code") {
                                ui_dep.status = DependencyStatus::from_core(&claude_dep.status);
                                ui_dep.version = claude_dep.version.clone();
                            }
                        }

                        view._checking = false;
                        cx.notify();
                    });
                }
            })
        })
        .detach();
    }

    /// 安装所有缺失依赖
    fn install_all(&mut self, cx: &mut Context<Self>) {
        self._installing = true;
        cx.notify();

        let core_manager = self.core_manager.clone();

        cx.spawn(async move |view, cx| {
            // 检查是否需要安装 Node.js
            let node_info = core_manager.get_node_info().await;
            if node_info.is_none() {
                #[cfg(feature = "dependency-management")]
                {
                    if let Err(e) = core_manager.install_nodejs(|progress, msg| {
                        tracing::info!("Node.js install progress: {:.0}% - {}", progress * 100.0, msg);
                    }).await {
                        tracing::error!("Failed to install Node.js: {}", e);
                    }
                }
            }

            // 安装 npm 工具
            let deps = core_manager.get_all().await;
            for dep in deps {
                if dep.status == CoreDependencyStatus::Missing && dep.name != "nodejs" && dep.name != "npm" {
                    if let Err(e) = core_manager.install_npm_tool(&dep.name).await {
                        tracing::error!("Failed to install npm tool '{}': {}", dep.name, e);
                    }
                }
            }

            // 刷新状态
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view, cx| {
                        view._installing = false;
                        view.refresh_status(cx);
                    });
                }
            })
        })
        .detach();
    }

    /// 安装单个依赖
    fn install_dependency(&mut self, name: &str, cx: &mut Context<Self>) {
        if let Some(dep) = self.dependencies.iter_mut().find(|d| d.name == name) {
            dep.status = DependencyStatus::Installing;
        }
        cx.notify();

        let core_manager = self.core_manager.clone();
        let display_name = name.to_string();
        let tool_name = match name {
            "Node.js" => "nodejs".to_string(),
            "claude-code" => "@anthropic-ai/claude-code".to_string(),
            _ => name.to_string(),
        };

        cx.spawn(async move |view, cx| {
            if tool_name == "nodejs" {
                #[cfg(feature = "dependency-management")]
                {
                    if let Err(e) = core_manager.install_nodejs(|progress, msg| {
                        tracing::info!("Node.js install progress: {:.0}% - {}", progress * 100.0, msg);
                    }).await {
                        tracing::error!("Failed to install Node.js: {}", e);
                    }
                }
            } else if tool_name != "npm" {
                if let Err(e) = core_manager.install_npm_tool(&tool_name).await {
                    tracing::error!("Failed to install '{}': {}", display_name, e);
                }
            }

            // 刷新状态
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view: &mut DependencyManagerView, cx| {
                        view.refresh_status(cx);
                    });
                }
            })
        })
        .detach();
    }

    /// 获取缺失依赖数量
    fn missing_count(&self) -> usize {
        self.dependencies
            .iter()
            .filter(|d| d.status == DependencyStatus::NotInstalled || d.status == DependencyStatus::Outdated)
            .count()
    }
}

impl Default for DependencyManagerView {
    fn default() -> Self {
        Self::new()
    }
}

impl Render for DependencyManagerView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let missing = self.missing_count();

        // Clone dependencies to avoid borrow issues
        let deps: Vec<_> = self.dependencies.clone();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("依赖管理"),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("管理 Agent 运行所需的依赖环境"),
            )
            // Action bar
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.muted_foreground)
                            .child(if missing > 0 {
                                format!("{} 个依赖需要安装", missing)
                            } else {
                                "所有依赖已就绪".to_string()
                            }),
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                Button::new("refresh")
                                    .label("刷新")
                                    .icon(Icon::new(IconName::Redo).small())
                                    .small()
                                    .on_click(cx.listener(|this, _, _window, cx| {
                                        this.refresh_status(cx);
                                    })),
                            )
                            .when(missing > 0, |this| {
                                this.child(
                                    Button::new("install-all")
                                        .label("安装全部")
                                        .icon(Icon::new(IconName::ArrowDown).small())
                                        .small()
                                        .on_click(cx.listener(|this, _, _window, cx| {
                                            this.install_all(cx);
                                        })),
                                )
                            }),
                    ),
            )
            // Dependency list
            .child(
                v_flex()
                    .gap_2()
                    .children(deps.into_iter().map(|dep| {
                        let name = dep.name.clone();
                        let status = dep.status;
                        let status_color = match status {
                            DependencyStatus::Installed => theme.success,
                            DependencyStatus::NotInstalled | DependencyStatus::Failed => theme.danger,
                            DependencyStatus::Outdated => theme.warning,
                            _ => theme.muted_foreground,
                        };

                        h_flex()
                            .justify_between()
                            .items_center()
                            .p_3()
                            .rounded_md()
                            .bg(theme.sidebar)
                            .border_1()
                            .border_color(theme.border)
                            .child(
                                h_flex()
                                    .gap_3()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_color(status_color)
                                            .child(Icon::new(status.icon()).small()),
                                    )
                                    .child(
                                        v_flex()
                                            .child(
                                                h_flex()
                                                    .gap_2()
                                                    .child(
                                                        div()
                                                            .text_sm()
                                                            .font_weight(FontWeight::MEDIUM)
                                                            .text_color(theme.foreground)
                                                            .child(dep.name.clone()),
                                                    )
                                                    .when(dep.required, |this| {
                                                        this.child(
                                                            div()
                                                                .text_xs()
                                                                .px_1()
                                                                .rounded(px(2.0))
                                                                .bg(theme.primary)
                                                                .text_color(theme.primary_foreground)
                                                                .child("必需"),
                                                        )
                                                    }),
                                            )
                                            .child(
                                                h_flex()
                                                    .gap_2()
                                                    .child(
                                                        div()
                                                            .text_xs()
                                                            .text_color(status_color)
                                                            .child(status.label()),
                                                    )
                                                    .when_some(dep.version.clone(), |this, v| {
                                                        this.child(
                                                            div()
                                                                .text_xs()
                                                                .text_color(theme.muted_foreground)
                                                                .child(format!("v{}", v)),
                                                        )
                                                    })
                                                    .when_some(dep.source.clone(), |this, s| {
                                                        this.child(
                                                            div()
                                                                .text_xs()
                                                                .text_color(theme.muted_foreground)
                                                                .child(format!("({})", s)),
                                                        )
                                                    }),
                                            ),
                                    ),
                            )
                            .when(
                                status == DependencyStatus::NotInstalled || status == DependencyStatus::Outdated,
                                |this| {
                                    this.child(
                                        Button::new(SharedString::from(format!("install-{}", name)))
                                            .label(if status == DependencyStatus::Outdated { "更新" } else { "安装" })
                                            .small()
                                            .on_click(cx.listener(move |this, _, _window, cx| {
                                                this.install_dependency(&name, cx);
                                            })),
                                    )
                                },
                            )
                    })),
            )
            // Manual install guide
            .child(
                v_flex()
                    .gap_2()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.foreground)
                            .child("手动安装指引"),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child("如果自动安装失败，您可以手动安装："),
                    )
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child("1. Node.js: 从 https://nodejs.org 下载安装"),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child("2. npm 工具: npm install -g <tool-name>"),
                            ),
                    ),
            )
    }
}

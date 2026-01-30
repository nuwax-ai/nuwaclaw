//! 依赖管理组件
//!
//! 显示依赖列表和状态，支持安装操作

use gpui::*;
use gpui::prelude::FluentBuilder as _;
use gpui_component::{
    button::Button, h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable,
};

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
}

impl DependencyManagerView {
    /// 创建新的依赖管理视图
    pub fn new() -> Self {
        let mut view = Self {
            dependencies: Vec::new(),
            _checking: false,
            _installing: false,
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
        // TODO: 实际检测逻辑
        // 模拟一些状态
        if let Some(node) = self.dependencies.iter_mut().find(|d| d.name == "Node.js") {
            node.status = DependencyStatus::Installed;
            node.version = Some("20.11.0".to_string());
            node.source = Some("系统全局".to_string());
        }
        if let Some(npm) = self.dependencies.iter_mut().find(|d| d.name == "npm") {
            npm.status = DependencyStatus::Installed;
            npm.version = Some("10.2.4".to_string());
            npm.source = Some("系统全局".to_string());
        }
        if let Some(opencode) = self.dependencies.iter_mut().find(|d| d.name == "opencode") {
            opencode.status = DependencyStatus::NotInstalled;
        }
        if let Some(claude) = self.dependencies.iter_mut().find(|d| d.name == "claude-code") {
            claude.status = DependencyStatus::NotInstalled;
        }
        self._checking = false;
        cx.notify();
    }

    /// 安装所有缺失依赖
    fn install_all(&mut self, cx: &mut Context<Self>) {
        self._installing = true;
        // TODO: 实际安装逻辑
        cx.notify();
    }

    /// 安装单个依赖
    fn install_dependency(&mut self, name: &str, cx: &mut Context<Self>) {
        if let Some(dep) = self.dependencies.iter_mut().find(|d| d.name == name) {
            dep.status = DependencyStatus::Installing;
        }
        // TODO: 实际安装逻辑
        cx.notify();
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

//! 依赖管理组件
//!
//! 显示依赖列表和状态，支持安装操作。
//! 该组件只负责 UI 渲染，业务逻辑委托给 DependencyViewModel。

use std::sync::Arc;

use gpui::prelude::FluentBuilder as _;
use gpui::*;
use gpui_component::{
    alert::Alert,
    button::{Button, ButtonVariants},
    h_flex,
    spinner::Spinner,
    tag::Tag,
    v_flex, ActiveTheme, Icon, IconName, Sizable, Size,
};

use crate::viewmodels::dependency::{
    DependencyAction, DependencyViewModel, DependencyViewModelState, UIDependencyItem,
    UIDependencyStatus,
};

/// 依赖管理视图
pub struct DependencyManagerView {
    /// ViewModel 引用
    view_model: Arc<DependencyViewModel>,
    /// 本地状态缓存（从 ViewModel 同步）
    state: DependencyViewModelState,
}

impl DependencyManagerView {
    /// 创建新的依赖管理视图
    pub fn new(view_model: Arc<DependencyViewModel>, cx: &mut Context<Self>) -> Self {
        let this = Self {
            view_model: view_model.clone(),
            state: DependencyViewModelState::default(),
        };

        // 启动时自动刷新依赖状态
        let view_model = view_model.clone();
        let this_weak = cx.entity().downgrade();
        cx.spawn(async move |_view, _cx| {
            // 调用 ViewModel 刷新
            view_model.handle_action(DependencyAction::Refresh).await;

            // 获取更新后的状态
            let new_state = view_model.get_state().await;

            // 同步状态并通知 UI 刷新
            let _ = this_weak.update(_cx, |view, cx| {
                view.state = new_state;
                cx.notify();
            });
        })
        .detach();

        this
    }

    /// 刷新依赖状态
    fn refresh_status(&mut self, cx: &mut Context<Self>) {
        self.state.is_loading = true;
        cx.notify();

        let view_model = self.view_model.clone();
        let this = cx.entity().downgrade();

        cx.spawn(async move |_view, _cx| {
            // 调用 ViewModel 刷新
            view_model.handle_action(DependencyAction::Refresh).await;

            // 获取更新后的状态
            let new_state = view_model.get_state().await;

            // 同步状态并通知 UI 刷新
            let _ = this.update(_cx, |view, cx| {
                view.state = new_state;
                cx.notify();
            });

            tracing::debug!("Dependency refresh completed");
        })
        .detach();
    }

    /// 安装所有缺失依赖
    fn install_all(&mut self, cx: &mut Context<Self>) {
        self.state.is_installing = true;
        cx.notify();

        let view_model = self.view_model.clone();
        let this = cx.entity().downgrade();

        cx.spawn(async move |_view, _cx| {
            // 调用 ViewModel 安装全部
            view_model.handle_action(DependencyAction::InstallAll).await;

            // 获取更新后的状态
            let new_state = view_model.get_state().await;

            // 同步状态并通知 UI 刷新
            let _ = this.update(_cx, |view, cx| {
                view.state = new_state;
                cx.notify();
            });

            tracing::debug!("Dependency install all completed");
        })
        .detach();
    }

    /// 安装单个依赖
    #[allow(dead_code)]
    fn install_dependency(&mut self, name: &str, cx: &mut Context<Self>) {
        // 更新本地状态
        if let Some(dep) = self.state.items.iter_mut().find(|d| d.display_name == name) {
            dep.status = UIDependencyStatus::Installing;
            dep.can_install = false;
        }
        cx.notify();

        let view_model = self.view_model.clone();
        let name = name.to_string();
        let this = cx.entity().downgrade();

        cx.spawn(async move |_view, _cx| {
            // 调用 ViewModel 安装
            view_model
                .handle_action(DependencyAction::Install(name))
                .await;

            // 获取更新后的状态
            let new_state = view_model.get_state().await;

            // 同步状态并通知 UI 刷新
            let _ = this.update(_cx, |view, cx| {
                view.state = new_state;
                cx.notify();
            });

            tracing::debug!("Dependency installation completed");
        })
        .detach();
    }

    /// 渲染依赖项（内部实现，不持有 cx）
    fn render_dependency_item_inner(
        item: &UIDependencyItem,
        theme: &gpui_component::Theme,
    ) -> impl IntoElement {
        // 克隆 name 供 UI 渲染使用
        let name_for_display = item.display_name.clone();

        // 提取需要的数据为 owned 值，避免生命周期问题
        let _status = item.status.clone();
        let version = item.version.clone();
        let source = item.source.clone();
        let error_msg = item.status.error_message().map(|s| s.to_string());

        // 根据状态选择 Tag 变体
        let status_tag: Tag = match &item.status {
            UIDependencyStatus::Ok => Tag::success(),
            UIDependencyStatus::Missing | UIDependencyStatus::Error(_) => Tag::danger(),
            UIDependencyStatus::Outdated => Tag::warning(),
            UIDependencyStatus::Installing => Tag::info(),
            UIDependencyStatus::Checking => Tag::secondary(),
        };

        // 必需标签
        let required_tag: Tag = if item.required {
            Tag::danger().outline()
        } else {
            Tag::secondary().outline()
        };

        // 状态标签文字
        let status_label = item.status.label().to_string();

        // 克隆 version 和 source 供闭包使用
        let version_clone = version.clone();
        let source_clone = source.clone();

        v_flex()
            .gap_2()
            .p_3()
            .rounded_md()
            .bg(theme.sidebar)
            .border_1()
            .border_color(theme.border)
            .child(
                h_flex().justify_between().items_center().child(
                    h_flex().gap_3().items_center().child(
                        v_flex()
                            .child(
                                h_flex()
                                    .gap_2()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child(name_for_display.clone()),
                                    )
                                    .child(required_tag.child(if item.required {
                                        "必需"
                                    } else {
                                        "可选"
                                    })),
                            )
                            .child(
                                h_flex()
                                    .gap_2()
                                    .items_center()
                                    .child(status_tag.child(status_label))
                                    .when_some(version_clone, |this, v| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(theme.muted_foreground)
                                                .child(format!("v{}", v)),
                                        )
                                    })
                                    .when_some(source_clone, |this, s| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(theme.muted_foreground)
                                                .child(format!("({})", s)),
                                        )
                                    }),
                            )
                            // 显示错误信息
                            .when_some(error_msg, |this, msg| {
                                this.child(
                                    div().mt_1().text_xs().text_color(theme.danger).child(msg),
                                )
                            }),
                    ),
                ),
            )
    }

    /// 渲染依赖项
    #[allow(dead_code)]
    fn render_dependency_item(
        &self,
        item: &UIDependencyItem,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        Self::render_dependency_item_inner(item, theme)
    }
}

impl Render for DependencyManagerView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let missing = self.state.missing_count();
        let is_loading = self.state.is_loading;
        let is_installing = self.state.is_installing;

        // Clone items to avoid borrow issues
        let items: Vec<_> = self.state.items.clone();
        // Pre-render items to avoid borrow conflicts with theme
        let rendered_items: Vec<_> = items
            .iter()
            .map(|item| Self::render_dependency_item_inner(item, theme))
            .collect();

        v_flex()
            .size_full()
            .gap_4()
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .child(
                        v_flex()
                            .gap_1()
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
                            ),
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(
                                Button::new("refresh")
                                    .label(if is_loading { "刷新中..." } else { "刷新" })
                                    .icon(Icon::new(IconName::Redo).small())
                                    .small()
                                    .ghost()
                                    .on_click(cx.listener(|this, _, _window, cx| {
                                        this.refresh_status(cx);
                                    })),
                            )
                            .when(is_loading, |this| {
                                this.child(Spinner::new().with_size(Size::Small))
                            })
                            .when(missing > 0 && !is_installing, |this| {
                                this.child(
                                    Button::new("install-all")
                                        .label("安装全部")
                                        .icon(Icon::new(IconName::ArrowDown).small())
                                        .small()
                                        .primary()
                                        .on_click(cx.listener(|this, _, _window, cx| {
                                            this.install_all(cx);
                                        })),
                                )
                            })
                            .when(is_installing, |this| {
                                this.child(
                                    h_flex()
                                        .gap_2()
                                        .items_center()
                                        .child(Spinner::new().with_size(Size::Small))
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(theme.muted_foreground)
                                                .child("安装中..."),
                                        ),
                                )
                            }),
                    ),
            )
            // 依赖状态摘要 Alert
            .when(missing > 0, |this| {
                this.child(
                    Alert::warning("dependency-warning", format!("{} 个依赖需要安装", missing))
                        .title("依赖缺失"),
                )
            })
            .when(missing == 0 && !items.is_empty(), |this| {
                this.child(Alert::success("dependency-ready", "所有依赖已安装就绪").title("就绪"))
            })
            // Dependency list - 使用预渲染的 items
            .child(v_flex().gap_2().children(rendered_items))
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

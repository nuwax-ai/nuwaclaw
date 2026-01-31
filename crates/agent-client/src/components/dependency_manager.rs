//! 依赖管理组件
//!
//! 显示依赖列表和状态，支持安装操作。
//! 该组件只负责 UI 渲染，业务逻辑委托给 DependencyViewModel。

use std::sync::Arc;

use gpui::prelude::FluentBuilder as _;
use gpui::*;
use gpui_component::{ActiveTheme, Icon, IconName, Sizable, button::Button, h_flex, v_flex};

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
    pub fn new(view_model: Arc<DependencyViewModel>) -> Self {
        Self {
            view_model,
            state: DependencyViewModelState::default(),
        }
    }

    /// 刷新依赖状态
    fn refresh_status(&mut self, cx: &mut Context<Self>) {
        self.state.is_loading = true;
        cx.notify();

        let view_model = self.view_model.clone();

        cx.spawn(async move |view, cx| {
            // 调用 ViewModel 刷新
            view_model.handle_action(DependencyAction::Refresh).await;

            // 获取更新后的状态
            let new_state = view_model.get_state().await;

            // 更新 UI
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view, cx| {
                        view.state = new_state;
                        cx.notify();
                    });
                }
            })
        })
        .detach();
    }

    /// 安装所有缺失依赖
    fn install_all(&mut self, cx: &mut Context<Self>) {
        self.state.is_installing = true;
        cx.notify();

        let view_model = self.view_model.clone();

        cx.spawn(async move |view, cx| {
            // 调用 ViewModel 安装全部
            view_model.handle_action(DependencyAction::InstallAll).await;

            // 获取更新后的状态
            let new_state = view_model.get_state().await;

            // 更新 UI
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view, cx| {
                        view.state = new_state;
                        cx.notify();
                    });
                }
            })
        })
        .detach();
    }

    /// 安装单个依赖
    fn install_dependency(&mut self, name: &str, cx: &mut Context<Self>) {
        // 更新本地状态
        if let Some(dep) = self.state.items.iter_mut().find(|d| d.display_name == name) {
            dep.status = UIDependencyStatus::Installing;
            dep.can_install = false;
        }
        cx.notify();

        let view_model = self.view_model.clone();
        let name = name.to_string();

        cx.spawn(async move |view, cx| {
            // 调用 ViewModel 安装
            view_model.handle_action(DependencyAction::Install(name)).await;

            // 获取更新后的状态
            let new_state = view_model.get_state().await;

            // 更新 UI
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view, cx| {
                        view.state = new_state;
                        cx.notify();
                    });
                }
            })
        })
        .detach();
    }

    /// 渲染依赖项
    fn render_dependency_item(
        &self,
        item: &UIDependencyItem,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let name = item.display_name.clone();

        // 提取需要的数据为 owned 值，避免生命周期问题
        let status_label = item.status.label().to_string();
        let status_icon = item.status.icon();
        let is_outdated = matches!(item.status, UIDependencyStatus::Outdated);
        let error_msg = item.status.error_message().map(|s| s.to_string());

        let status_color = match &item.status {
            UIDependencyStatus::Ok => theme.success,
            UIDependencyStatus::Missing | UIDependencyStatus::Error(_) => theme.danger,
            UIDependencyStatus::Outdated => theme.warning,
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
                            .child(Icon::new(status_icon).small()),
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
                                            .child(item.display_name.clone()),
                                    )
                                    .when(item.required, |this| {
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
                                            .child(status_label),
                                    )
                                    .when_some(item.version.clone(), |this, v| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(theme.muted_foreground)
                                                .child(format!("v{}", v)),
                                        )
                                    })
                                    .when_some(item.source.clone(), |this, s| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(theme.muted_foreground)
                                                .child(format!("({})", s)),
                                        )
                                    })
                                    // 显示错误信息
                                    .when_some(error_msg, |this, msg| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(theme.danger)
                                                .child(msg),
                                        )
                                    }),
                            ),
                    ),
            )
            .when(item.can_install, |this| {
                this.child(
                    Button::new(SharedString::from(format!("install-{}", name)))
                        .label(if is_outdated { "更新" } else { "安装" })
                        .small()
                        .on_click(cx.listener(move |this, _, _window, cx| {
                            this.install_dependency(&name, cx);
                        })),
                )
            })
    }
}

impl Render for DependencyManagerView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let missing = self.state.missing_count();

        // Clone items to avoid borrow issues
        let items: Vec<_> = self.state.items.clone();

        // Clone theme colors for use in closures
        let sidebar_color = theme.sidebar;
        let border_color = theme.border;
        let foreground_color = theme.foreground;
        let muted_foreground_color = theme.muted_foreground;

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(foreground_color)
                    .child("依赖管理"),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(muted_foreground_color)
                    .child("管理 Agent 运行所需的依赖环境"),
            )
            // Action bar
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .child(div().text_sm().text_color(muted_foreground_color).child(
                        if missing > 0 {
                            format!("{} 个依赖需要安装", missing)
                        } else {
                            "所有依赖已就绪".to_string()
                        },
                    ))
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
            .child(v_flex().gap_2().children(items.iter().map(|item| {
                self.render_dependency_item(item, cx)
            })))
            // Manual install guide
            .child(
                v_flex()
                    .gap_2()
                    .p_4()
                    .rounded_lg()
                    .bg(sidebar_color)
                    .border_1()
                    .border_color(border_color)
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(foreground_color)
                            .child("手动安装指引"),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(muted_foreground_color)
                            .child("如果自动安装失败，您可以手动安装："),
                    )
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(muted_foreground_color)
                                    .child("1. Node.js: 从 https://nodejs.org 下载安装"),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(muted_foreground_color)
                                    .child("2. npm 工具: npm install -g <tool-name>"),
                            ),
                    ),
            )
    }
}

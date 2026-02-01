//! 权限设置组件
//!
//! 显示系统权限状态和授权引导

use std::sync::Arc;

use gpui::*;
use gpui_component::{
    alert::Alert,
    button::{Button, ButtonVariants},
    h_flex, v_flex,
    spinner::Spinner,
    tag::Tag,
    ActiveTheme, Disableable, Icon, IconName, Sizable, Size,
};

use crate::viewmodels::{
    PermissionsAction, PermissionsViewModel, UIPermissionItem, UIPermissionStatus,
};

/// 权限视图事件
#[derive(Debug, Clone)]
pub enum PermissionsEvent {
    /// 权限状态刷新
    Refreshed,
}

/// 权限设置视图
pub struct PermissionsView {
    /// 权限 ViewModel
    view_model: Arc<PermissionsViewModel>,
}

impl EventEmitter<PermissionsEvent> for PermissionsView {}

impl PermissionsView {
    /// 创建新的权限视图
    pub fn new(view_model: Arc<PermissionsViewModel>, cx: &mut Context<Self>) -> Self {
        // 初始化时刷新权限状态
        let vm = view_model.clone();
        cx.spawn(async move |view, cx| {
            vm.initialize().await;
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |_view, cx| {
                        cx.notify();
                    });
                }
            });
        })
        .detach();

        Self { view_model }
    }

    /// 刷新权限状态
    fn refresh(&mut self, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        cx.spawn(async move |view, cx| {
            vm.handle_action(PermissionsAction::Refresh).await;
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |_view, cx| {
                        cx.emit(PermissionsEvent::Refreshed);
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// 打开系统设置进行授权
    fn open_settings(&self, permission_type: crate::core::permissions::PermissionType, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        let pt = permission_type;
        cx.spawn(async move |view, cx| {
            vm.handle_action(PermissionsAction::OpenSettings(pt)).await;
            cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |_view, cx| {
                        cx.notify();
                    });
                }
            });
        })
        .detach();
    }

    /// 获取权限用途说明
    fn permission_usage(permission_type: crate::core::permissions::PermissionType) -> &'static str {
        match permission_type {
            crate::core::permissions::PermissionType::Accessibility => {
                "用于远程控制时模拟键盘鼠标输入"
            }
            crate::core::permissions::PermissionType::ScreenRecording => {
                "用于远程桌面实时画面传输"
            }
            crate::core::permissions::PermissionType::FullDiskAccess => {
                "用于访问所有文件和目录"
            }
            crate::core::permissions::PermissionType::FileAccess => {
                "用于读写文件和传输文件"
            }
            crate::core::permissions::PermissionType::NetworkAccess => {
                "用于网络通信和远程连接"
            }
        }
    }

    /// 渲染权限卡片
    fn render_permission_card(
        &self,
        perm: &UIPermissionItem,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let permission_type = perm.permission_type;
        let status = perm.status;
        let is_granted = status.is_granted();
        let is_required = perm.is_required;
        let can_grant = perm.can_grant;
        let grant_instructions = perm.grant_instructions.clone();

        // 根据状态选择 Tag 变体
        let status_tag: Tag = match status {
            UIPermissionStatus::Granted => Tag::success(),
            UIPermissionStatus::Denied => Tag::danger(),
            UIPermissionStatus::NotDetermined => Tag::warning(),
            UIPermissionStatus::Unavailable => Tag::secondary(),
        };

        // 必需标签
        let required_tag: Tag = if is_required {
            Tag::danger().outline()
        } else {
            Tag::secondary().outline()
        };

        let mut card = v_flex()
            .gap_3()
            .p_4()
            .rounded_lg()
            .bg(theme.sidebar)
            .border_1()
            .border_color(if !is_granted && is_required {
                theme.warning
            } else {
                theme.border
            });

        // 标题行：权限名称 + 标签
        card = card.child(
            h_flex()
                .justify_between()
                .items_center()
                .child(
                    h_flex()
                        .gap_2()
                        .items_center()
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(theme.foreground)
                                .child(perm.display_name.clone()),
                        )
                        .child(required_tag.child(if is_required { "必需" } else { "可选" })),
                )
                .child(status_tag.child(status.label())),
        );

        // 用途说明
        card = card.child(
            div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(Self::permission_usage(permission_type)),
        );

        // 授权按钮
        if can_grant {
            let perm_type = permission_type;
            card = card.child(h_flex().mt_1().child(
                Button::new(SharedString::from(format!("grant-{:?}", perm_type)))
                    .label("前往授权")
                    .icon(Icon::new(IconName::ExternalLink).small())
                    .small()
                    .on_click(cx.listener(move |this, _, _window, cx| {
                        this.open_settings(perm_type, cx);
                    })),
            ));
        }

        // 授权指引
        if let Some(instructions) = grant_instructions {
            if !is_granted {
                card = card.child(
                    div()
                        .mt_2()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(instructions),
                );
            }
        }

        card
    }

    /// 渲染权限统计摘要
    fn render_summary(
        &self,
        total: usize,
        granted: usize,
        has_missing_required: bool,
        _cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let message = if has_missing_required {
            format!(
                "部分必需权限未授权，部分功能可能无法正常使用。已授权 {}/{} 个权限",
                granted, total
            )
        } else if granted == total {
            format!("所有权限已授权 ({}/{})", granted, total)
        } else {
            format!("已授权 {}/{} 个权限", granted, total)
        };

        // 根据状态选择 Alert 变体
        if has_missing_required {
            Alert::warning("permissions-summary", message.clone())
                .title("权限提醒")
        } else if granted == total {
            Alert::success("permissions-summary", message.clone())
                .title("权限正常")
        } else {
            Alert::info("permissions-summary", message.clone())
                .title("权限状态")
        }
    }
}

impl Render for PermissionsView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let is_refreshing = futures::executor::block_on(self.view_model.is_refreshing());
        let permissions = futures::executor::block_on(self.view_model.items());
        let summary = futures::executor::block_on(self.view_model.summary());

        let mut header = h_flex()
            .justify_between()
            .items_center()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("权限设置"),
            )
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(
                        Button::new("refresh-permissions")
                            .label("刷新")
                            .icon(Icon::new(IconName::Redo).small())
                            .small()
                            .ghost()
                            .disabled(is_refreshing)
                            .on_click(cx.listener(|this, _, _window, cx| {
                                this.refresh(cx);
                            })),
                    ),
            );

        if is_refreshing {
            header = header.child(Spinner::new().with_size(Size::Small));
        }

        v_flex()
            .gap_4()
            .child(header)
            .child(self.render_summary(
                summary.total,
                summary.granted,
                summary.has_missing_required,
                cx,
            ))
            .child(
                v_flex().gap_3().children(
                    permissions
                        .iter()
                        .map(|perm| self.render_permission_card(perm, cx).into_any_element()),
                ),
            )
    }
}

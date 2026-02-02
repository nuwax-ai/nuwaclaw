//! 权限设置组件
//!
//! 显示系统权限状态和授权引导

use std::sync::Arc;

use gpui::*;
use gpui_component::{
    alert::Alert,
    button::{Button, ButtonVariants},
    h_flex, v_flex,
    scroll::ScrollableElement as _,
    tag::Tag,
    ActiveTheme, Icon, IconName, Sizable,
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
    pub fn new(view_model: Arc<PermissionsViewModel>, _cx: &mut Context<Self>) -> Self {
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

    /// 获取权限用途说明
    fn permission_usage(permission_name: &str) -> &'static str {
        match permission_name {
            "screen_recording" => "用于远程桌面实时画面传输",
            "accessibility" => "用于远程控制时模拟键盘鼠标输入",
            "camera" => "用于视频通话功能",
            "microphone" => "用于语音通话功能",
            _ => "系统权限",
        }
    }

    /// 渲染权限卡片
    fn render_permission_card(
        &self,
        perm: &UIPermissionItem,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let status = perm.status;
        let is_granted = matches!(status, UIPermissionStatus::Granted);
        let is_required = perm.modifiable; // 使用 modifiable 作为必需标志

        // 根据状态选择 Tag 变体
        let status_tag: Tag = match status {
            UIPermissionStatus::Granted => Tag::success(),
            UIPermissionStatus::Denied => Tag::danger(),
            UIPermissionStatus::Pending => Tag::warning(),
            UIPermissionStatus::Unknown => Tag::secondary(),
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
                        .child(required_tag.child("权限")),
                )
                .child(status_tag.child(status.label())),
        );

        // 用途说明
        card = card.child(
            div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(Self::permission_usage(&perm.name)),
        );

        card
    }

    /// 渲染权限统计摘要
    fn render_summary(
        &self,
        total: usize,
        granted: usize,
        _cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let message = if granted == total {
            format!("所有权限已授权 ({}/{})", granted, total)
        } else {
            format!("已授权 {}/{} 个权限", granted, total)
        };

        if granted == total {
            Alert::success("permissions-summary", message.clone())
                .title("权限正常")
        } else {
            Alert::warning("permissions-summary", message.clone())
                .title("权限提醒")
        }
    }
}

impl Render for PermissionsView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let state = futures::executor::block_on(self.view_model.get_state());

        let header = h_flex()
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
                            .on_click(cx.listener(|this, _, _window, cx| {
                                this.refresh(cx);
                            })),
                    ),
            );

        // 使用 flex 布局确保滚动容器正确计算高度
        v_flex()
            .flex_1()
            .size_full()
            .gap_4()
            .child(header)
            .child(self.render_summary(state.summary.total, state.summary.granted, cx))
            .child(
                div()
                    .overflow_y_scrollbar()
                    .flex_1()
                    .w_full()
                    .pr_2()
                    .pb_4()
                    .child(
                        v_flex().gap_3().children(
                            state
                                .items
                                .iter()
                                .map(|perm| self.render_permission_card(perm, cx).into_any_element()),
                        ),
                    ),
            )
    }
}

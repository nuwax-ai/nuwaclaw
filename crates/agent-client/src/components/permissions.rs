//! 权限设置组件
//!
//! 显示系统权限状态和授权引导

use gpui::*;
use gpui_component::{
    button::{Button, ButtonVariants},
    h_flex, v_flex, ActiveTheme, Disableable, Icon, IconName, Sizable,
};

use crate::core::permissions::{
    PermissionInfo, PermissionManager, PermissionStatus, PermissionType,
};

/// 权限视图事件
#[derive(Debug, Clone)]
pub enum PermissionsEvent {
    /// 权限状态刷新
    Refreshed,
}

/// 权限设置视图
pub struct PermissionsView {
    /// 权限管理器
    permission_manager: PermissionManager,
    /// 是否正在刷新
    is_refreshing: bool,
}

impl EventEmitter<PermissionsEvent> for PermissionsView {}

impl PermissionsView {
    /// 创建新的权限视图
    pub fn new(_cx: &mut Context<Self>) -> Self {
        let mut permission_manager = PermissionManager::new();
        // 初始化时检查所有权限
        permission_manager.check_all();

        Self {
            permission_manager,
            is_refreshing: false,
        }
    }

    /// 刷新权限状态
    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.is_refreshing = true;
        cx.notify();

        // 重新检查所有权限
        self.permission_manager.check_all();
        self.is_refreshing = false;

        cx.emit(PermissionsEvent::Refreshed);
        cx.notify();
    }

    /// 打开系统设置进行授权
    fn open_settings(&self, permission_type: PermissionType, _cx: &mut Context<Self>) {
        if let Err(e) = self.permission_manager.open_settings(permission_type) {
            tracing::error!("Failed to open settings: {}", e);
        }
    }

    /// 获取权限状态图标
    fn status_icon(status: PermissionStatus) -> IconName {
        match status {
            PermissionStatus::Granted => IconName::CircleCheck,
            PermissionStatus::Denied => IconName::CircleX,
            PermissionStatus::NotDetermined => IconName::Info,
            PermissionStatus::Unavailable => IconName::Minus,
        }
    }

    /// 获取权限用途说明
    fn permission_usage(permission_type: PermissionType) -> &'static str {
        match permission_type {
            PermissionType::Accessibility => "用于远程控制时模拟键盘鼠标输入",
            PermissionType::ScreenRecording => "用于远程桌面实时画面传输",
            PermissionType::FullDiskAccess => "用于访问所有文件和目录",
            PermissionType::FileAccess => "用于读写文件和传输文件",
            PermissionType::NetworkAccess => "用于网络通信和远程连接",
        }
    }

    /// 渲染权限卡片
    fn render_permission_card(
        &self,
        perm: &PermissionInfo,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let permission_type = perm.permission_type;
        let status = perm.status;
        let is_granted = status.is_granted();
        let is_required = permission_type.is_required();

        let status_color = match status {
            PermissionStatus::Granted => theme.success,
            PermissionStatus::Denied => theme.danger,
            PermissionStatus::NotDetermined => theme.warning,
            PermissionStatus::Unavailable => theme.muted_foreground,
        };

        let status_text = match status {
            PermissionStatus::Granted => "已授权",
            PermissionStatus::Denied => "未授权",
            PermissionStatus::NotDetermined => "待确定",
            PermissionStatus::Unavailable => "不可用",
        };

        let mut card = v_flex()
            .gap_2()
            .p_4()
            .rounded_lg()
            .bg(theme.sidebar)
            .border_1()
            .border_color(if !is_granted && is_required {
                theme.warning
            } else {
                theme.border
            });

        // 权限标题行
        let mut title_row = h_flex()
            .gap_2()
            .items_center()
            .child(
                Icon::new(Self::status_icon(status))
                    .small()
                    .text_color(status_color),
            )
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(theme.foreground)
                    .child(perm.description.clone()),
            );

        if is_required {
            title_row = title_row.child(
                div()
                    .text_xs()
                    .px_1()
                    .rounded_sm()
                    .bg(theme.accent)
                    .text_color(theme.accent_foreground)
                    .child("必需"),
            );
        }

        card = card.child(
            h_flex()
                .justify_between()
                .items_center()
                .child(title_row)
                .child(div().text_sm().text_color(status_color).child(status_text)),
        );

        // 用途说明
        card = card.child(
            div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(Self::permission_usage(permission_type)),
        );

        // 授权按钮
        if !is_granted && status != PermissionStatus::Unavailable {
            card = card.child(h_flex().mt_2().child(
                Button::new(SharedString::from(format!("grant-{:?}", permission_type)))
                    .label("前往授权")
                    .icon(Icon::new(IconName::ExternalLink).small())
                    .small()
                    .on_click(cx.listener(move |this, _, _window, cx| {
                        this.open_settings(permission_type, cx);
                    })),
            ));
        }

        // 授权指引
        if let Some(instructions) = &perm.grant_instructions {
            if !is_granted {
                card = card.child(
                    div()
                        .text_xs()
                        .text_color(theme.muted_foreground)
                        .child(instructions.clone()),
                );
            }
        }

        card
    }

    /// 渲染权限统计摘要
    fn render_summary(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let permissions = self.permission_manager.permissions();
        let total = permissions.len();
        let granted = permissions.iter().filter(|p| p.status.is_granted()).count();
        let missing_required = self.permission_manager.missing_required();
        let has_missing_required = !missing_required.is_empty();

        let (bg_color, icon, message) = if has_missing_required {
            (
                theme.warning.opacity(0.1),
                IconName::TriangleAlert,
                format!(
                    "部分必需权限未授权，部分功能可能无法正常使用\n已授权 {}/{} 个权限",
                    granted, total
                ),
            )
        } else if granted == total {
            (
                theme.success.opacity(0.1),
                IconName::CircleCheck,
                format!("所有权限已授权 ({}/{})", granted, total),
            )
        } else {
            (
                theme.muted.opacity(0.5),
                IconName::Info,
                format!("已授权 {}/{} 个权限", granted, total),
            )
        };

        let icon_color = if has_missing_required {
            theme.warning
        } else if granted == total {
            theme.success
        } else {
            theme.muted_foreground
        };

        h_flex()
            .gap_3()
            .p_4()
            .rounded_lg()
            .bg(bg_color)
            .border_1()
            .border_color(theme.border)
            .items_center()
            .child(Icon::new(icon).text_color(icon_color))
            .child(div().text_sm().text_color(theme.foreground).child(message))
    }
}

impl Render for PermissionsView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let permissions: Vec<PermissionInfo> = self.permission_manager.permissions().to_vec();
        let is_refreshing = self.is_refreshing;

        v_flex()
            .gap_4()
            .child(
                h_flex()
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
                        Button::new("refresh-permissions")
                            .label("刷新")
                            .icon(Icon::new(IconName::Loader).small())
                            .small()
                            .ghost()
                            .disabled(is_refreshing)
                            .on_click(cx.listener(|this, _, _window, cx| {
                                this.refresh(cx);
                            })),
                    ),
            )
            .child(self.render_summary(cx))
            .child(
                v_flex().gap_3().children(
                    permissions
                        .iter()
                        .map(|perm| self.render_permission_card(perm, cx).into_any_element()),
                ),
            )
    }
}

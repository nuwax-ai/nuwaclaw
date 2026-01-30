//! 客户端信息组件
//!
//! 显示客户端 ID 和密码信息

use gpui::*;
use gpui_component::{
    button::Button, h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable,
};

/// 客户端信息组件
pub struct ClientInfoView {
    /// 客户端 ID
    client_id: Option<String>,
    /// 连接密码
    password: String,
    /// 是否显示密码
    show_password: bool,
}

impl ClientInfoView {
    /// 创建新的客户端信息视图
    pub fn new() -> Self {
        Self {
            client_id: None,
            password: "password123".to_string(), // TODO: 从配置加载
            show_password: false,
        }
    }

    /// 设置客户端 ID
    pub fn set_client_id(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        self.client_id = id;
        cx.notify();
    }

    /// 切换密码显示
    fn toggle_password_visibility(&mut self, cx: &mut Context<Self>) {
        self.show_password = !self.show_password;
        cx.notify();
    }

    /// 复制客户端 ID 到剪贴板
    fn copy_client_id(&self, cx: &mut Context<Self>) {
        if let Some(ref id) = self.client_id {
            cx.write_to_clipboard(ClipboardItem::new_string(id.clone()));
            tracing::info!("Client ID copied to clipboard");
        }
    }

    /// 复制密码到剪贴板
    fn copy_password(&self, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(self.password.clone()));
        tracing::info!("Password copied to clipboard");
    }
}

impl Default for ClientInfoView {
    fn default() -> Self {
        Self::new()
    }
}

impl Render for ClientInfoView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let client_id = self.client_id.clone().unwrap_or_else(|| "--------".to_string());
        let password_display = if self.show_password {
            self.password.clone()
        } else {
            "••••••••".to_string()
        };
        let show_password = self.show_password;

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("客户端信息"),
            )
            // Info card
            .child(
                v_flex()
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    // 客户端 ID 行
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("客户端 ID"),
                            )
                            .child(
                                h_flex()
                                    .justify_between()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_2xl()
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.foreground)
                                            .child(client_id),
                                    )
                                    .child(
                                        Button::new("copy-id")
                                            .icon(Icon::new(IconName::Copy).small())
                                            .small()
                                            .on_click(cx.listener(|this, _, _window, cx| {
                                                this.copy_client_id(cx);
                                            })),
                                    ),
                            ),
                    )
                    // 分隔线
                    .child(div().h(px(1.0)).w_full().bg(theme.border))
                    // 密码行
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("连接密码"),
                            )
                            .child(
                                h_flex()
                                    .justify_between()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_xl()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(theme.foreground)
                                            .child(password_display),
                                    )
                                    .child(
                                        h_flex()
                                            .gap_1()
                                            .child(
                                                Button::new("toggle-password")
                                                    .icon(Icon::new(if show_password {
                                                        IconName::EyeOff
                                                    } else {
                                                        IconName::Eye
                                                    }).small())
                                                    .small()
                                                    .on_click(cx.listener(|this, _, _window, cx| {
                                                        this.toggle_password_visibility(cx);
                                                    })),
                                            )
                                            .child(
                                                Button::new("copy-password")
                                                    .icon(Icon::new(IconName::Copy).small())
                                                    .small()
                                                    .on_click(cx.listener(|this, _, _window, cx| {
                                                        this.copy_password(cx);
                                                    })),
                                            ),
                                    ),
                            ),
                    ),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("提示：将客户端 ID 分享给管理端以建立连接"),
            )
    }
}

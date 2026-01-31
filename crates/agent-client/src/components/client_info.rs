//! 客户端信息组件
//!
//! 显示客户端 ID 和密码信息

use std::sync::Arc;

use gpui::*;
use gpui_component::{
    divider::Divider,
    button::Button,
    h_flex, v_flex,
    ActiveTheme, Icon, IconName, Sizable,
};

use crate::viewmodels::ClientInfoViewModel;

/// 客户端信息组件
pub struct ClientInfoView {
    /// ViewModel
    view_model: Arc<ClientInfoViewModel>,
}

impl ClientInfoView {
    /// 创建新的客户端信息视图
    pub fn new(view_model: Arc<ClientInfoViewModel>) -> Self {
        Self { view_model }
    }

    /// 设置客户端 ID
    pub fn set_client_id(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        let id_for_task = id.clone();
        cx.spawn(async move |view, cx| {
            vm.set_client_id(id_for_task).await;
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

    /// 切换密码显示
    fn toggle_password_visibility(&mut self, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        cx.spawn(async move |view, cx| {
            vm.toggle_password_visibility().await;
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

    /// 复制客户端 ID 到剪贴板
    fn copy_client_id(&self, cx: &mut Context<Self>) {
        let client_id = futures::executor::block_on(self.view_model.client_id());
        if let Some(id) = client_id {
            cx.write_to_clipboard(ClipboardItem::new_string(id));
            tracing::info!("Client ID copied to clipboard");
        }
    }

    /// 复制密码到剪贴板
    fn copy_password(&self, cx: &mut Context<Self>) {
        let password = futures::executor::block_on(self.view_model.password());
        cx.write_to_clipboard(ClipboardItem::new_string(password));
        tracing::info!("Password copied to clipboard");
    }
}

impl Default for ClientInfoView {
    fn default() -> Self {
        Self::new(Arc::new(ClientInfoViewModel::new()))
    }
}

impl Render for ClientInfoView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let client_id = futures::executor::block_on(self.view_model.client_id());
        let client_id_display = client_id
            .clone()
            .unwrap_or_else(|| "--------".to_string());
        let password = futures::executor::block_on(self.view_model.password());
        let show_password = futures::executor::block_on(self.view_model.show_password());
        let password_display = if show_password {
            password.clone()
        } else {
            "••••••••".to_string()
        };

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
                            .gap_2()
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
                                            .child(client_id_display),
                                    )
                                    .child(
                                        Button::new("copy-id")
                                            .icon(Icon::new(IconName::Copy).small())
                                            .small()
                                            .tooltip("复制客户端 ID")
                                            .on_click(cx.listener(|this, _, _window, cx| {
                                                this.copy_client_id(cx);
                                            })),
                                    ),
                            ),
                    )
                    // 分隔线
                    .child(Divider::horizontal())
                    // 密码行
                    .child(
                        v_flex()
                            .gap_2()
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
                                                    .icon(
                                                        Icon::new(if show_password {
                                                            IconName::EyeOff
                                                        } else {
                                                            IconName::Eye
                                                        })
                                                        .small(),
                                                    )
                                                    .small()
                                                    .tooltip(if show_password {
                                                        "隐藏密码"
                                                    } else {
                                                        "显示密码"
                                                    })
                                                    .on_click(cx.listener(
                                                        |this, _, _window, cx| {
                                                            this.toggle_password_visibility(cx);
                                                        },
                                                    )),
                                            )
                                            .child(
                                                Button::new("copy-password")
                                                    .icon(Icon::new(IconName::Copy).small())
                                                    .small()
                                                    .tooltip("复制密码")
                                                    .on_click(cx.listener(
                                                        |this, _, _window, cx| {
                                                            this.copy_password(cx);
                                                        },
                                                    )),
                                            ),
                                    ),
                            ),
                    ),
            )
            // 提示信息
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(Icon::new(IconName::Info).small().text_color(theme.info))
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme.muted_foreground)
                            .child("提示：将客户端 ID 分享给管理端以建立连接"),
                    ),
            )
    }
}

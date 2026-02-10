//! 客户端信息组件
//!
//! 使用 MVVM 模式：View 只负责渲染，ViewModel 负责业务逻辑

use std::sync::Arc;

use gpui::*;
use gpui_component::{button::Button, h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable};

use crate::viewmodels::ClientInfoViewModel;

/// 客户端信息事件
#[derive(Debug, Clone)]
pub enum ClientInfoEvent {
    /// 导航到安全设置页面
    NavigateToSecurity,
}

/// 客户端信息视图
pub struct ClientInfoView {
    /// ViewModel 引用
    view_model: Arc<ClientInfoViewModel>,
}

impl EventEmitter<ClientInfoEvent> for ClientInfoView {}

impl ClientInfoView {
    /// 创建新的客户端信息视图
    pub fn new(view_model: Arc<ClientInfoViewModel>, _cx: &mut Context<Self>) -> Self {
        Self { view_model }
    }

    /// 复制客户端 ID 到剪贴板
    fn copy_client_id(&self, cx: &mut Context<Self>) {
        let client_id = futures::executor::block_on(self.view_model.client_id());
        if let Some(id) = client_id {
            cx.write_to_clipboard(ClipboardItem::new_string(id));
            tracing::info!("Client ID copied to clipboard");
        }
    }
}

impl Render for ClientInfoView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let state = futures::executor::block_on(self.view_model.get_state());

        let client_id_display = state
            .client_id
            .clone()
            .unwrap_or_else(|| "--------".to_string());

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("客户端信息"),
            )
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
            // 系统信息
            .child(
                v_flex()
                    .gap_3()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("版本"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(state.version),
                            ),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("操作系统"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(format!("{} ({})", state.os, state.arch)),
                            ),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("连接状态"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if state.is_connected {
                                        theme.success
                                    } else {
                                        theme.muted_foreground
                                    })
                                    .child(if state.is_connected {
                                        "已连接"
                                    } else {
                                        "未连接"
                                    }),
                            ),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .items_center()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("连接地址"),
                            )
                            .child(
                                div().text_sm().text_color(theme.foreground).child(
                                    state.connection_addr.unwrap_or_else(|| "-".to_string()),
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

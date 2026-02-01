//! 客户端信息组件
//!
//! 使用 MVVM 模式：View 只负责渲染，ViewModel 负责业务逻辑
//! View 通过观察 ViewModel 状态变化来响应式更新 UI

use std::sync::Arc;

use gpui::*;
use gpui_component::{
    divider::Divider,
    button::Button,
    h_flex, v_flex,
    ActiveTheme, Icon, IconName, Sizable,
};

use crate::viewmodels::{ClientInfoViewModel, ClientInfoViewModelState};

/// 客户端信息事件
#[derive(Debug, Clone)]
pub enum ClientInfoEvent {
    /// 导航到安全设置页面
    NavigateToSecurity,
}

/// 客户端信息视图
///
/// ## MVVM 架构
///
/// - View: 只负责 UI 渲染，通过 observe 订阅 ViewModel 状态变化
/// - ViewModel: 管理业务状态，提供异步操作方法
/// - Model: 底层服务 (CryptoManager, PasswordManager)
///
pub struct ClientInfoView {
    /// ViewModel 引用
    view_model: Arc<ClientInfoViewModel>,
    /// 本地状态缓存（从 ViewModel 同步，用于渲染）
    state: ClientInfoViewModelState,
}

impl EventEmitter<ClientInfoEvent> for ClientInfoView {}

impl ClientInfoView {
    /// 创建新的客户端信息视图
    pub fn new(view_model: Arc<ClientInfoViewModel>, cx: &mut Context<Self>) -> Self {
        let state = futures::executor::block_on(view_model.get_state());

        Self {
            view_model,
            state,
        }
    }

    /// 设置客户端 ID（由外部调用，如 AppState 事件处理器）
    pub fn set_client_id(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        let id_for_task = id.clone();
        let this = cx.entity().downgrade();

        cx.spawn(async move |_this, _app| {
            vm.set_client_id(id_for_task).await;
            // 同步 ViewModel 状态到本地
            let new_state = vm.get_state().await;
            let _ = this.update(_app, |view, cx| {
                view.state = new_state;
                cx.notify();
            });
        })
        .detach();
    }

    /// 切换密码显示
    fn toggle_password_visibility(&mut self, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        let this = cx.entity().downgrade();

        cx.spawn(async move |_this, _app| {
            vm.toggle_password_visibility().await;
            // 同步 ViewModel 状态到本地
            let new_state = vm.get_state().await;
            let _ = this.update(_app, |view, cx| {
                view.state = new_state;
                cx.notify();
            });
        })
        .detach();
    }

    /// 复制客户端 ID 到剪贴板
    fn copy_client_id(&self, cx: &mut Context<Self>) {
        // 从本地状态获取（避免阻塞）
        let client_id = self.state.client_id.clone();
        if let Some(id) = client_id {
            cx.write_to_clipboard(ClipboardItem::new_string(id));
            tracing::info!("Client ID copied to clipboard");
        }
    }

    /// 复制密码到剪贴板
    fn copy_password(&self, cx: &mut Context<Self>) {
        // 从本地状态获取（避免阻塞）
        let password = self.state.password.clone();
        cx.write_to_clipboard(ClipboardItem::new_string(password));
        tracing::info!("Password copied to clipboard");
    }

    /// 同步状态（由外部调用，如订阅事件）
    pub fn sync_state(&mut self, cx: &mut Context<Self>) {
        // 在实际项目中，这里应该从 ViewModel 获取最新状态
        cx.notify();
    }
}

impl Render for ClientInfoView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        // 从本地状态渲染（状态由 ViewModel 通过操作更新）
        let client_id_display = self
            .state
            .client_id
            .clone()
            .unwrap_or_else(|| "--------".to_string());
        let password_display = if self.state.show_password {
            self.state.password.clone()
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
                                                        Icon::new(if self.state.show_password {
                                                            IconName::EyeOff
                                                        } else {
                                                            IconName::Eye
                                                        })
                                                        .small(),
                                                    )
                                                    .small()
                                                    .tooltip(if self.state.show_password {
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
                                            )
                                            .child(
                                                Button::new("modify-password")
                                                    .icon(Icon::new(IconName::Settings).small())
                                                    .small()
                                                    .tooltip("修改密码")
                                                    .on_click(cx.listener(
                                                        |_, _, _window, cx| {
                                                            cx.emit(ClientInfoEvent::NavigateToSecurity);
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

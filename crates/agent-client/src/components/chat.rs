//! 聊天界面组件
//!
//! 简易聊天 UI，用于管理端与客户端间的文本通信

use gpui::*;
use gpui_component::{h_flex, v_flex, ActiveTheme, Icon, IconName, Sizable};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 聊天消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// 消息 ID
    pub id: String,
    /// 发送者
    pub sender: String,
    /// 内容
    pub content: String,
    /// 时间
    pub timestamp: DateTime<Utc>,
    /// 是否为本机发送
    pub is_self: bool,
}

/// 聊天状态
pub struct ChatState {
    /// 消息列表
    messages: Vec<ChatMessage>,
    /// 输入内容
    input_text: String,
    /// 最大消息数
    max_messages: usize,
}

impl Default for ChatState {
    fn default() -> Self {
        Self::new()
    }
}

impl ChatState {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            input_text: String::new(),
            max_messages: 500,
        }
    }

    /// 添加消息
    pub fn add_message(&mut self, message: ChatMessage) {
        self.messages.push(message);
        // 保持消息数量限制
        if self.messages.len() > self.max_messages {
            self.messages.drain(0..self.messages.len() - self.max_messages);
        }
    }

    /// 获取消息列表
    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    /// 清空消息
    pub fn clear(&mut self) {
        self.messages.clear();
    }

    /// 消息数量
    pub fn count(&self) -> usize {
        self.messages.len()
    }
}

/// 聊天视图
pub struct ChatView {
    state: ChatState,
}

impl Default for ChatView {
    fn default() -> Self {
        Self::new()
    }
}

impl ChatView {
    pub fn new() -> Self {
        Self {
            state: ChatState::new(),
        }
    }

    /// 添加消息
    pub fn add_message(&mut self, message: ChatMessage, cx: &mut Context<Self>) {
        self.state.add_message(message);
        cx.notify();
    }

    /// 获取消息数量
    pub fn message_count(&self) -> usize {
        self.state.count()
    }

    fn render_message(&self, message: &ChatMessage, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let time_str = message.timestamp.format("%H:%M").to_string();

        let (align, bg, text_color) = if message.is_self {
            (FlexDirection::RowReverse, theme.primary, theme.primary_foreground)
        } else {
            (FlexDirection::Row, theme.surface, theme.foreground)
        };

        div()
            .w_full()
            .flex()
            .flex_dir(align)
            .child(
                v_flex()
                    .max_w(px(400.0))
                    .gap(px(2.0))
                    .child(
                        h_flex()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child(message.sender.clone()),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child(time_str),
                            ),
                    )
                    .child(
                        div()
                            .px_3()
                            .py_2()
                            .rounded_lg()
                            .bg(bg)
                            .text_color(text_color)
                            .text_sm()
                            .child(message.content.clone()),
                    ),
            )
    }

    fn render_empty_state(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .child(
                div()
                    .text_color(theme.muted_foreground)
                    .child(Icon::new(IconName::Inbox).custom_size(px(48.0))),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("暂无消息"),
            )
    }
}

impl Render for ChatView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .size_full()
            .child(
                // 消息区域
                if self.state.messages.is_empty() {
                    div().size_full().child(self.render_empty_state(cx))
                } else {
                    div()
                        .size_full()
                        .flex()
                        .flex_col()
                        .overflow_y_scroll()
                        .p_4()
                        .gap_3()
                        .children(
                            self.state
                                .messages
                                .iter()
                                .map(|msg| self.render_message(msg, cx).into_any_element())
                                .collect::<Vec<_>>(),
                        )
                },
            )
            .child(
                // 输入区域
                h_flex()
                    .h(px(56.0))
                    .px_4()
                    .gap_2()
                    .items_center()
                    .border_t_1()
                    .border_color(theme.border)
                    .bg(theme.surface)
                    .child(
                        div()
                            .flex_1()
                            .text_sm()
                            .text_color(theme.muted_foreground)
                            .child("输入消息..."),
                    )
                    .child(
                        div()
                            .text_color(theme.primary)
                            .child(Icon::new(IconName::ArrowUp).small()),
                    ),
            )
    }
}

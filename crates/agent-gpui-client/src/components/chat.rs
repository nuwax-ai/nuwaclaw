//! 聊天界面组件
//!
//! 完整的聊天 UI，支持消息列表、输入区域、加载状态和消息操作
//!
//! # TODO 后续扩展
//! - [ ] 完善剪贴板复制功能（当前 TODO: 复制到剪贴板）
//! - [ ] 添加 Markdown 渲染支持
//! - [ ] 实现流式响应更新（打字指示器替换为真实内容更新）

use gpui::prelude::FluentBuilder as _;
use gpui::*;
use gpui_component::avatar::Avatar;
use gpui_component::button::{Button, ButtonVariants};
use gpui_component::h_flex;
use gpui_component::input::{Input, InputEvent, InputState};
use gpui_component::popover::Popover;
use gpui_component::scroll::ScrollableElement as _;
use gpui_component::v_flex;
use gpui_component::ActiveTheme;
use gpui_component::{Disableable, Sizable};
use serde::{Deserialize, Serialize};

use chrono::{DateTime, Local};

/// 消息角色
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessageRole {
    /// 用户消息
    User,
    /// 助手/Agent 消息
    Assistant,
}

/// 聊天消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// 消息 ID
    pub id: String,
    /// 发送者角色
    pub role: MessageRole,
    /// 内容
    pub content: String,
    /// 时间戳
    pub timestamp: DateTime<Local>,
}

impl ChatMessage {
    /// 创建用户消息
    pub fn user_message(content: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: MessageRole::User,
            content,
            timestamp: Local::now(),
        }
    }

    /// 创建助手消息
    pub fn assistant_message(content: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            role: MessageRole::Assistant,
            content,
            timestamp: Local::now(),
        }
    }
}

/// 聊天视图状态
pub struct ChatViewState {
    /// 消息列表
    messages: Vec<ChatMessage>,
    /// 是否正在生成响应
    is_generating: bool,
    /// 最大消息数
    max_messages: usize,
}

impl Default for ChatViewState {
    fn default() -> Self {
        Self::new()
    }
}

impl ChatViewState {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            is_generating: false,
            max_messages: 500,
        }
    }

    /// 添加消息
    pub fn add_message(&mut self, message: ChatMessage) {
        self.messages.push(message);
        if self.messages.len() > self.max_messages {
            self.messages
                .drain(0..self.messages.len() - self.max_messages);
        }
    }

    /// 获取消息列表引用
    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    /// 获取消息列表可变引用
    pub fn messages_mut(&mut self) -> &mut Vec<ChatMessage> {
        &mut self.messages
    }

    /// 设置生成状态
    pub fn set_generating(&mut self, generating: bool) {
        self.is_generating = generating;
    }

    /// 是否正在生成
    pub fn is_generating(&self) -> bool {
        self.is_generating
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

/// 聊天输入状态
pub struct ChatInputState {
    /// 输入状态实体
    pub input: Entity<InputState>,
}

impl ChatInputState {
    /// 创建新的输入状态
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .multi_line(true)
                .auto_grow(2, 6)
                .placeholder("输入消息... (Enter 发送，Shift+Enter 换行)")
        });
        Self { input }
    }

    /// 获取输入值
    pub fn value(&self, cx: &App) -> String {
        self.input.read(cx).value().to_string()
    }

    /// 清空输入
    pub fn clear(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.input.update(cx, |state, cx| {
            state.set_value("", window, cx);
        });
    }

    /// 聚焦输入框
    pub fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        self.input.update(cx, |state, cx| {
            state.focus(window, cx);
        });
    }
}

/// 聊天视图事件
#[derive(Debug, Clone)]
pub enum ChatViewEvent {
    /// 发送消息
    SendMessage(String),
}

/// 聊天视图
pub struct ChatView {
    state: ChatViewState,
    input_state: Entity<ChatInputState>,
}

impl ChatView {
    /// 创建新视图
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut state = ChatViewState::new();
        state.add_message(ChatMessage::assistant_message(
            "你好！我是 Nuwax Agent 助手。\n\n我可以帮助你完成各种任务，比如：\n- 编写代码\n- 分析问题\n- 执行系统操作\n\n请告诉我你需要什么帮助？".to_string(),
        ));
        let input_state = cx.new(|cx| ChatInputState::new(window, cx));

        // 订阅输入状态事件
        let input_entity = input_state.read(cx).input.clone();
        let _subscriptions = [cx.subscribe_in(&input_entity, window, {
            move |this: &mut ChatView, _, ev: &InputEvent, window, cx| match ev {
                InputEvent::PressEnter { secondary: false } if !this.state.is_generating() => {
                    this.send_message(window, cx);
                }
                _ => {}
            }
        })];

        Self { state, input_state }
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

    /// 获取状态
    pub fn state(&self) -> &ChatViewState {
        &self.state
    }

    /// 获取可变状态
    pub fn state_mut(&mut self) -> &mut ChatViewState {
        &mut self.state
    }

    /// 获取输入状态
    pub fn input_state<'a>(&self, cx: &'a App) -> &'a ChatInputState {
        self.input_state.read(cx)
    }

    /// 检查是否可以发送消息
    pub fn can_send(&self, cx: &App) -> bool {
        !self.input_state.read(cx).value(cx).trim().is_empty()
    }

    /// 发送消息
    fn send_message(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.input_state.read(cx).value(cx);
        if !text.trim().is_empty() {
            // 添加用户消息
            self.add_message(ChatMessage::user_message(text.clone()), cx);
            // 清空输入 - update the inner InputState
            self.input_state.update(cx, |chat_input, cx| {
                chat_input.input.update(cx, |state, cx| {
                    state.set_value("", window, cx);
                });
            });
            // 发送事件
            cx.emit(ChatViewEvent::SendMessage(text));
        }
    }

    /// 渲染单条消息
    fn render_message(
        &self,
        message: &ChatMessage,
        _index: usize,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let is_user = message.role == MessageRole::User;
        let time_str = message.timestamp.format("%H:%M").to_string();
        let message_id = message.id.clone();

        // 头像
        let avatar = if is_user {
            Avatar::new()
                .name("U")
                .small()
                .bg(theme.primary)
                .text_color(theme.primary_foreground)
        } else {
            Avatar::new()
                .name("AI")
                .small()
                .bg(theme.accent)
                .text_color(theme.accent_foreground)
        };

        // 消息气泡样式
        let bubble_bg = if is_user {
            theme.primary
        } else {
            theme.sidebar
        };
        let bubble_text = if is_user {
            theme.primary_foreground
        } else {
            theme.foreground
        };

        // 发送者名称
        let sender_name = if is_user { "你" } else { "助手" };

        // 操作按钮
        let copy_btn = Button::new(SharedString::from(format!("copy-{}", message_id)))
            .icon(gpui_component::Icon::new(gpui_component::IconName::Copy))
            .ghost()
            .tooltip("复制")
            .small()
            .on_click(cx.listener(move |_, _, _, _cx| {
                // TODO: 复制到剪贴板
            }));

        let delete_btn = Button::new(SharedString::from(format!("delete-{}", message_id)))
            .icon(gpui_component::Icon::new(gpui_component::IconName::Delete))
            .ghost()
            .tooltip("删除")
            .small()
            .on_click(cx.listener(move |this, _, _, cx| {
                this.state_mut()
                    .messages_mut()
                    .retain(|m| m.id != message_id);
                cx.notify();
            }));

        // 消息容器
        let container = if is_user {
            h_flex().flex_row_reverse()
        } else {
            h_flex().flex_row()
        };

        container.w_full().p_3().gap_3().child(avatar).child(
            v_flex()
                .max_w(px(500.0))
                .gap_1()
                .child(
                    h_flex()
                        .justify_between()
                        .items_center()
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme.muted_foreground)
                                .child(sender_name),
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
                        .w_full()
                        .p_3()
                        .rounded_lg()
                        .bg(bubble_bg)
                        .text_color(bubble_text)
                        .text_sm()
                        .child(
                            div()
                                .text_sm()
                                .text_color(bubble_text)
                                .child(message.content.clone()),
                        ),
                )
                .when(!is_user, |this| {
                    this.child(h_flex().gap_1().mt_1().child(copy_btn).child(delete_btn))
                }),
        )
    }

    /// 渲染空状态
    fn render_empty_state(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .child(
                div()
                    .text_color(theme.muted_foreground)
                    .child(gpui_component::Icon::new(gpui_component::IconName::Bot)),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .mt_4()
                    .child("暂无消息，开始对话吧"),
            )
    }

    /// 渲染打字指示器
    fn render_typing_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        h_flex().gap_3().p_3().bg(theme.sidebar).rounded_lg().child(
            h_flex()
                .gap_1()
                .child(
                    div()
                        .size(px(8.0))
                        .rounded_full()
                        .bg(theme.muted_foreground),
                )
                .child(
                    div()
                        .size(px(8.0))
                        .rounded_full()
                        .bg(theme.muted_foreground),
                )
                .child(
                    div()
                        .size(px(8.0))
                        .rounded_full()
                        .bg(theme.muted_foreground),
                ),
        )
    }
}

impl EventEmitter<ChatViewEvent> for ChatView {}

impl Render for ChatView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let is_generating = self.state.is_generating();
        let can_send = self.can_send(cx);
        let theme = cx.theme().clone();

        // 消息列表项
        let message_items: Vec<_> = self
            .state
            .messages
            .iter()
            .enumerate()
            .map(|(index, msg)| self.render_message(msg, index, cx))
            .collect();

        // 打字指示器
        let typing_indicator = if is_generating {
            Some(self.render_typing_indicator(cx))
        } else {
            None
        };

        // 获取输入组件的引用
        let input_entity = self.input_state.read(cx).input.clone();

        v_flex()
            .size_full()
            .bg(theme.background)
            // Header
            .child(
                h_flex()
                    .h(px(48.0))
                    .px_4()
                    .items_center()
                    .border_b_1()
                    .border_color(theme.border)
                    .bg(theme.sidebar)
                    .child(
                        div()
                            .text_base()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.foreground)
                            .child("聊天"),
                    ),
            )
            // 消息列表
            .child(
                div().flex_1().overflow_y_scrollbar().child(
                    v_flex()
                        .p_4()
                        .gap_3()
                        .children(message_items)
                        .when_some(typing_indicator, |this, indicator| this.child(indicator)),
                ),
            )
            // 输入区域
            .child(
                h_flex()
                    .min_h(px(120.0))
                    .max_h(px(300.0))
                    .bg(theme.sidebar)
                    .border_t_1()
                    .border_color(theme.border)
                    .p_3()
                    .gap_2()
                    .items_end()
                    // 附件按钮
                    .child(
                        Popover::new("attachment-popover")
                            .trigger(
                                Button::new("attach-btn")
                                    .icon(gpui_component::Icon::new(gpui_component::IconName::Plus))
                                    .ghost()
                                    .tooltip("附件"),
                            )
                            .content(|_, _, _| {
                                v_flex()
                                    .w(px(140.0))
                                    .gap_1()
                                    .p_1()
                                    .rounded_md()
                                    .shadow_lg()
                                    .child(
                                        Button::new("screenshot-btn")
                                            .label("截图")
                                            .ghost()
                                            .w_full()
                                            .text_left(),
                                    )
                                    .child(
                                        Button::new("image-btn")
                                            .label("图片")
                                            .ghost()
                                            .w_full()
                                            .text_left(),
                                    )
                                    .child(
                                        Button::new("file-btn")
                                            .label("文件")
                                            .ghost()
                                            .w_full()
                                            .text_left(),
                                    )
                                    .into_any_element()
                            }),
                    )
                    // 输入框
                    .child(
                        div()
                            .flex_1()
                            .min_h(px(40.0))
                            .max_h(px(240.0))
                            .bg(theme.background)
                            .rounded_md()
                            .child(Input::new(&input_entity).appearance(false).h_full()),
                    )
                    // 发送按钮
                    .child(
                        Button::new("send-btn")
                            .icon(gpui_component::Icon::new(gpui_component::IconName::ArrowUp))
                            .primary()
                            .disabled(!can_send || is_generating)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.send_message(window, cx);
                            })),
                    ),
            )
    }
}

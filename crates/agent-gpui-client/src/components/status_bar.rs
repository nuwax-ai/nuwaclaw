//! 状态栏组件

use std::sync::Arc;

use gpui::*;
use gpui_component::{h_flex, tag::Tag, ActiveTheme};

use crate::viewmodels::{StatusBarViewModel, UIAgentState, UIConnectionState};

/// 状态栏视图组件
pub struct StatusBarView {
    /// ViewModel
    view_model: Arc<StatusBarViewModel>,
}

impl StatusBarView {
    /// 创建新的状态栏视图
    pub fn new(view_model: Arc<StatusBarViewModel>) -> Self {
        Self { view_model }
    }
}

impl Default for StatusBarView {
    fn default() -> Self {
        Self::new(Arc::new(StatusBarViewModel::new()))
    }
}

/// 获取连接状态标签
fn connection_label(state: UIConnectionState) -> &'static str {
    match state {
        UIConnectionState::Disconnected => "未连接",
        UIConnectionState::Connecting => "连接中",
        UIConnectionState::Connected => "已连接",
        UIConnectionState::Error => "连接错误",
    }
}

/// 获取 Agent 状态标签
fn agent_label(state: UIAgentState) -> &'static str {
    match state {
        UIAgentState::Offline => "离线",
        UIAgentState::Idle => "就绪",
        UIAgentState::Connecting => "连接中",
        UIAgentState::Executing => "执行中",
        UIAgentState::Paused => "已暂停",
        UIAgentState::Completed => "已完成",
        UIAgentState::Error => "错误",
    }
}

/// 根据连接状态获取 Tag 变体
fn connection_tag(state: UIConnectionState) -> Tag {
    match state {
        UIConnectionState::Connected => Tag::success(),
        UIConnectionState::Connecting => Tag::warning(),
        UIConnectionState::Error => Tag::danger(),
        UIConnectionState::Disconnected => Tag::secondary(),
    }
}

/// 根据 Agent 状态获取 Tag 变体
fn agent_tag(state: UIAgentState) -> Tag {
    match state {
        UIAgentState::Executing => Tag::info(),
        UIAgentState::Idle => Tag::secondary(),
        UIAgentState::Connecting => Tag::warning(),
        UIAgentState::Paused => Tag::warning(),
        UIAgentState::Completed => Tag::success(),
        UIAgentState::Error => Tag::danger(),
        UIAgentState::Offline => Tag::secondary(),
    }
}

impl Render for StatusBarView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let state = futures::executor::block_on(self.view_model.get_state());

        // 构建 Agent 状态文本（包含任务数）
        let agent_text = if state.agent_task_count > 0 {
            format!(
                "{} ({})",
                agent_label(state.agent_state),
                state.agent_task_count
            )
        } else {
            agent_label(state.agent_state).to_string()
        };

        h_flex()
            .w_full()
            .h(px(28.0))
            .px_4()
            .items_center()
            .justify_between()
            .bg(theme.tab_bar)
            .border_t_1()
            .border_color(theme.border)
            .child(
                // 左侧：连接状态和 Agent 状态
                h_flex()
                    .gap_4()
                    .items_center()
                    .child(
                        h_flex().gap_1().items_center().child(
                            connection_tag(state.connection_state)
                                .child(connection_label(state.connection_state)),
                        ),
                    )
                    .child(
                        h_flex()
                            .gap_1()
                            .items_center()
                            .child(agent_tag(state.agent_state).child(agent_text)),
                    ),
            )
            .child(
                // 右侧：依赖状态
                h_flex().gap_1().items_center().child(if state.has_update {
                    Tag::warning().child("有更新")
                } else {
                    Tag::success().child(state.dependency_text)
                }),
            )
    }
}

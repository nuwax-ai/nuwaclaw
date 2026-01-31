//! 状态栏组件

use std::sync::Arc;

use gpui::*;
use gpui_component::{tag::Tag, ActiveTheme, Icon, IconName, Sizable, h_flex};

use crate::viewmodels::{
    StatusBarAction, StatusBarViewModel, UIAgentState, UIConnectionMode, UIConnectionState,
};

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

    /// 更新连接状态
    pub fn set_connection_state(&mut self, state: UIConnectionState, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        let state_for_task = state;
        cx.spawn(async move |view, cx| {
            vm.set_connection_state(state_for_task).await;
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

    /// 更新 Agent 状态
    pub fn set_agent_state(&mut self, state: UIAgentState, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        let state_for_task = state;
        cx.spawn(async move |view, cx| {
            vm.set_agent_state(state_for_task).await;
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

    /// 更新依赖状态
    pub fn set_dependency_ok(&mut self, ok: bool, cx: &mut Context<Self>) {
        let vm = self.view_model.clone();
        let ok_for_task = ok;
        cx.spawn(async move |view, cx| {
            vm.set_dependency_ok(ok_for_task).await;
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

    /// 渲染连接状态指示器
    fn render_connection_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let state = futures::executor::block_on(self.view_model.connection_state());
        let (tag, text): (Tag, String) = match &state {
            UIConnectionState::Disconnected => (Tag::danger(), "未连接".to_string()),
            UIConnectionState::Connecting => (Tag::warning(), "连接中...".to_string()),
            UIConnectionState::Connected(mode, latency) => {
                let mode_text = mode.label();
                (Tag::success(), format!("{} ({}ms)", mode_text, latency))
            }
            UIConnectionState::Error(msg) => (Tag::danger(), msg.clone()),
        };

        h_flex()
            .gap_1()
            .items_center()
            .child(tag.child(text))
    }

    /// 渲染 Agent 状态指示器
    fn render_agent_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let state = futures::executor::block_on(self.view_model.agent_state());

        // 根据状态选择 Tag 变体
        let tag: Tag = match state {
            UIAgentState::Idle => Tag::secondary(),
            UIAgentState::Active(_) => Tag::info(),
            UIAgentState::Executing(_, _) => Tag::success(),
            UIAgentState::Error => Tag::danger(),
        };

        h_flex()
            .gap_1()
            .items_center()
            .child(tag.child(state.label()))
    }

    /// 渲染依赖状态指示器
    fn render_dependency_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let dependency_ok = futures::executor::block_on(self.view_model.dependency_ok());

        let tag: Tag = if dependency_ok { Tag::success() } else { Tag::warning() };

        h_flex()
            .gap_1()
            .items_center()
            .child(tag.child(if dependency_ok { "依赖正常" } else { "依赖缺失" }))
    }
}

impl Default for StatusBarView {
    fn default() -> Self {
        Self::new(Arc::new(StatusBarViewModel::new()))
    }
}

impl Render for StatusBarView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

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
                    .child(self.render_connection_indicator(cx))
                    .child(self.render_agent_indicator(cx)),
            )
            .child(
                // 右侧：依赖状态
                h_flex()
                    .items_center()
                    .child(self.render_dependency_indicator(cx)),
            )
    }
}

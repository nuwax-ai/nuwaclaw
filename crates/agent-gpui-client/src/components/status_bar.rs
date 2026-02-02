//! 状态栏组件

use std::sync::Arc;

use gpui::*;
use gpui_component::{tag::Tag, ActiveTheme, h_flex};

use crate::viewmodels::StatusBarViewModel;

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

impl Render for StatusBarView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let state = futures::executor::block_on(self.view_model.get_state());

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
                        h_flex()
                            .gap_1()
                            .items_center()
                            .child(
                                Tag::secondary()
                                    .child(state.connection_text)
                            )
                    )
                    .child(
                        h_flex()
                            .gap_1()
                            .items_center()
                            .child(
                                Tag::secondary()
                                    .child(state.agent_text)
                            )
                    )
            )
            .child(
                // 右侧：依赖状态
                h_flex()
                    .gap_1()
                    .items_center()
                    .child(
                        if state.has_update {
                            Tag::warning().child("有更新")
                        } else {
                            Tag::success().child(state.dependency_text)
                        }
                    )
            )
    }
}

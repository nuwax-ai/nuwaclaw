//! 状态栏组件

use gpui::*;
use gpui_component::{h_flex, ActiveTheme, Icon, IconName, Sizable};

/// 连接状态
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    /// 已断开
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接（模式，延迟 ms）
    Connected(ConnectionMode, u32),
    /// 错误
    Error(String),
}

/// 连接模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    P2P,
    Relay,
}

/// Agent 状态
#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    /// 空闲
    Idle,
    /// 运行中（活跃任务数）
    Active(usize),
    /// 执行中（当前/总数）
    Executing(usize, usize),
    /// 错误
    Error,
}

/// 状态栏数据
pub struct StatusBar {
    /// 连接状态
    pub connection_state: ConnectionState,
    /// Agent 状态
    pub agent_state: AgentState,
    /// 依赖是否正常
    pub dependency_ok: bool,
}

impl Default for StatusBar {
    fn default() -> Self {
        Self {
            connection_state: ConnectionState::Disconnected,
            agent_state: AgentState::Idle,
            dependency_ok: true,
        }
    }
}

/// 状态栏视图组件
pub struct StatusBarView {
    /// 状态数据
    status: StatusBar,
}

impl StatusBarView {
    /// 创建新的状态栏视图
    pub fn new() -> Self {
        Self {
            status: StatusBar::default(),
        }
    }

    /// 更新连接状态
    pub fn set_connection_state(&mut self, state: ConnectionState, cx: &mut Context<Self>) {
        self.status.connection_state = state;
        cx.notify();
    }

    /// 更新 Agent 状态
    pub fn set_agent_state(&mut self, state: AgentState, cx: &mut Context<Self>) {
        self.status.agent_state = state;
        cx.notify();
    }

    /// 更新依赖状态
    pub fn set_dependency_ok(&mut self, ok: bool, cx: &mut Context<Self>) {
        self.status.dependency_ok = ok;
        cx.notify();
    }

    /// 渲染连接状态指示器
    fn render_connection_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (icon, color, text) = match &self.status.connection_state {
            ConnectionState::Disconnected => {
                (IconName::Globe, theme.danger, "未连接".to_string())
            }
            ConnectionState::Connecting => {
                (IconName::Loader, theme.warning, "连接中...".to_string())
            }
            ConnectionState::Connected(mode, latency) => {
                let mode_text = match mode {
                    ConnectionMode::P2P => "P2P",
                    ConnectionMode::Relay => "中继",
                };
                (
                    IconName::Globe,
                    theme.success,
                    format!("{} ({}ms)", mode_text, latency),
                )
            }
            ConnectionState::Error(msg) => {
                (IconName::CircleX, theme.danger, msg.clone())
            }
        };

        h_flex()
            .gap_1()
            .items_center()
            .child(Icon::new(icon).small().text_color(color))
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(text),
            )
    }

    /// 渲染 Agent 状态指示器
    fn render_agent_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (icon, color, text) = match &self.status.agent_state {
            AgentState::Idle => (IconName::Dash, theme.muted_foreground, "空闲".to_string()),
            AgentState::Active(count) => {
                (IconName::Bot, theme.accent, format!("活跃 ({})", count))
            }
            AgentState::Executing(current, total) => (
                IconName::Loader,
                theme.success,
                format!("执行中 ({}/{})", current, total),
            ),
            AgentState::Error => (IconName::TriangleAlert, theme.danger, "错误".to_string()),
        };

        h_flex()
            .gap_1()
            .items_center()
            .child(Icon::new(icon).small().text_color(color))
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(text),
            )
    }

    /// 渲染依赖状态指示器
    fn render_dependency_indicator(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (icon, color, text) = if self.status.dependency_ok {
            (IconName::CircleCheck, theme.success, "依赖正常")
        } else {
            (IconName::CircleX, theme.warning, "依赖缺失")
        };

        h_flex()
            .gap_1()
            .items_center()
            .child(Icon::new(icon).small().text_color(color))
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(text),
            )
    }
}

impl Default for StatusBarView {
    fn default() -> Self {
        Self::new()
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

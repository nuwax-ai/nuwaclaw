//! 根组件
//!
//! 主窗口的根布局容器，包含标题栏、Tab 面板、内容区、状态栏

use gpui::*;
use gpui_component::{
    button::Button, h_flex, tab::Tab, tab::TabBar, v_flex, ActiveTheme, Icon, IconName,
    Selectable, Sizable,
};

use crate::app::{AppEvent, AppState};
use crate::components::status_bar::StatusBarView;

/// Tab 页面类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TabPage {
    /// 客户端信息
    ClientInfo,
    /// 设置
    Settings,
    /// 依赖管理
    Dependencies,
    /// 远程桌面（需要 remote-desktop feature）
    #[cfg(feature = "remote-desktop")]
    RemoteDesktop,
    /// 聊天（需要 chat-ui feature）
    #[cfg(feature = "chat-ui")]
    Chat,
    /// 关于
    About,
}

impl TabPage {
    /// 获取所有可用的 Tab 页面
    pub fn all() -> Vec<Self> {
        let mut tabs = vec![Self::ClientInfo, Self::Settings, Self::Dependencies];

        #[cfg(feature = "remote-desktop")]
        tabs.push(Self::RemoteDesktop);

        #[cfg(feature = "chat-ui")]
        tabs.push(Self::Chat);

        tabs.push(Self::About);
        tabs
    }

    /// 获取 Tab 标签文本
    pub fn label(&self) -> &'static str {
        match self {
            Self::ClientInfo => "客户端",
            Self::Settings => "设置",
            Self::Dependencies => "依赖",
            #[cfg(feature = "remote-desktop")]
            Self::RemoteDesktop => "远程桌面",
            #[cfg(feature = "chat-ui")]
            Self::Chat => "聊天",
            Self::About => "关于",
        }
    }

    /// 获取 Tab 图标
    pub fn icon(&self) -> IconName {
        match self {
            Self::ClientInfo => IconName::LayoutDashboard,
            Self::Settings => IconName::Settings,
            Self::Dependencies => IconName::Folder,
            #[cfg(feature = "remote-desktop")]
            Self::RemoteDesktop => IconName::Maximize,
            #[cfg(feature = "chat-ui")]
            Self::Chat => IconName::Inbox,
            Self::About => IconName::Info,
        }
    }
}

/// 根组件事件
#[derive(Debug, Clone)]
pub enum RootEvent {
    /// Tab 切换
    TabChanged(TabPage),
}

/// 根组件 - 主布局容器
pub struct RootView {
    /// 应用状态
    app_state: Entity<AppState>,
    /// 当前激活的 Tab
    active_tab: TabPage,
    /// 状态栏视图
    status_bar: Entity<StatusBarView>,
    /// 订阅（需要保持存活）
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<RootEvent> for RootView {}

impl RootView {
    /// 创建新的根组件
    pub fn new(
        app_state: Entity<AppState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        // 创建状态栏视图
        let status_bar = cx.new(|_cx| StatusBarView::new());

        // 订阅应用状态事件
        let subscriptions = vec![cx.subscribe_in(&app_state, window, {
            move |_this, _state, event: &AppEvent, _window, cx| match event {
                AppEvent::ConnectionStateChanged | AppEvent::TaskStateChanged => {
                    cx.notify();
                }
                _ => {}
            }
        })];

        Self {
            app_state,
            active_tab: TabPage::ClientInfo,
            status_bar,
            _subscriptions: subscriptions,
        }
    }

    /// 切换 Tab
    pub fn switch_tab(&mut self, tab: TabPage, cx: &mut Context<Self>) {
        if self.active_tab != tab {
            self.active_tab = tab;
            cx.emit(RootEvent::TabChanged(tab));
            cx.notify();
        }
    }

    /// 渲染标题栏
    fn render_title_bar(&self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        h_flex()
            .w_full()
            .h(px(48.0))
            .px_4()
            .items_center()
            .justify_between()
            .bg(theme.title_bar)
            .border_b_1()
            .border_color(theme.border)
            .child(
                // 左侧：Logo 和标题
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(Icon::new(IconName::Bot).text_color(theme.accent))
                    .child(
                        div()
                            .text_base()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.foreground)
                            .child("NuWax Agent"),
                    ),
            )
            .child(
                // 右侧：窗口控制按钮（可选）
                h_flex().gap_1(),
            )
    }

    /// 渲染 Tab 栏
    fn render_tab_bar(&self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let tabs = TabPage::all();
        let active_tab = self.active_tab;

        TabBar::new("main-tabs").children(tabs.into_iter().map(|tab| {
            let is_active = tab == active_tab;
            Tab::new()
                .label(tab.label())
                .selected(is_active)
                .prefix(Icon::new(tab.icon()).small())
                .on_click(cx.listener(move |this, _, _window, cx| {
                    this.switch_tab(tab, cx);
                }))
        }))
    }

    /// 渲染内容区
    fn render_content(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .flex_1()
            .w_full()
            .p_4()
            .bg(theme.background)
            .child(match self.active_tab {
                TabPage::ClientInfo => self.render_client_info_page(window, cx).into_any_element(),
                TabPage::Settings => self.render_settings_page(window, cx).into_any_element(),
                TabPage::Dependencies => {
                    self.render_dependencies_page(window, cx).into_any_element()
                }
                #[cfg(feature = "remote-desktop")]
                TabPage::RemoteDesktop => {
                    self.render_remote_desktop_page(window, cx).into_any_element()
                }
                #[cfg(feature = "chat-ui")]
                TabPage::Chat => self.render_chat_page(window, cx).into_any_element(),
                TabPage::About => self.render_about_page(window, cx).into_any_element(),
            })
    }

    /// 渲染客户端信息页
    fn render_client_info_page(
        &self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let client_id = self.app_state.read(cx).client_id.clone();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("客户端信息"),
            )
            .child(
                v_flex()
                    .gap_2()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        h_flex()
                            .justify_between()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("客户端 ID"),
                            )
                            .child(
                                div()
                                    .text_base()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.foreground)
                                    .child(client_id.unwrap_or_else(|| "未连接".to_string())),
                            ),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("连接密码"),
                            )
                            .child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        div()
                                            .text_base()
                                            .text_color(theme.foreground)
                                            .child("••••••••"),
                                    )
                                    .child(
                                        Button::new("copy-password")
                                            .label("复制")
                                            .small()
                                            .on_click(cx.listener(|_this, _, _window, _cx| {
                                                // TODO: 复制密码到剪贴板
                                                tracing::info!("Copy password clicked");
                                            })),
                                    ),
                            ),
                    ),
            )
    }

    /// 渲染设置页
    fn render_settings_page(
        &self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("设置"),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child("设置页面正在开发中..."),
            )
    }

    /// 渲染依赖管理页
    fn render_dependencies_page(
        &self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("依赖管理"),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child("依赖管理页面正在开发中..."),
            )
    }

    /// 渲染远程桌面页
    #[cfg(feature = "remote-desktop")]
    fn render_remote_desktop_page(
        &self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("远程桌面"),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child("远程桌面功能正在开发中..."),
            )
    }

    /// 渲染聊天页
    #[cfg(feature = "chat-ui")]
    fn render_chat_page(
        &self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("聊天"),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child("聊天功能正在开发中..."),
            )
    }

    /// 渲染关于页
    fn render_about_page(
        &self,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let version = env!("CARGO_PKG_VERSION");

        v_flex()
            .gap_4()
            .items_center()
            .child(Icon::new(IconName::Bot).large().text_color(theme.accent))
            .child(
                div()
                    .text_2xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .child("NuWax Agent"),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child(format!("版本 {}", version)),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(theme.muted_foreground)
                    .child("跨平台 Agent 客户端"),
            )
    }
}

impl Render for RootView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .size_full()
            .bg(theme.background)
            .child(self.render_title_bar(window, cx))
            .child(self.render_tab_bar(window, cx))
            .child(self.render_content(window, cx))
            .child(self.status_bar.clone())
    }
}

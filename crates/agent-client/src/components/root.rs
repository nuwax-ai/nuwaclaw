//! 根组件
//!
//! 主窗口的根布局容器，包含标题栏、Tab 面板、内容区、状态栏

use std::sync::Arc;

use gpui::*;
use gpui_component::{
    ActiveTheme, Icon, IconName, Selectable, Sizable, button::Button, h_flex, tab::Tab,
    tab::TabBar, v_flex,
};

use crate::app::{AppEvent, AppState};
use crate::components::client_info::ClientInfoView;
use crate::components::dependency_manager::DependencyManagerView;
use crate::components::permissions::PermissionsView;
#[cfg(feature = "remote-desktop")]
use crate::components::remote_desktop::RemoteDesktopView;
use crate::components::settings::SettingsView;
use crate::components::status_bar::StatusBarView;
use crate::viewmodels::DependencyViewModel;

/// Tab 页面类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TabPage {
    /// 客户端信息
    ClientInfo,
    /// 设置
    Settings,
    /// 依赖管理
    Dependencies,
    /// 权限设置
    Permissions,
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
        let mut tabs = vec![
            Self::ClientInfo,
            Self::Settings,
            Self::Dependencies,
            Self::Permissions,
        ];

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
            Self::Permissions => "权限",
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
            Self::Permissions => IconName::Eye,
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
    /// 客户端信息视图
    client_info_view: Entity<ClientInfoView>,
    /// 设置视图
    settings_view: Entity<SettingsView>,
    /// 依赖管理视图
    dependency_view: Entity<DependencyManagerView>,
    /// 权限设置视图
    permissions_view: Entity<PermissionsView>,
    /// 远程桌面视图
    #[cfg(feature = "remote-desktop")]
    remote_desktop_view: Entity<RemoteDesktopView>,
    /// 订阅（需要保持存活）
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<RootEvent> for RootView {}

impl RootView {
    /// 创建新的根组件
    pub fn new(app_state: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // 创建 ViewModel
        let dependency_view_model = Arc::new(DependencyViewModel::with_default_manager());

        // 创建子视图
        let status_bar = cx.new(|_cx| StatusBarView::new());
        let client_info_view = cx.new(|_cx| ClientInfoView::new());
        let settings_view = cx.new(|_cx| SettingsView::new());
        let dependency_view = cx.new(|_cx| DependencyManagerView::new(dependency_view_model));
        let permissions_view = cx.new(|cx| PermissionsView::new(cx));
        #[cfg(feature = "remote-desktop")]
        let remote_desktop_view = cx.new(|cx| RemoteDesktopView::new(window, cx));

        // 订阅应用状态事件
        let client_info_for_sub = client_info_view.clone();
        let status_bar_for_sub = status_bar.clone();
        let subscriptions = vec![cx.subscribe_in(&app_state, window, {
            move |_this, state, event: &AppEvent, _window, cx| match event {
                AppEvent::ConnectionStateChanged => {
                    // 更新 ClientInfoView 的客户端 ID
                    let state_ref = state.read(cx);
                    let client_id = state_ref.client_id.clone();
                    let is_connected = state_ref.is_connected;
                    client_info_for_sub.update(cx, |view, cx| {
                        view.set_client_id(client_id, cx);
                    });
                    // 更新 StatusBar 连接状态
                    status_bar_for_sub.update(cx, |view, cx| {
                        if is_connected {
                            view.set_connection_state(
                                super::status_bar::ConnectionState::Connected(
                                    super::status_bar::ConnectionMode::P2P,
                                    0,
                                ),
                                cx,
                            );
                        } else {
                            view.set_connection_state(
                                super::status_bar::ConnectionState::Disconnected,
                                cx,
                            );
                        }
                    });
                    cx.notify();
                }
                AppEvent::TaskStateChanged => {
                    cx.notify();
                }
                _ => {}
            }
        })];

        Self {
            app_state,
            active_tab: TabPage::ClientInfo,
            status_bar,
            client_info_view,
            settings_view,
            dependency_view,
            permissions_view,
            #[cfg(feature = "remote-desktop")]
            remote_desktop_view,
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
                TabPage::ClientInfo => self.client_info_view.clone().into_any_element(),
                TabPage::Settings => self.settings_view.clone().into_any_element(),
                TabPage::Dependencies => self.dependency_view.clone().into_any_element(),
                TabPage::Permissions => self.permissions_view.clone().into_any_element(),
                #[cfg(feature = "remote-desktop")]
                TabPage::RemoteDesktop => self.remote_desktop_view.clone().into_any_element(),
                #[cfg(feature = "chat-ui")]
                TabPage::Chat => self
                    .render_placeholder_page("聊天", "聊天功能正在开发中...", cx)
                    .into_any_element(),
                TabPage::About => self.render_about_page(window, cx).into_any_element(),
            })
    }

    /// 渲染占位页面
    fn render_placeholder_page(
        &self,
        title: &str,
        message: &str,
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
                    .child(title.to_string()),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child(message.to_string()),
            )
    }

    /// 渲染关于页
    fn render_about_page(&self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
            .child(
                v_flex()
                    .gap_2()
                    .mt_4()
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
                                    .child("协议版本"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(crate::core::protocol::PROTOCOL_VERSION),
                            ),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("平台"),
                            )
                            .child(div().text_sm().text_color(theme.foreground).child(format!(
                                "{}/{}",
                                std::env::consts::OS,
                                std::env::consts::ARCH
                            ))),
                    )
                    .child(
                        h_flex()
                            .justify_between()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("许可证"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child("Apache-2.0"),
                            ),
                    ),
            )
            .child(
                h_flex()
                    .gap_2()
                    .mt_4()
                    .child(
                        Button::new("export-logs")
                            .label("导出日志")
                            .icon(Icon::new(IconName::ExternalLink).small())
                            .small(),
                    )
                    .child(
                        Button::new("open-website")
                            .label("官网")
                            .icon(Icon::new(IconName::Globe).small())
                            .small(),
                    ),
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

//! 根组件
//!
//! 主窗口的根布局容器，包含标题栏、Tab 面板、内容区、状态栏

use std::sync::Arc;

use gpui::*;
use gpui_component::{
    button::{Button, ButtonVariants},
    h_flex,
    scroll::ScrollableElement as _,
    sidebar::{Sidebar, SidebarGroup, SidebarMenu, SidebarMenuItem},
    v_flex, ActiveTheme, Icon, IconName, Side, Sizable,
};

use crate::app::{AppEvent, AppState};
#[cfg(feature = "chat-ui")]
use crate::components::chat::ChatView;
use crate::components::client_info::{ClientInfoEvent, ClientInfoView};
use crate::components::dependency_manager::DependencyManagerView;
use crate::components::permissions::{PermissionsEvent, PermissionsView};
#[cfg(feature = "remote-desktop")]
use crate::components::remote_desktop::RemoteDesktopView;
use crate::components::settings::{SettingsPage, SettingsView};
use crate::components::status_bar::StatusBarView;
use crate::viewmodels::{
    ClientInfoViewModel, DependencyViewModel, PermissionsViewModel, SettingsViewModel,
    StatusBarViewModel, UIConnectionState,
};
use nuwax_agent_core::permissions::PermissionManager;
use nuwax_agent_core::utils::notification::Notification;

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
    /// 调试
    Debug,
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
        tabs.push(Self::Debug);
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
            Self::Debug => "调试",
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
            Self::Debug => IconName::SquareTerminal,
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
    /// 状态栏 ViewModel（用于直接更新）
    #[allow(dead_code)]
    status_bar_vm: Arc<StatusBarViewModel>,
    /// 客户端信息视图
    client_info_view: Entity<ClientInfoView>,
    /// 客户端信息 ViewModel（用于直接更新）
    #[allow(dead_code)]
    client_info_vm: Arc<ClientInfoViewModel>,
    /// 设置视图
    settings_view: Entity<SettingsView>,
    /// 依赖管理视图
    dependency_view: Entity<DependencyManagerView>,
    /// 权限设置视图
    permissions_view: Entity<PermissionsView>,
    /// 远程桌面视图
    #[cfg(feature = "remote-desktop")]
    remote_desktop_view: Entity<RemoteDesktopView>,
    /// 聊天视图
    #[cfg(feature = "chat-ui")]
    chat_view: Entity<ChatView>,
    /// 订阅（需要保持存活）
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<RootEvent> for RootView {}

impl RootView {
    /// 创建新的根组件
    pub fn new(app_state: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // 创建 ViewModel
        let client_info_view_model = Arc::new(ClientInfoViewModel::new());
        let dependency_view_model = Arc::new(DependencyViewModel::with_default_manager());
        let permissions_view_model = Arc::new(PermissionsViewModel::new());
        let _settings_view_model = Arc::new(SettingsViewModel::new());
        let status_bar_view_model = Arc::new(StatusBarViewModel::new());

        // 创建子视图
        let status_bar = cx.new(|_cx| StatusBarView::new(status_bar_view_model.clone()));
        let client_info_view = cx.new(|cx| ClientInfoView::new(client_info_view_model.clone(), cx));
        let settings_view = cx.new(|_cx| SettingsView::new());
        let dependency_view = cx.new(|cx| DependencyManagerView::new(dependency_view_model, cx));
        let permissions_view = cx.new(|cx| PermissionsView::new(permissions_view_model, cx));
        #[cfg(feature = "remote-desktop")]
        let remote_desktop_view = cx.new(|cx| RemoteDesktopView::new(window, cx));

        #[cfg(feature = "chat-ui")]
        let chat_view = cx.new(|cx| ChatView::new(window, cx));

        // 订阅应用状态事件
        let client_info_vm = client_info_view_model.clone();
        let status_bar_vm = status_bar_view_model.clone();
        let settings_view_for_sub = settings_view.clone();
        let app_state_clone = app_state.clone();
        let subscriptions = vec![
            cx.subscribe_in(&app_state, window, {
                move |_this, state, event: &AppEvent, _window, cx| match event {
                    AppEvent::ConnectionStateChanged => {
                        // 更新 ClientInfoViewModel 的客户端 ID
                        let state_ref = state.read(cx);
                        let client_id = state_ref.client_id.clone();
                        let is_connected = state_ref.is_connected;

                        // 直接更新 ViewModel（同步方式，因为不涉及 I/O）
                        let client_info_vm = client_info_vm.clone();
                        let status_bar_vm = status_bar_vm.clone();

                        futures::executor::block_on(async {
                            client_info_vm.set_client_id(client_id).await;
                            client_info_vm.set_connected(is_connected).await;

                            // 更新状态栏
                            let connection_state = if is_connected {
                                UIConnectionState::Connected
                            } else {
                                UIConnectionState::Disconnected
                            };
                            status_bar_vm.update_connection(connection_state).await;
                        });
                        cx.notify();
                    }
                    AppEvent::TaskStateChanged => {
                        cx.notify();
                    }
                    _ => {}
                }
            }),
            // 订阅 ClientInfoView 事件
            cx.subscribe_in(&client_info_view, window, {
                move |_this, _state, event: &ClientInfoEvent, _window, cx| match event {
                    ClientInfoEvent::NavigateToSecurity => {
                        // 切换到设置页面并导航到安全子页面
                        settings_view_for_sub.update(cx, |view, cx| {
                            view.set_active_page(SettingsPage::Security, cx);
                        });
                    }
                }
            }),
            // 订阅 PermissionsView 事件
            cx.subscribe_in(&permissions_view, window, {
                move |_this, _state, event: &PermissionsEvent, _window, cx| match event {
                    PermissionsEvent::OpenSettings(permission_name) => {
                        // 打开系统设置页面
                        if let Err(e) = PermissionManager::open_settings(permission_name) {
                            let message = format!("打开系统设置失败: {}", e);
                            let app_state_inner = app_state_clone.clone();
                            cx.spawn(async move |_view, cx| {
                                let _ = cx.update(|cx| {
                                    app_state_inner.update(cx, |state, _cx| {
                                        state.show_notification(Notification::error(message));
                                    });
                                });
                            })
                            .detach();
                        }
                    }
                    PermissionsEvent::Refreshed => {
                        cx.notify();
                    }
                }
            }),
        ];

        Self {
            app_state,
            active_tab: TabPage::ClientInfo,
            status_bar,
            status_bar_vm: status_bar_view_model,
            client_info_view,
            client_info_vm: client_info_view_model,
            settings_view,
            dependency_view,
            permissions_view,
            #[cfg(feature = "remote-desktop")]
            remote_desktop_view,
            #[cfg(feature = "chat-ui")]
            chat_view,
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

    /// 切换到设置 Tab 的指定子页面
    pub fn switch_to_settings_page(&mut self, page: SettingsPage, cx: &mut Context<Self>) {
        // 先切换到设置 Tab
        if self.active_tab != TabPage::Settings {
            self.active_tab = TabPage::Settings;
        }
        // 切换到指定子页面
        self.settings_view.update(cx, |view, cx| {
            view.set_active_page(page, cx);
        });
        cx.emit(RootEvent::TabChanged(TabPage::Settings));
        cx.notify();
    }

    /// 渲染侧边栏
    fn render_sidebar(&self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let active_tab = self.active_tab;

        Sidebar::new(Side::Left)
            .w(px(140.0))
            .child(SidebarGroup::new("导航").child(SidebarMenu::new().children(
                TabPage::all().into_iter().map(|tab| {
                    let is_active = tab == active_tab;
                    SidebarMenuItem::new(tab.label())
                        .icon(Icon::new(tab.icon()).small())
                        .active(is_active)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.switch_tab(tab, cx);
                        }))
                }),
            )))
    }

    /// 渲染内容区
    fn render_content(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .flex_1()
            .size_full()
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
                TabPage::Chat => self.chat_view.clone().into_any_element(),
                TabPage::About => self.render_about_page(window, cx).into_any_element(),
                TabPage::Debug => self.render_debug_page(window, cx).into_any_element(),
            })
    }

    /// 渲染占位页面
    #[allow(dead_code)]
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
                    .child("Nuwax Agent"),
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
                                    .child(nuwax_agent_core::protocol::PROTOCOL_VERSION),
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

    /// 渲染调试页
    fn render_debug_page(&self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .size_full()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.foreground)
                    .p_4()
                    .child("调试"),
            )
            .child(
                v_flex()
                    .gap_4()
                    .flex_1()
                    .p_4()
                    .pt_0()
                    .overflow_y_scrollbar()
                    .child(
                        v_flex()
                            .gap_4()
                            .p_4()
                            .rounded_lg()
                            .bg(theme.sidebar)
                            .border_1()
                            .border_color(theme.border)
                            .child(
                                div()
                                    .text_base()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.foreground)
                                    .child("日志操作"),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("导出或上报日志用于问题排查"),
                            )
                            .child(
                                h_flex()
                                    .gap_2()
                                    .mt_2()
                                    .child(
                                        Button::new("export-logs")
                                            .label("导出日志")
                                            .icon(Icon::new(IconName::ExternalLink).small())
                                            .small()
                                            .on_click(cx.listener(|this, _, _window, cx| {
                                                this.export_logs(cx);
                                            })),
                                    )
                                    .child(
                                        Button::new("report-logs")
                                            .label("上报日志")
                                            .icon(Icon::new(IconName::ArrowUp).small())
                                            .small()
                                            .primary()
                                            .on_click(cx.listener(|this, _, _window, cx| {
                                                this.upload_logs(cx);
                                            })),
                                    ),
                            ),
                    ),
            )
    }

    /// 导出日志
    fn export_logs(&self, cx: &mut Context<Self>) {
        let app_state = self.app_state.clone();
        cx.spawn(async move |_view, cx| {
            let logs = Self::read_log_file().await;

            match logs {
                Ok(log_content) => {
                    let _ = cx.update(|cx| {
                        app_state.update(cx, |state, _cx| {
                            state.show_notification(Notification::success("日志导出功能开发中"));
                        });
                    });
                    tracing::info!("Logs exported, size: {} bytes", log_content.len());
                }
                Err(e) => {
                    let _ = cx.update(|cx| {
                        app_state.update(cx, |state, _cx| {
                            state.show_notification(Notification::error(format!(
                                "无法读取日志文件: {}",
                                e
                            )));
                        });
                    });
                }
            }
        })
        .detach();
    }

    /// 上报日志
    fn upload_logs(&self, cx: &mut Context<Self>) {
        let app_state = self.app_state.clone();
        cx.spawn(async move |_view, cx| {
            let logs = Self::read_log_file().await;

            match logs {
                Ok(log_content) => {
                    let _ = cx.update(|cx| {
                        app_state.update(cx, |state, _cx| {
                            state.show_notification(Notification::info("正在上传日志..."));
                        });
                    });

                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

                    let _ = cx.update(|cx| {
                        app_state.update(cx, |state, _cx| {
                            state.show_notification(Notification::success("日志上报功能开发中"));
                        });
                    });
                    tracing::info!("Log upload triggered, size: {} bytes", log_content.len());
                }
                Err(e) => {
                    let _ = cx.update(|cx| {
                        app_state.update(cx, |state, _cx| {
                            state.show_notification(Notification::error(format!(
                                "无法读取日志文件: {}",
                                e
                            )));
                        });
                    });
                }
            }
        })
        .detach();
    }

    /// 读取日志文件内容
    async fn read_log_file() -> Result<String, String> {
        let log_dir = dirs::data_dir()
            .ok_or_else(|| "无法获取数据目录".to_string())?
            .join("nuwax-agent");

        let entries =
            std::fs::read_dir(&log_dir).map_err(|e| format!("无法读取日志目录: {}", e))?;

        let mut log_files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path().is_file() && e.file_name().to_string_lossy().starts_with("nuwax-agent")
            })
            .collect();

        if log_files.is_empty() {
            return Err("未找到日志文件".to_string());
        }

        log_files.sort_by_key(|e| e.path());
        if let Some(latest_log) = log_files.last() {
            let log_path = latest_log.path();
            std::fs::read_to_string(&log_path).map_err(|e| format!("无法读取日志文件: {}", e))
        } else {
            Err("未找到日志文件".to_string())
        }
    }
}

impl Render for RootView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        // 使用 Flex 布局：侧边栏 + 内容区，状态栏固定在底部（整行）
        div().size_full().bg(theme.background).child(
            v_flex()
                .size_full()
                .child(
                    h_flex()
                        .flex_1()
                        .overflow_hidden()
                        .child(self.render_sidebar(window, cx))
                        .child(self.render_content(window, cx)),
                )
                .child(div().w_full().child(self.status_bar.clone())),
        )
    }
}

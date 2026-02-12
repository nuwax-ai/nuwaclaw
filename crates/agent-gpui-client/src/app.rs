//! 应用状态管理
//!
//! 使用 gpui 实现桌面 UI 应用

use std::sync::Arc;

use gpui::*;
use gpui_component::init as init_ui;
use tokio::sync::{broadcast, RwLock};

use crate::components::root::RootView;
use nuwax_agent_core::config::ConfigManager;
use nuwax_agent_core::connection::{adapter::ConnectionAdapter, RustDeskAdapter};
use nuwax_agent_core::utils::Notification;

/// 应用状态变化事件
#[derive(Debug, Clone)]
pub enum AppEvent {
    /// 配置已更新
    ConfigUpdated,
    /// 连接状态变化
    ConnectionStateChanged,
    /// 任务状态变化
    TaskStateChanged,
    /// 请求显示窗口
    ShowWindow,
    /// 请求隐藏窗口
    HideWindow,
    /// 请求退出
    Quit,
}

/// 任务信息
#[derive(Debug, Clone)]
pub struct TaskInfo {
    pub task_id: String,
    pub session_id: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

/// 应用状态
pub struct AppState {
    /// 配置管理器
    pub config: Arc<RwLock<ConfigManager>>,
    /// 通知通道
    pub notifications: broadcast::Sender<Notification>,
    /// 活跃任务
    pub active_tasks: Vec<TaskInfo>,
    /// 是否已连接
    pub is_connected: bool,
    /// 客户端 ID
    pub client_id: Option<String>,
}

impl EventEmitter<AppEvent> for AppState {}

impl AppState {
    /// 创建新的应用状态
    pub fn new(config: Arc<RwLock<ConfigManager>>, client_id: Option<String>) -> Self {
        let (notifications, _) = broadcast::channel(100);
        Self {
            config,
            notifications,
            active_tasks: Vec::new(),
            is_connected: false,
            client_id,
        }
    }

    /// 设置连接状态
    pub fn set_connected(&mut self, connected: bool, cx: &mut Context<Self>) {
        self.is_connected = connected;
        cx.emit(AppEvent::ConnectionStateChanged);
        cx.notify();
    }

    /// 设置客户端 ID
    pub fn set_client_id(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        self.client_id = id;
        cx.notify();
    }

    /// 添加任务
    pub fn add_task(&mut self, task: TaskInfo, cx: &mut Context<Self>) {
        self.active_tasks.push(task);
        cx.emit(AppEvent::TaskStateChanged);
        cx.notify();
    }

    /// 移除任务
    pub fn remove_task(&mut self, task_id: &str, cx: &mut Context<Self>) {
        self.active_tasks.retain(|t| t.task_id != task_id);
        cx.emit(AppEvent::TaskStateChanged);
        cx.notify();
    }

    /// 发送通知
    pub fn show_notification(&self, notification: Notification) {
        let _ = self.notifications.send(notification);
    }
}

/// 应用入口 - 启动 gpui 应用
pub struct Application;

impl Application {
    /// 运行应用
    pub fn run(
        config: Arc<RwLock<ConfigManager>>,
        runtime_handle: tokio::runtime::Handle,
    ) -> anyhow::Result<()> {
        tracing::info!("Starting gpui application...");

        // 在进入 gpui 事件循环前读取配置（避免在 gpui 回调中 block_on）
        let (hbbs_addr, hbbr_addr) = runtime_handle.block_on(async {
            let config_guard = config.read().await;
            (
                config_guard.config.server.hbbs_addr.clone(),
                config_guard.config.server.hbbr_addr.clone(),
            )
        });

        // 创建并配置 RustDeskAdapter
        let adapter = Arc::new(RustDeskAdapter::new());
        adapter.configure_server(&hbbs_addr, &hbbr_addr);

        // 在 tokio runtime 中启动 RustDeskAdapter
        let adapter_for_start = adapter.clone();
        runtime_handle.spawn(async move {
            if let Err(e) = adapter_for_start.start().await {
                tracing::error!("Failed to start RustDeskAdapter: {:?}", e);
            }
        });

        tracing::info!(
            "RustDeskAdapter configured (hbbs={}), starting...",
            hbbs_addr
        );

        // 创建 gpui 应用
        let app = gpui::Application::new();

        // 在进入 gpui 事件循环前读取配置（恢复 client_id）
        let client_id = runtime_handle
            .block_on(async { config.read().await.get_client_id().map(|s| s.to_string()) });

        app.run(move |cx| {
            // 初始化 gpui-component 主题和资源
            init_ui(cx);

            // 创建应用状态（从配置恢复 client_id）
            let app_state = cx.new(|_cx| AppState::new(config.clone(), client_id.clone()));

            // 创建主窗口
            let window_options = WindowOptions {
                window_bounds: Some(WindowBounds::centered(size(px(900.), px(700.)), cx)),
                ..Default::default()
            };

            // 启动客户端 ID 轮询（在 gpui async 上下文中）
            let adapter_for_poll = adapter.clone();
            let app_state_for_poll = app_state.clone();
            let rt_for_poll = runtime_handle.clone();
            cx.spawn(async move |cx| {
                // 等待 adapter 启动
                rt_for_poll
                    .spawn(async {
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    })
                    .await
                    .ok();

                let mut last_id = String::new();
                loop {
                    // 从 adapter 获取客户端 ID（在 tokio 上下文中执行）
                    let adapter_ref = adapter_for_poll.clone();
                    let id: String = rt_for_poll
                        .spawn(async move { adapter_ref.get_client_id().await })
                        .await
                        .unwrap_or_default();

                    // 如果 ID 有变化，更新 AppState 和 UI
                    if !id.is_empty() && id != last_id {
                        tracing::info!("Client ID obtained: {}", id);
                        last_id = id.clone();
                        let id_clone = id.clone();
                        let state = app_state_for_poll.clone();
                        cx.update(|cx| {
                            state.update(cx, |state, cx| {
                                state.set_client_id(Some(id_clone.clone()), cx);
                                state.set_connected(true, cx);
                            });
                        })
                        .ok();
                    }

                    // 每 2 秒轮询一次
                    rt_for_poll
                        .spawn(async {
                            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        })
                        .await
                        .ok();
                }
            })
            .detach();

            cx.spawn(async move |cx| {
                cx.open_window(window_options, |window, cx| {
                    // 设置窗口标题
                    window.set_window_title("Nuwax Agent");

                    // 创建根组件
                    let root_view = cx.new(|cx| RootView::new(app_state.clone(), window, cx));

                    // gpui-component 要求第一层是 gpui_component::Root
                    cx.new(|cx| gpui_component::Root::new(root_view, window, cx))
                })?;

                Ok::<_, anyhow::Error>(())
            })
            .detach();

            tracing::info!("Main window created");
        });

        Ok(())
    }
}

// 导出类型
pub use AppState as App;

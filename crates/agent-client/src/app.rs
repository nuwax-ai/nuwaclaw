//! 应用状态管理
//!
//! 使用 gpui 实现桌面 UI 应用

use std::sync::Arc;

use gpui::*;
use gpui_component::init as init_ui;
use tokio::sync::{broadcast, RwLock};

use crate::components::root::RootView;
use crate::core::config::ConfigManager;
use crate::utils::notification::Notification;

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
    pub fn new(config: Arc<RwLock<ConfigManager>>) -> Self {
        let (notifications, _) = broadcast::channel(100);
        Self {
            config,
            notifications,
            active_tasks: Vec::new(),
            is_connected: false,
            client_id: None,
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
    pub fn run(config: Arc<RwLock<ConfigManager>>) -> anyhow::Result<()> {
        tracing::info!("Starting gpui application...");

        // 创建 gpui 应用
        let app = gpui::Application::new();

        app.run(move |cx| {
            // 初始化 gpui-component 主题和资源
            init_ui(cx);

            // 创建应用状态
            let app_state = cx.new(|_cx| AppState::new(config.clone()));

            // 创建主窗口
            let window_options = WindowOptions {
                window_bounds: Some(WindowBounds::centered(size(px(900.), px(700.)), cx)),
                ..Default::default()
            };

            cx.spawn(async move |cx| {
                cx.open_window(window_options, |window, cx| {
                    // 设置窗口标题
                    window.set_window_title("NuWax Agent");

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

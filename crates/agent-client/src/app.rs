//! 应用状态管理

use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};
use dashmap::DashMap;

use crate::core::config::ConfigManager;
use crate::utils::notification::Notification;

/// 应用状态
pub struct App {
    /// 配置管理器
    pub config: Arc<RwLock<ConfigManager>>,

    /// 通知通道
    pub notifications: broadcast::Sender<Notification>,

    /// 活跃任务映射
    pub active_tasks: DashMap<String, TaskInfo>,
}

/// 任务信息
pub struct TaskInfo {
    pub task_id: String,
    pub session_id: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

impl App {
    /// 创建新应用实例
    pub async fn new(config: Arc<RwLock<ConfigManager>>) -> anyhow::Result<Self> {
        let (notifications, _) = broadcast::channel(100);

        Ok(Self {
            config,
            notifications,
            active_tasks: DashMap::new(),
        })
    }

    /// 运行应用主循环
    pub async fn run(&mut self) -> anyhow::Result<()> {
        tracing::info!("Application starting...");

        // TODO: 初始化连接
        // TODO: 创建 UI
        // TODO: 运行事件循环

        // 临时：保持运行
        tracing::info!("Application initialized, waiting for shutdown signal...");

        // 等待 Ctrl+C
        tokio::signal::ctrl_c().await?;

        tracing::info!("Shutdown signal received");
        Ok(())
    }

    /// 显示通知
    pub fn show_notification(&self, notification: Notification) {
        let _ = self.notifications.send(notification);
    }
}

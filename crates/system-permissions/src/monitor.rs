//! 权限监控器实现
//!
//! 使用定时轮询策略检测权限状态变化，通过 broadcast channel 发送事件

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{broadcast, Mutex};
use tokio::time::interval;

use crate::permissions_trait::PermissionMonitor;
use crate::{
    PermissionError, PermissionManager, PermissionState, PermissionStatus, SystemPermission,
};

/// 默认轮询间隔（毫秒）
const DEFAULT_POLL_INTERVAL_MS: u64 = 2000;

/// 事件通道容量
const CHANNEL_CAPACITY: usize = 64;

/// 基于轮询的权限监控器
///
/// 定期检查权限状态，与缓存状态对比后发送变化事件
pub struct PollingPermissionMonitor {
    /// 权限管理器
    manager: Arc<dyn PermissionManager>,
    /// 轮询间隔（毫秒）
    interval_ms: u64,
    /// 事件发送器
    tx: broadcast::Sender<(SystemPermission, PermissionState)>,
    /// 运行状态标志
    running: Arc<AtomicBool>,
    /// 上一次的权限状态缓存
    last_states: Arc<Mutex<HashMap<SystemPermission, PermissionStatus>>>,
    /// 轮询任务句柄
    task_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl PollingPermissionMonitor {
    /// 创建新的轮询权限监控器
    ///
    /// # Arguments
    /// * `manager` - 权限管理器实例
    pub fn new(manager: Arc<dyn PermissionManager>) -> Self {
        Self::with_interval(manager, DEFAULT_POLL_INTERVAL_MS)
    }

    /// 创建带自定义轮询间隔的监控器
    ///
    /// # Arguments
    /// * `manager` - 权限管理器实例
    /// * `interval_ms` - 轮询间隔（毫秒）
    pub fn with_interval(manager: Arc<dyn PermissionManager>, interval_ms: u64) -> Self {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            manager,
            interval_ms,
            tx,
            running: Arc::new(AtomicBool::new(false)),
            last_states: Arc::new(Mutex::new(HashMap::new())),
            task_handle: Arc::new(Mutex::new(None)),
        }
    }

    /// 轮询循环主体
    async fn poll_loop(
        manager: Arc<dyn PermissionManager>,
        tx: broadcast::Sender<(SystemPermission, PermissionState)>,
        running: Arc<AtomicBool>,
        last_states: Arc<Mutex<HashMap<SystemPermission, PermissionStatus>>>,
        interval_ms: u64,
    ) {
        let mut ticker = interval(Duration::from_millis(interval_ms));

        // 初始化缓存
        {
            let permissions = manager.supported_permissions();
            let states = manager.check_all(&permissions).await;
            let mut cache = last_states.lock().await;
            for state in states {
                cache.insert(state.permission, state.status);
            }
        }

        while running.load(Ordering::SeqCst) {
            ticker.tick().await;

            if !running.load(Ordering::SeqCst) {
                break;
            }

            // 检查所有权限
            let permissions = manager.supported_permissions();
            let states = manager.check_all(&permissions).await;

            // 与缓存对比
            let mut cache = last_states.lock().await;
            for state in states {
                let permission = state.permission;
                let new_status = state.status;

                if let Some(old_status) = cache.get(&permission) {
                    if *old_status != new_status {
                        // 状态发生变化，发送事件
                        let _ = tx.send((permission, state.clone()));
                        cache.insert(permission, new_status);
                    }
                } else {
                    // 新权限，加入缓存
                    cache.insert(permission, new_status);
                }
            }
        }
    }
}

#[async_trait]
impl PermissionMonitor for PollingPermissionMonitor {
    /// 启动监控
    async fn start(&self) -> Result<(), PermissionError> {
        if self.running.swap(true, Ordering::SeqCst) {
            // 已经在运行
            return Ok(());
        }

        let manager = Arc::clone(&self.manager);
        let tx = self.tx.clone();
        let running = Arc::clone(&self.running);
        let last_states = Arc::clone(&self.last_states);
        let interval_ms = self.interval_ms;

        let handle = tokio::spawn(async move {
            Self::poll_loop(manager, tx, running, last_states, interval_ms).await;
        });

        *self.task_handle.lock().await = Some(handle);

        Ok(())
    }

    /// 停止监控
    async fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);

        // 等待任务结束
        if let Some(handle) = self.task_handle.lock().await.take() {
            let _ = handle.await;
        }

        // 清空缓存
        self.last_states.lock().await.clear();
    }

    /// 订阅权限变化事件
    fn subscribe(&self) -> broadcast::Receiver<(SystemPermission, PermissionState)> {
        self.tx.subscribe()
    }

    /// 获取当前所有权限状态
    async fn get_all_states(&self) -> Vec<PermissionState> {
        let permissions = self.manager.supported_permissions();
        self.manager.check_all(&permissions).await
    }
}

impl std::fmt::Debug for PollingPermissionMonitor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PollingPermissionMonitor")
            .field("interval_ms", &self.interval_ms)
            .field("running", &self.running.load(Ordering::SeqCst))
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_permission_manager;

    #[tokio::test]
    async fn test_monitor_creation() {
        let manager = create_permission_manager();
        let monitor = PollingPermissionMonitor::new(manager);
        assert!(!monitor.running.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn test_monitor_start_stop() {
        let manager = create_permission_manager();
        let monitor = PollingPermissionMonitor::with_interval(manager, 100);

        // 启动
        monitor.start().await.expect("Failed to start monitor");
        assert!(monitor.running.load(Ordering::SeqCst));

        // 等待一个轮询周期
        tokio::time::sleep(Duration::from_millis(150)).await;

        // 停止
        monitor.stop().await;
        assert!(!monitor.running.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn test_monitor_subscribe() {
        let manager = create_permission_manager();
        let monitor = PollingPermissionMonitor::new(manager);

        let _rx = monitor.subscribe();
        // 验证可以订阅
    }

    #[tokio::test]
    async fn test_get_all_states() {
        let manager = create_permission_manager();
        let monitor = PollingPermissionMonitor::new(manager);

        let states = monitor.get_all_states().await;
        assert!(!states.is_empty());
    }
}

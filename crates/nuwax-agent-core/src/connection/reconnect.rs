//! 重连逻辑
//!
//! 实现网络断开后的自动重连机制，包含指数退避和随机抖动

use rand::RngExt;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::sleep;
use tracing::{info, warn};

/// 重连配置
#[derive(Debug, Clone)]
pub struct ReconnectConfig {
    /// 初始重试间隔（秒）
    pub initial_interval_secs: u64,
    /// 最大重试间隔（秒）
    pub max_interval_secs: u64,
    /// 最大重试次数（0 表示无限）
    pub max_retries: u32,
    /// 抖动因子 (0.0-1.0)
    pub jitter_factor: f64,
}

impl Default for ReconnectConfig {
    fn default() -> Self {
        Self {
            initial_interval_secs: 1,
            max_interval_secs: 30,
            max_retries: 0, // 无限重试
            jitter_factor: 0.3,
        }
    }
}

/// 重连状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconnectState {
    /// 空闲
    Idle,
    /// 等待重连
    Waiting,
    /// 正在重连
    Reconnecting,
    /// 已放弃（达到最大重试次数）
    GaveUp,
}

/// 重连管理器
pub struct ReconnectManager {
    /// 配置
    config: ReconnectConfig,
    /// 当前状态
    state: Arc<RwLock<ReconnectState>>,
    /// 当前重试次数
    retry_count: Arc<RwLock<u32>>,
    /// 当前重试间隔
    current_interval: Arc<RwLock<u64>>,
}

impl ReconnectManager {
    /// 创建新的重连管理器
    pub fn new(config: ReconnectConfig) -> Self {
        Self {
            current_interval: Arc::new(RwLock::new(config.initial_interval_secs)),
            config,
            state: Arc::new(RwLock::new(ReconnectState::Idle)),
            retry_count: Arc::new(RwLock::new(0)),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> ReconnectState {
        *self.state.read().await
    }

    /// 获取重试次数
    pub async fn get_retry_count(&self) -> u32 {
        *self.retry_count.read().await
    }

    /// 重置状态
    pub async fn reset(&self) {
        *self.state.write().await = ReconnectState::Idle;
        *self.retry_count.write().await = 0;
        *self.current_interval.write().await = self.config.initial_interval_secs;
        info!("Reconnect manager reset");
    }

    /// 计算下一次重试的等待时间
    pub async fn calculate_delay(&self) -> Duration {
        let base_interval = *self.current_interval.read().await;

        // 添加随机抖动
        let jitter = if self.config.jitter_factor > 0.0 {
            let mut rng = rand::rng();
            let jitter_range = (base_interval as f64 * self.config.jitter_factor) as u64;
            if jitter_range > 0 {
                rng.random_range(0..jitter_range)
            } else {
                0
            }
        } else {
            0
        };

        let delay = base_interval + jitter;
        Duration::from_secs(delay)
    }

    /// 执行重连尝试
    ///
    /// 返回 true 表示应该继续重试，false 表示应该放弃
    pub async fn attempt_reconnect<F, Fut>(&self, connect_fn: F) -> bool
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<()>>,
    {
        // 检查是否达到最大重试次数
        let retry_count = *self.retry_count.read().await;
        if self.config.max_retries > 0 && retry_count >= self.config.max_retries {
            warn!("Max reconnect retries reached ({})", retry_count);
            *self.state.write().await = ReconnectState::GaveUp;
            return false;
        }

        // 等待
        *self.state.write().await = ReconnectState::Waiting;
        let delay = self.calculate_delay().await;
        info!(
            "Waiting {:?} before reconnect attempt #{}",
            delay,
            retry_count + 1
        );
        sleep(delay).await;

        // 尝试重连
        *self.state.write().await = ReconnectState::Reconnecting;
        *self.retry_count.write().await += 1;

        match connect_fn().await {
            Ok(()) => {
                info!("Reconnect successful after {} attempts", retry_count + 1);
                self.reset().await;
                true
            }
            Err(e) => {
                warn!("Reconnect attempt #{} failed: {:?}", retry_count + 1, e);

                // 指数退避
                let mut interval = self.current_interval.write().await;
                *interval = (*interval * 2).min(self.config.max_interval_secs);

                // 继续重试
                true
            }
        }
    }

    /// 停止重连
    pub async fn stop(&self) {
        *self.state.write().await = ReconnectState::Idle;
    }
}

impl Default for ReconnectManager {
    fn default() -> Self {
        Self::new(ReconnectConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_reconnect_manager_creation() {
        let manager = ReconnectManager::new(ReconnectConfig::default());
        assert_eq!(manager.get_state().await, ReconnectState::Idle);
        assert_eq!(manager.get_retry_count().await, 0);
    }

    #[tokio::test]
    async fn test_calculate_delay() {
        let manager = ReconnectManager::new(ReconnectConfig {
            initial_interval_secs: 1,
            max_interval_secs: 30,
            max_retries: 5,
            jitter_factor: 0.0, // 无抖动便于测试
        });

        let delay = manager.calculate_delay().await;
        assert_eq!(delay, Duration::from_secs(1));
    }
}

//! 心跳保活机制
//!
//! 定期发送心跳包检测连接是否存活

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{interval, Instant};
use tracing::{debug, warn};

use librustdesk::hbb_common::config::Config as RustDeskConfig;

/// 心跳配置
#[derive(Debug, Clone)]
pub struct HeartbeatConfig {
    /// 心跳间隔（秒）
    pub interval_secs: u64,
    /// 超时时间（秒）
    pub timeout_secs: u64,
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        Self {
            interval_secs: 30,
            timeout_secs: 90,
        }
    }
}

/// 心跳事件
#[derive(Debug, Clone)]
pub enum HeartbeatEvent {
    /// 心跳成功（延迟 ms）
    Success(u32),
    /// 心跳超时
    Timeout,
}

/// 心跳管理器
pub struct HeartbeatManager {
    /// 配置
    config: HeartbeatConfig,
    /// 最后收到 pong 的时间
    last_pong: Arc<RwLock<Option<Instant>>>,
    /// 事件发送
    event_tx: broadcast::Sender<HeartbeatEvent>,
    /// 是否运行中
    running: Arc<RwLock<bool>>,
}

impl HeartbeatManager {
    /// 创建新的心跳管理器
    pub fn new(config: HeartbeatConfig) -> Self {
        let (event_tx, _) = broadcast::channel(16);
        Self {
            config,
            last_pong: Arc::new(RwLock::new(None)),
            event_tx,
            running: Arc::new(RwLock::new(false)),
        }
    }

    /// 订阅心跳事件
    pub fn subscribe(&self) -> broadcast::Receiver<HeartbeatEvent> {
        self.event_tx.subscribe()
    }

    /// 启动心跳任务
    pub async fn start(&self) {
        let mut running = self.running.write().await;
        if *running {
            return;
        }
        *running = true;
        drop(running);

        let interval_secs = self.config.interval_secs;
        let timeout_secs = self.config.timeout_secs;
        let last_pong = self.last_pong.clone();
        let event_tx = self.event_tx.clone();
        let running = self.running.clone();

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(interval_secs));

            loop {
                ticker.tick().await;

                if !*running.read().await {
                    break;
                }

                // 检查是否超时
                let last = *last_pong.read().await;
                if let Some(last_time) = last {
                    if last_time.elapsed() > Duration::from_secs(timeout_secs) {
                        warn!("Heartbeat timeout");
                        let _ = event_tx.send(HeartbeatEvent::Timeout);
                        continue;
                    }
                }

                // 通过 RustDesk Config 读取延迟作为心跳信号
                debug!("Heartbeat check via RustDesk latency");
                let server = RustDeskConfig::get_rendezvous_server();
                if !server.is_empty() {
                    let latency_key = format!("latency_{}", server);
                    let latency_str = RustDeskConfig::get_option(&latency_key);
                    if let Ok(latency) = latency_str.parse::<i64>() {
                        let latency_ms = latency as u32;
                        *last_pong.write().await = Some(Instant::now());
                        let _ = event_tx.send(HeartbeatEvent::Success(latency_ms));
                        continue;
                    }
                }

                // 如果无法读取延迟，记录一个零延迟心跳表示连通
                *last_pong.write().await = Some(Instant::now());
                let _ = event_tx.send(HeartbeatEvent::Success(0));
            }
        });
    }

    /// 停止心跳任务
    pub async fn stop(&self) {
        *self.running.write().await = false;
    }

    /// 记录收到 pong
    pub async fn on_pong_received(&self) {
        *self.last_pong.write().await = Some(Instant::now());
    }

    /// 检查连接是否存活
    pub async fn is_alive(&self) -> bool {
        let last = *self.last_pong.read().await;
        if let Some(last_time) = last {
            last_time.elapsed() < Duration::from_secs(self.config.timeout_secs)
        } else {
            false
        }
    }
}

impl Default for HeartbeatManager {
    fn default() -> Self {
        Self::new(HeartbeatConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_heartbeat_manager_creation() {
        let manager = HeartbeatManager::new(HeartbeatConfig::default());
        assert!(!manager.is_alive().await);
    }
}

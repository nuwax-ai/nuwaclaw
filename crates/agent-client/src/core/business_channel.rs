//! 业务通道模块
//!
//! 在基础连接之上建立业务数据通道，用于传输 Agent 任务数据

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock, broadcast};
use thiserror::Error;
use tracing::{info, warn, debug};
use serde::{Serialize, Deserialize};

/// 业务通道 ID
pub const BUSINESS_CHANNEL_ID: u32 = 0xB1F;

/// 消息类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MessageType {
    /// Agent 任务请求
    AgentTaskRequest = 1,
    /// Agent 任务响应
    AgentTaskResponse = 2,
    /// 任务进度更新
    TaskProgress = 3,
    /// 任务取消
    TaskCancel = 4,
    /// 心跳
    Heartbeat = 10,
    /// 系统通知
    SystemNotify = 20,
    /// 自定义
    Custom = 99,
}

/// 业务消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessMessage {
    /// 消息 ID
    pub id: String,
    /// 消息类型
    pub message_type: MessageType,
    /// 消息负载
    pub payload: Vec<u8>,
    /// 时间戳
    pub timestamp: i64,
    /// 来源客户端 ID
    pub source_id: Option<String>,
    /// 目标客户端 ID
    pub target_id: Option<String>,
}

impl BusinessMessage {
    /// 创建新消息
    pub fn new(message_type: MessageType, payload: Vec<u8>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            message_type,
            payload,
            timestamp: chrono::Utc::now().timestamp_millis(),
            source_id: None,
            target_id: None,
        }
    }

    /// 设置来源
    pub fn with_source(mut self, source_id: String) -> Self {
        self.source_id = Some(source_id);
        self
    }

    /// 设置目标
    pub fn with_target(mut self, target_id: String) -> Self {
        self.target_id = Some(target_id);
        self
    }

    /// 序列化为字节
    pub fn to_bytes(&self) -> Result<Vec<u8>, ChannelError> {
        serde_json::to_vec(self)
            .map_err(|e| ChannelError::SerializationFailed(e.to_string()))
    }

    /// 从字节反序列化
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ChannelError> {
        serde_json::from_slice(bytes)
            .map_err(|e| ChannelError::DeserializationFailed(e.to_string()))
    }
}

/// 通道错误
#[derive(Error, Debug)]
pub enum ChannelError {
    #[error("通道未连接")]
    NotConnected,
    #[error("发送失败: {0}")]
    SendFailed(String),
    #[error("接收失败: {0}")]
    ReceiveFailed(String),
    #[error("序列化失败: {0}")]
    SerializationFailed(String),
    #[error("反序列化失败: {0}")]
    DeserializationFailed(String),
    #[error("超时")]
    Timeout,
    #[error("通道已关闭")]
    ChannelClosed,
}

/// 消息处理器
pub type MessageHandler = Box<dyn Fn(BusinessMessage) + Send + Sync>;

/// 业务通道
pub struct BusinessChannel {
    /// 是否已连接
    connected: Arc<RwLock<bool>>,
    /// 发送通道
    tx: Option<mpsc::Sender<BusinessMessage>>,
    /// 广播通道（用于订阅）
    broadcast_tx: broadcast::Sender<BusinessMessage>,
    /// 消息处理器
    handlers: Arc<RwLock<HashMap<MessageType, Vec<MessageHandler>>>>,
    /// 待发送队列（离线时缓存）
    pending_queue: Arc<RwLock<Vec<BusinessMessage>>>,
    /// 最大待发送队列大小
    max_pending_size: usize,
}

impl BusinessChannel {
    /// 创建新的业务通道
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(100);

        Self {
            connected: Arc::new(RwLock::new(false)),
            tx: None,
            broadcast_tx,
            handlers: Arc::new(RwLock::new(HashMap::new())),
            pending_queue: Arc::new(RwLock::new(Vec::new())),
            max_pending_size: 1000,
        }
    }

    /// 设置连接状态
    pub async fn set_connected(&mut self, connected: bool, tx: Option<mpsc::Sender<BusinessMessage>>) {
        *self.connected.write().await = connected;
        self.tx = tx;

        if connected {
            // 发送队列中的待发送消息
            self.flush_pending_queue().await;
        }
    }

    /// 检查是否已连接
    pub async fn is_connected(&self) -> bool {
        *self.connected.read().await
    }

    /// 发送消息
    pub async fn send(&self, message: BusinessMessage) -> Result<(), ChannelError> {
        if !*self.connected.read().await {
            // 未连接时，加入待发送队列
            self.enqueue_pending(message).await;
            return Ok(());
        }

        if let Some(ref tx) = self.tx {
            tx.send(message).await
                .map_err(|e| ChannelError::SendFailed(e.to_string()))?;
            Ok(())
        } else {
            Err(ChannelError::NotConnected)
        }
    }

    /// 发送并等待响应
    pub async fn send_and_wait(
        &self,
        message: BusinessMessage,
        timeout_ms: u64,
    ) -> Result<BusinessMessage, ChannelError> {
        let _message_id = message.id.clone();
        self.send(message).await?;

        // 订阅响应
        let mut rx = self.subscribe();
        let timeout = tokio::time::Duration::from_millis(timeout_ms);

        tokio::select! {
            result = async {
                loop {
                    match rx.recv().await {
                        Ok(msg) => {
                            // 检查是否是对应的响应
                            if msg.message_type == MessageType::AgentTaskResponse {
                                // 简单匹配，实际应用中可以更精确
                                return Ok(msg);
                            }
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            return Err(ChannelError::ChannelClosed);
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            // 跳过滞后的消息
                            continue;
                        }
                    }
                }
            } => result,
            _ = tokio::time::sleep(timeout) => {
                Err(ChannelError::Timeout)
            }
        }
    }

    /// 订阅消息
    pub fn subscribe(&self) -> broadcast::Receiver<BusinessMessage> {
        self.broadcast_tx.subscribe()
    }

    /// 注册消息处理器
    pub async fn register_handler<F>(&self, message_type: MessageType, handler: F)
    where
        F: Fn(BusinessMessage) + Send + Sync + 'static,
    {
        let mut handlers = self.handlers.write().await;
        handlers
            .entry(message_type)
            .or_insert_with(Vec::new)
            .push(Box::new(handler));
    }

    /// 处理接收到的消息
    pub async fn handle_message(&self, message: BusinessMessage) {
        debug!("Handling message: {:?}", message.message_type);

        // 广播消息
        let _ = self.broadcast_tx.send(message.clone());

        // 调用注册的处理器
        let handlers = self.handlers.read().await;
        if let Some(handler_list) = handlers.get(&message.message_type) {
            for handler in handler_list {
                handler(message.clone());
            }
        }
    }

    /// 将消息加入待发送队列
    async fn enqueue_pending(&self, message: BusinessMessage) {
        let mut queue = self.pending_queue.write().await;
        if queue.len() < self.max_pending_size {
            queue.push(message);
            debug!("Message enqueued, pending count: {}", queue.len());
        } else {
            warn!("Pending queue full, dropping message");
        }
    }

    /// 刷新待发送队列
    async fn flush_pending_queue(&self) {
        let mut queue = self.pending_queue.write().await;
        let messages: Vec<_> = queue.drain(..).collect();
        drop(queue);

        if !messages.is_empty() {
            info!("Flushing {} pending messages", messages.len());
            for message in messages {
                if let Err(e) = self.send(message).await {
                    warn!("Failed to send pending message: {}", e);
                }
            }
        }
    }

    /// 获取待发送队列大小
    pub async fn pending_count(&self) -> usize {
        self.pending_queue.read().await.len()
    }

    /// 清空待发送队列
    pub async fn clear_pending(&self) {
        self.pending_queue.write().await.clear();
    }
}

impl Default for BusinessChannel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_serialization() {
        let message = BusinessMessage::new(MessageType::AgentTaskRequest, vec![1, 2, 3]);
        let bytes = message.to_bytes().unwrap();
        let decoded = BusinessMessage::from_bytes(&bytes).unwrap();

        assert_eq!(message.id, decoded.id);
        assert_eq!(message.message_type, decoded.message_type);
        assert_eq!(message.payload, decoded.payload);
    }

    #[test]
    fn test_message_with_source_target() {
        let message = BusinessMessage::new(MessageType::SystemNotify, vec![])
            .with_source("client-1".to_string())
            .with_target("client-2".to_string());

        assert_eq!(message.source_id, Some("client-1".to_string()));
        assert_eq!(message.target_id, Some("client-2".to_string()));
    }

    #[tokio::test]
    async fn test_business_channel_not_connected() {
        let channel = BusinessChannel::new();
        assert!(!channel.is_connected().await);

        // 未连接时发送应该入队
        let message = BusinessMessage::new(MessageType::Heartbeat, vec![]);
        channel.send(message).await.unwrap();

        assert_eq!(channel.pending_count().await, 1);
    }
}

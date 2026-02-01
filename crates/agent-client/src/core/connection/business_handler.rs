//! P2P 业务消息处理器
//!
//! 处理来自 admin-server 的 P2P 业务消息
//! 将 BusinessEnvelope 转换为本地任务并执行

use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use librustdesk::hbb_common::message_proto::{
    BusinessEnvelope, BusinessMessageType,
};

use crate::core::agent::{AgentManager, AgentTask, TaskProgress, TaskResult};
use crate::core::business_channel::{BusinessMessage, MessageType};

/// 业务消息处理事件
#[derive(Debug, Clone)]
pub enum BusinessHandlerEvent {
    /// 收到任务请求
    TaskReceived { message_id: String, task_id: String },
    /// 任务执行完成
    TaskCompleted { task_id: String, success: bool },
    /// 发送响应
    ResponseSent { message_id: String },
    /// 处理错误
    Error { message_id: String, error: String },
}

/// 业务消息处理器
///
/// 处理来自 admin-server 的 P2P 业务消息
pub struct BusinessMessageHandler {
    /// AgentManager 引用
    agent_manager: Arc<AgentManager>,
    /// 事件发送通道
    event_tx: mpsc::Sender<BusinessHandlerEvent>,
    /// 事件接收通道
    event_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<BusinessHandlerEvent>>>,
    /// 本端 peer ID
    self_id: Arc<tokio::sync::RwLock<Option<String>>>,
    /// 响应消息发送通道（用于发送回 admin-server）
    response_tx: Option<mpsc::Sender<BusinessEnvelope>>,
}

impl BusinessMessageHandler {
    /// 创建新的业务消息处理器
    pub fn new(agent_manager: Arc<AgentManager>) -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            agent_manager,
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
            self_id: Arc::new(tokio::sync::RwLock::new(None)),
            response_tx: None,
        }
    }

    /// 设置本端 peer ID
    pub async fn set_self_id(&self, id: String) {
        *self.self_id.write().await = Some(id);
    }

    /// 设置响应发送通道
    pub fn set_response_channel(&mut self, tx: mpsc::Sender<BusinessEnvelope>) {
        self.response_tx = Some(tx);
    }

    /// 获取事件接收器
    pub fn event_receiver(&self) -> Arc<tokio::sync::Mutex<mpsc::Receiver<BusinessHandlerEvent>>> {
        self.event_rx.clone()
    }

    /// 处理接收到的业务消息
    pub async fn handle_message(&self, envelope: BusinessEnvelope) -> anyhow::Result<()> {
        let message_id = envelope.message_id.clone();
        let message_type = envelope.type_.enum_value().unwrap_or(BusinessMessageType::BUSINESS_UNKNOWN);

        debug!(
            "Handling business message: id={}, type={:?}",
            message_id, message_type
        );

        match message_type {
            BusinessMessageType::AGENT_TASK_REQUEST => {
                self.handle_task_request(&envelope).await?;
            }
            BusinessMessageType::TASK_CANCEL => {
                self.handle_task_cancel(&envelope).await?;
            }
            BusinessMessageType::HEARTBEAT => {
                self.handle_heartbeat(&envelope).await?;
            }
            BusinessMessageType::SYSTEM_NOTIFY => {
                self.handle_system_notify(&envelope).await?;
            }
            _ => {
                warn!("Unknown business message type: {:?}", message_type);
            }
        }

        Ok(())
    }

    /// 处理任务请求
    async fn handle_task_request(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        info!(
            "Received task request: message_id={}, from={}",
            envelope.message_id, envelope.source_id
        );

        // 将 protobuf payload 转换为 AgentTask
        let task = self.envelope_to_task(envelope)?;
        let task_id = task.id.clone();
        let message_id = envelope.message_id.clone();

        // 发送事件
        let _ = self.event_tx.send(BusinessHandlerEvent::TaskReceived {
            message_id: message_id.clone(),
            task_id: task_id.clone(),
        }).await;

        // 提交任务到 AgentManager
        match self.agent_manager.submit_task(task).await {
            Ok(_) => {
                info!("Task submitted: {}", task_id);
            }
            Err(e) => {
                error!("Failed to submit task {}: {}", task_id, e);
                let _ = self.event_tx.send(BusinessHandlerEvent::Error {
                    message_id,
                    error: e.to_string(),
                }).await;
                return Err(anyhow::anyhow!("Failed to submit task: {}", e));
            }
        }

        Ok(())
    }

    /// 处理任务取消
    async fn handle_task_cancel(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        // 从 payload 提取 task_id
        let task_id = String::from_utf8(envelope.payload.to_vec())
            .unwrap_or_else(|_| {
                // 尝试 JSON 解析
                serde_json::from_slice::<serde_json::Value>(&envelope.payload)
                    .ok()
                    .and_then(|v| v.get("task_id").and_then(|id| id.as_str()).map(String::from))
                    .unwrap_or_default()
            });

        if task_id.is_empty() {
            warn!("Invalid cancel request: empty task_id");
            return Err(anyhow::anyhow!("Invalid cancel request: empty task_id"));
        }

        info!("Cancelling task: {}", task_id);

        match self.agent_manager.cancel_task(&task_id) {
            Ok(_) => {
                info!("Task cancelled: {}", task_id);
            }
            Err(e) => {
                warn!("Failed to cancel task {}: {}", task_id, e);
            }
        }

        Ok(())
    }

    /// 处理心跳消息
    async fn handle_heartbeat(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        debug!("Received heartbeat from {}", envelope.source_id);

        // 发送心跳响应
        if let Some(ref tx) = self.response_tx {
            let response = self.create_response(
                &envelope.message_id,
                BusinessMessageType::HEARTBEAT,
                b"pong".to_vec(),
                &envelope.source_id,
            ).await;
            let _ = tx.send(response).await;
        }

        Ok(())
    }

    /// 处理系统通知
    async fn handle_system_notify(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        info!(
            "Received system notification from {}: {} bytes",
            envelope.source_id,
            envelope.payload.len()
        );
        // 系统通知目前只记录日志，后续可以扩展处理逻辑
        Ok(())
    }

    /// 将 BusinessEnvelope 转换为 AgentTask
    fn envelope_to_task(&self, envelope: &BusinessEnvelope) -> anyhow::Result<AgentTask> {
        // 尝试从 payload 反序列化 AgentTask
        let task: AgentTask = serde_json::from_slice(&envelope.payload)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize task: {}", e))?;

        Ok(task)
    }

    /// 发送任务进度到 admin-server
    pub async fn send_progress(&self, progress: &TaskProgress) -> anyhow::Result<()> {
        if let Some(ref tx) = self.response_tx {
            let payload = serde_json::to_vec(progress)?;
            let _self_id = self.self_id.read().await.clone().unwrap_or_default();

            let envelope = self.create_response(
                &uuid::Uuid::new_v4().to_string(),
                BusinessMessageType::TASK_PROGRESS,
                payload,
                "", // target_id will be set by connection layer
            ).await;

            tx.send(envelope).await
                .map_err(|e| anyhow::anyhow!("Failed to send progress: {}", e))?;
        }
        Ok(())
    }

    /// 发送任务结果到 admin-server
    pub async fn send_result(&self, result: &TaskResult) -> anyhow::Result<()> {
        if let Some(ref tx) = self.response_tx {
            let payload = serde_json::to_vec(result)?;

            let envelope = self.create_response(
                &uuid::Uuid::new_v4().to_string(),
                BusinessMessageType::AGENT_TASK_RESPONSE,
                payload,
                "", // target_id will be set by connection layer
            ).await;

            tx.send(envelope).await
                .map_err(|e| anyhow::anyhow!("Failed to send result: {}", e))?;

            let _ = self.event_tx.send(BusinessHandlerEvent::TaskCompleted {
                task_id: result.task_id.clone(),
                success: result.success,
            }).await;
        }
        Ok(())
    }

    /// 创建响应消息
    async fn create_response(
        &self,
        message_id: &str,
        message_type: BusinessMessageType,
        payload: Vec<u8>,
        target_id: &str,
    ) -> BusinessEnvelope {
        let self_id = self.self_id.read().await.clone().unwrap_or_default();

        let mut envelope = BusinessEnvelope::new();
        envelope.message_id = message_id.to_string();
        envelope.type_ = message_type.into();
        envelope.payload = payload.into();
        envelope.timestamp = chrono::Utc::now().timestamp_millis();
        envelope.source_id = self_id;
        envelope.target_id = target_id.to_string();
        envelope
    }

    /// 将 BusinessMessage（内部格式）转换为 BusinessEnvelope（protobuf格式）
    pub fn business_message_to_envelope(msg: &BusinessMessage) -> BusinessEnvelope {
        let mut envelope = BusinessEnvelope::new();
        envelope.message_id = msg.id.clone();
        envelope.type_ = Self::message_type_to_business_type(msg.message_type).into();
        envelope.payload = msg.payload.clone().into();
        envelope.timestamp = msg.timestamp;
        envelope.source_id = msg.source_id.clone().unwrap_or_default();
        envelope.target_id = msg.target_id.clone().unwrap_or_default();
        envelope
    }

    /// 将 BusinessEnvelope（protobuf格式）转换为 BusinessMessage（内部格式）
    pub fn envelope_to_business_message(envelope: &BusinessEnvelope) -> BusinessMessage {
        BusinessMessage {
            id: envelope.message_id.clone(),
            message_type: Self::business_type_to_message_type(
                envelope.type_.enum_value().unwrap_or(BusinessMessageType::BUSINESS_UNKNOWN)
            ),
            payload: envelope.payload.to_vec(),
            timestamp: envelope.timestamp,
            source_id: if envelope.source_id.is_empty() { None } else { Some(envelope.source_id.clone()) },
            target_id: if envelope.target_id.is_empty() { None } else { Some(envelope.target_id.clone()) },
        }
    }

    /// 内部消息类型转换为 protobuf 消息类型
    fn message_type_to_business_type(msg_type: MessageType) -> BusinessMessageType {
        match msg_type {
            MessageType::AgentTaskRequest => BusinessMessageType::AGENT_TASK_REQUEST,
            MessageType::AgentTaskResponse => BusinessMessageType::AGENT_TASK_RESPONSE,
            MessageType::TaskProgress => BusinessMessageType::TASK_PROGRESS,
            MessageType::TaskCancel => BusinessMessageType::TASK_CANCEL,
            MessageType::Heartbeat => BusinessMessageType::HEARTBEAT,
            MessageType::SystemNotify => BusinessMessageType::SYSTEM_NOTIFY,
            MessageType::Custom => BusinessMessageType::BUSINESS_UNKNOWN,
        }
    }

    /// protobuf 消息类型转换为内部消息类型
    fn business_type_to_message_type(biz_type: BusinessMessageType) -> MessageType {
        match biz_type {
            BusinessMessageType::AGENT_TASK_REQUEST => MessageType::AgentTaskRequest,
            BusinessMessageType::AGENT_TASK_RESPONSE => MessageType::AgentTaskResponse,
            BusinessMessageType::TASK_PROGRESS => MessageType::TaskProgress,
            BusinessMessageType::TASK_CANCEL => MessageType::TaskCancel,
            BusinessMessageType::HEARTBEAT => MessageType::Heartbeat,
            BusinessMessageType::SYSTEM_NOTIFY => MessageType::SystemNotify,
            BusinessMessageType::BUSINESS_UNKNOWN => MessageType::Custom,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_type_conversion() {
        assert_eq!(
            BusinessMessageHandler::message_type_to_business_type(MessageType::AgentTaskRequest),
            BusinessMessageType::AGENT_TASK_REQUEST
        );
        assert_eq!(
            BusinessMessageHandler::business_type_to_message_type(BusinessMessageType::AGENT_TASK_REQUEST),
            MessageType::AgentTaskRequest
        );
    }

    #[test]
    fn test_envelope_to_business_message() {
        let mut envelope = BusinessEnvelope::new();
        envelope.message_id = "test-123".to_string();
        envelope.type_ = BusinessMessageType::HEARTBEAT.into();
        envelope.payload = b"hello".to_vec().into();
        envelope.timestamp = 1234567890;
        envelope.source_id = "admin-1".to_string();
        envelope.target_id = "client-1".to_string();

        let msg = BusinessMessageHandler::envelope_to_business_message(&envelope);
        assert_eq!(msg.id, "test-123");
        assert_eq!(msg.message_type, MessageType::Heartbeat);
        assert_eq!(msg.payload, b"hello".to_vec());
        assert_eq!(msg.source_id, Some("admin-1".to_string()));
        assert_eq!(msg.target_id, Some("client-1".to_string()));
    }

    #[test]
    fn test_business_message_to_envelope() {
        let msg = BusinessMessage {
            id: "msg-456".to_string(),
            message_type: MessageType::TaskProgress,
            payload: b"progress data".to_vec(),
            timestamp: 9876543210,
            source_id: Some("client-1".to_string()),
            target_id: Some("admin-1".to_string()),
        };

        let envelope = BusinessMessageHandler::business_message_to_envelope(&msg);
        assert_eq!(envelope.message_id, "msg-456");
        assert_eq!(envelope.type_.enum_value().unwrap(), BusinessMessageType::TASK_PROGRESS);
        assert_eq!(envelope.payload.as_ref(), b"progress data");
        assert_eq!(envelope.source_id, "client-1");
        assert_eq!(envelope.target_id, "admin-1");
    }
}

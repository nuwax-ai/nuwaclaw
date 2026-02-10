//! P2P 业务消息处理器
//!
//! 处理来自 admin-server 的 P2P 业务消息
//! 将 BusinessEnvelope 转换为本地任务并执行

use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::agent::{AgentManager, AgentTask};
use crate::business_channel::{
    BusinessEnvelope, BusinessMessage, BusinessMessageType, MessageType,
};
#[cfg(feature = "remote-desktop")]
use librustdesk::hbb_common::protobuf::Message as ProtobufMessage;

#[cfg(feature = "remote-desktop")]
use crate::file_transfer::{FileTransferManager, NoopFileTransferCallback};

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
    /// 文件传输管理器 (仅在 remote-desktop feature 时可用)
    #[cfg(feature = "remote-desktop")]
    file_transfer_manager: Arc<FileTransferManager>,
}

#[allow(dead_code)]
impl BusinessMessageHandler {
    /// 创建新的业务消息处理器（无文件传输）
    pub fn new(agent_manager: Arc<AgentManager>) -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            agent_manager,
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
            self_id: Arc::new(tokio::sync::RwLock::new(None)),
            response_tx: None,
            #[cfg(feature = "remote-desktop")]
            file_transfer_manager: Arc::new(FileTransferManager::new()),
        }
    }

    /// 创建新的业务消息处理器（带文件传输）
    #[cfg(feature = "remote-desktop")]
    pub fn new_with_file_transfer(
        agent_manager: Arc<AgentManager>,
        file_transfer_manager: Arc<FileTransferManager>,
    ) -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        Self {
            agent_manager,
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
            self_id: Arc::new(tokio::sync::RwLock::new(None)),
            response_tx: None,
            file_transfer_manager,
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
        let message_type = envelope.type_;

        debug!(
            "Handling business message: id={}, type={:?}",
            message_id, message_type
        );

        match message_type {
            BusinessMessageType::AgentTaskRequest => {
                self.handle_task_request(&envelope).await?;
            }
            BusinessMessageType::TaskCancel => {
                self.handle_task_cancel(&envelope).await?;
            }
            BusinessMessageType::Heartbeat => {
                self.handle_heartbeat(&envelope).await?;
            }
            BusinessMessageType::SystemNotify => {
                self.handle_system_notify(&envelope).await?;
            }
            // 文件传输相关消息
            #[cfg(feature = "remote-desktop")]
            BusinessMessageType::FileTransferRequest => {
                self.handle_file_transfer_request(&envelope).await?;
            }
            #[cfg(feature = "remote-desktop")]
            BusinessMessageType::FileBlock => {
                self.handle_file_block(&envelope).await?;
            }
            #[cfg(feature = "remote-desktop")]
            BusinessMessageType::FileTransferCancel => {
                self.handle_file_transfer_cancel(&envelope).await?;
            }
            #[cfg(feature = "remote-desktop")]
            BusinessMessageType::FileTransferDone => {
                self.handle_file_transfer_done(&envelope).await?;
            }
            #[cfg(feature = "remote-desktop")]
            BusinessMessageType::FileTransferError => {
                self.handle_file_transfer_error(&envelope).await?;
            }
            _ => {
                warn!("Unknown business message type: {:?}", message_type);
            }
        }

        Ok(())
    }

    /// 处理 Agent 任务请求
    async fn handle_task_request(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        let task_id = envelope.message_id.clone();

        // 解析任务
        let task = AgentTask::from_business_message(&BusinessMessage {
            id: envelope.message_id.clone(),
            message_type: MessageType::AgentTaskRequest,
            payload: envelope.payload.clone(),
            timestamp: envelope.timestamp,
            source_id: Some(envelope.source_id.clone()),
            target_id: Some(envelope.target_id.clone()),
        })?;

        // 提交任务
        self.agent_manager
            .submit_task(task)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to submit task {}: {}", task_id, e))?;

        // 发送事件
        drop(self.event_tx.send(BusinessHandlerEvent::TaskReceived {
            message_id: envelope.message_id.clone(),
            task_id,
        }));

        Ok(())
    }

    /// 处理任务取消
    async fn handle_task_cancel(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        let task_id = self.extract_task_id(envelope)?;
        self.agent_manager.cancel_task(&task_id)?;
        info!("Task cancelled via business channel: {}", task_id);
        Ok(())
    }

    /// 处理心跳
    async fn handle_heartbeat(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        let peer_id = &envelope.source_id;
        debug!("Heartbeat received from peer: {}", peer_id);
        // 更新最后活跃时间等
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

    #[cfg(feature = "remote-desktop")]
    async fn handle_file_transfer_request(
        &self,
        envelope: &BusinessEnvelope,
    ) -> anyhow::Result<()> {
        info!(
            "Received file transfer request from {}, payload size: {} bytes",
            envelope.source_id,
            envelope.payload.len()
        );

        use librustdesk::client_api::FileTransferReceiveRequest;

        // 解析文件接收请求
        let request: FileTransferReceiveRequest =
            ProtobufMessage::parse_from_bytes(&envelope.payload)
                .map_err(|e| anyhow::anyhow!("Failed to parse file transfer request: {}", e))?;

        let transfer_id = request.id;
        let remote_path = request.path.clone();
        let files = request.files.clone();
        let total_size = request.total_size;

        info!(
            "File transfer request: id={}, path={}, files={}, total_size={}",
            transfer_id,
            remote_path,
            files.len(),
            total_size
        );

        // 创建接收会话
        let callback = Arc::new(NoopFileTransferCallback);
        self.file_transfer_manager
            .create_receive_session(
                transfer_id,
                files,
                &remote_path,
                &envelope.source_id,
                callback,
            )
            .await
            .map_err(|e| anyhow::anyhow!("Failed to create receive session: {}", e))?;

        // 发送确认响应
        if let Some(ref tx) = self.response_tx {
            let mut confirm = librustdesk::client_api::FileTransferSendConfirmRequest {
                id: transfer_id,
                file_num: 0,
                ..Default::default()
            };
            confirm.set_skip(false);

            let mut confirm_msg = librustdesk::client_api::FileAction::default();
            confirm_msg.set_send_confirm(confirm);

            let mut payload = Vec::new();
            confirm_msg
                .write_to_vec(&mut payload)
                .map_err(|e| anyhow::anyhow!("Failed to serialize confirm: {}", e))?;

            let response = self
                .create_response(
                    &envelope.message_id,
                    BusinessMessageType::FileTransferResponse,
                    payload,
                    &envelope.source_id,
                )
                .await;

            tx.send(response)
                .await
                .map_err(|e| anyhow::anyhow!("Failed to send confirm response: {}", e))?;
        }

        info!("File transfer session created: id={}", transfer_id);
        Ok(())
    }

    #[cfg(feature = "remote-desktop")]
    async fn handle_file_block(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        debug!(
            "Received file block from {}, size: {} bytes",
            envelope.source_id,
            envelope.payload.len()
        );

        use librustdesk::client_api::FileTransferBlock;

        // 解析文件块
        let block: FileTransferBlock = ProtobufMessage::parse_from_bytes(&envelope.payload)
            .map_err(|e| anyhow::anyhow!("Failed to parse file block: {}", e))?;

        let transfer_id = block.id;
        let blk_id = block.blk_id;

        // 查找对应的会话
        if let Some(session) = self.file_transfer_manager.get_session(transfer_id) {
            let s = session.lock().await;
            s.write_block(block)
                .await
                .map_err(|e| anyhow::anyhow!("Failed to write file block: {}", e))?;

            debug!("File block written: id={}, blk_id={}", transfer_id, blk_id);
        } else {
            warn!("No file transfer session found for id={}", transfer_id);
        }

        Ok(())
    }

    #[cfg(feature = "remote-desktop")]
    async fn handle_file_transfer_cancel(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        info!("Received file transfer cancel from {}", envelope.source_id);

        use librustdesk::client_api::FileTransferCancel;

        let cancel: FileTransferCancel = ProtobufMessage::parse_from_bytes(&envelope.payload)
            .map_err(|e| anyhow::anyhow!("Failed to parse cancel message: {}", e))?;

        let transfer_id = cancel.id;

        if let Some(session) = self.file_transfer_manager.remove_session(transfer_id) {
            let mut s = session.lock().await;
            s.cancel().await;
            info!("File transfer cancelled: id={}", transfer_id);
        }

        Ok(())
    }

    #[cfg(feature = "remote-desktop")]
    async fn handle_file_transfer_done(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        info!("Received file transfer done from {}", envelope.source_id);

        use librustdesk::client_api::FileTransferDone;

        let _done: FileTransferDone = ProtobufMessage::parse_from_bytes(&envelope.payload)
            .map_err(|e| anyhow::anyhow!("Failed to parse done message: {}", e))?;

        // 处理完成的传输
        Ok(())
    }

    #[cfg(feature = "remote-desktop")]
    async fn handle_file_transfer_error(&self, envelope: &BusinessEnvelope) -> anyhow::Result<()> {
        #[cfg(feature = "remote-desktop")]
        {
            use librustdesk::client_api::FileTransferError;

            error!("Received file transfer error from {}", envelope.source_id);

            let error: FileTransferError = ProtobufMessage::parse_from_bytes(&envelope.payload)
                .map_err(|e| anyhow::anyhow!("Failed to parse error message: {}", e))?;

            let transfer_id = error.id;
            let error_msg = error.error;

            error!(
                "File transfer error: id={}, error={}",
                transfer_id, error_msg
            );

            // 清理会话
            if let Some(session) = self.file_transfer_manager.remove_session(transfer_id) {
                let mut s = session.lock().await;
                s.cancel().await;
            }
        }

        Ok(())
    }

    /// 将 BusinessEnvelope 转换为 AgentTask
    fn envelope_to_task(&self, envelope: &BusinessEnvelope) -> anyhow::Result<AgentTask> {
        // 尝试从 payload 反序列化 AgentTask
        let task: AgentTask = serde_json::from_slice(&envelope.payload)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize task: {}", e))?;
        Ok(task)
    }

    /// 从 BusinessEnvelope 中提取任务 ID
    fn extract_task_id(&self, envelope: &BusinessEnvelope) -> anyhow::Result<String> {
        // 首先尝试从 payload 中解析任务
        if let Ok(task) = self.envelope_to_task(envelope) {
            return Ok(task.id);
        }

        // 如果解析失败，使用 message_id 作为任务 ID
        Ok(envelope.message_id.clone())
    }

    /// 创建 BusinessMessage（包装为 BusinessEnvelope）
    fn create_message(
        &self,
        type_: MessageType,
        payload: Vec<u8>,
        target_id: &str,
    ) -> BusinessMessage {
        BusinessMessage {
            id: Uuid::new_v4().to_string(),
            message_type: type_,
            payload,
            timestamp: chrono::Utc::now().timestamp_millis(),
            source_id: None,
            target_id: Some(target_id.to_string()),
        }
    }

    /// 创建响应信封
    async fn create_response(
        &self,
        request_id: &str,
        type_: BusinessMessageType,
        payload: Vec<u8>,
        target_id: &str,
    ) -> BusinessEnvelope {
        let self_id = self.self_id.read().await;
        BusinessEnvelope {
            message_id: request_id.to_string(),
            type_,
            payload,
            timestamp: chrono::Utc::now().timestamp_millis(),
            source_id: self_id.clone().unwrap_or_default(),
            target_id: target_id.to_string(),
        }
    }

    /// 内部消息类型转换为 protobuf 消息类型
    fn message_type_to_business_type(msg_type: MessageType) -> BusinessMessageType {
        match msg_type {
            MessageType::AgentTaskRequest => BusinessMessageType::AgentTaskRequest,
            MessageType::AgentTaskResponse => BusinessMessageType::AgentTaskResponse,
            MessageType::TaskProgress => BusinessMessageType::TaskProgress,
            MessageType::TaskCancel => BusinessMessageType::TaskCancel,
            MessageType::FileTransferRequest => BusinessMessageType::FileTransferRequest,
            MessageType::FileTransferResponse => BusinessMessageType::FileTransferResponse,
            MessageType::FileBlock => BusinessMessageType::FileBlock,
            MessageType::FileTransferCancel => BusinessMessageType::FileTransferCancel,
            MessageType::FileTransferDone => BusinessMessageType::FileTransferDone,
            MessageType::FileTransferError => BusinessMessageType::FileTransferError,
            MessageType::Heartbeat => BusinessMessageType::Heartbeat,
            MessageType::SystemNotify => BusinessMessageType::SystemNotify,
            MessageType::Custom => BusinessMessageType::BusinessUnknown,
        }
    }

    /// protobuf 消息类型转换为内部消息类型
    fn business_type_to_message_type(biz_type: BusinessMessageType) -> MessageType {
        match biz_type {
            BusinessMessageType::AgentTaskRequest => MessageType::AgentTaskRequest,
            BusinessMessageType::AgentTaskResponse => MessageType::AgentTaskResponse,
            BusinessMessageType::TaskProgress => MessageType::TaskProgress,
            BusinessMessageType::TaskCancel => MessageType::TaskCancel,
            BusinessMessageType::FileTransferRequest => MessageType::FileTransferRequest,
            BusinessMessageType::FileTransferResponse => MessageType::FileTransferResponse,
            BusinessMessageType::FileBlock => MessageType::FileBlock,
            BusinessMessageType::FileTransferCancel => MessageType::FileTransferCancel,
            BusinessMessageType::FileTransferDone => MessageType::FileTransferDone,
            BusinessMessageType::FileTransferError => MessageType::FileTransferError,
            BusinessMessageType::Heartbeat => MessageType::Heartbeat,
            BusinessMessageType::SystemNotify => MessageType::SystemNotify,
            BusinessMessageType::BusinessCustom => MessageType::Custom,
            BusinessMessageType::BusinessUnknown => MessageType::Custom,
        }
    }
}

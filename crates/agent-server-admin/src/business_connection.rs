//! 业务通道连接
//!
//! 封装 P2P/Relay 连接，专门用于业务消息传输
//! 不涉及远程桌面功能（视频、音频、输入等）

use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info, warn};

use librustdesk::client_api::{
    handle_hash, handle_login_error, handle_login_from_ui, handle_test_delay, Data, Interface,
    LoginConfigHandler,
};
use librustdesk::hbb_common::message_proto::{
    message::Union as MessageUnion, BusinessMessage, FileEntry, FileTransferBlock,
    FileTransferCancel, FileTransferSendConfirmRequest, FileTransferSendRequest, Hash, Message,
    PeerInfo, TestDelay, WindowsSession,
};
use librustdesk::hbb_common::protobuf::Message as ProtobufMessage;
use librustdesk::hbb_common::rendezvous_proto::ConnType;
use librustdesk::hbb_common::Stream;

use nuwax_agent_core::business_channel::{BusinessEnvelope, BusinessMessageType};

/// 生成唯一的传输 ID
static NEXT_TRANSFER_ID: AtomicI32 = AtomicI32::new(1);

/// 获取下一个传输 ID
fn get_next_transfer_id() -> i32 {
    NEXT_TRANSFER_ID.fetch_add(1, Ordering::SeqCst)
}

/// 业务连接状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BusinessConnectionState {
    /// 断开
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接
    Connected,
    /// 认证中
    Authenticating,
    /// 已认证
    Authenticated,
    /// 错误
    Error(String),
}

/// 业务连接事件
#[derive(Debug, Clone)]
pub enum BusinessConnectionEvent {
    /// 连接成功
    Connected { peer_id: String },
    /// 已认证
    Authenticated { peer_id: String },
    /// 收到业务消息
    MessageReceived { envelope: BusinessEnvelope },
    /// 连接断开
    Disconnected { peer_id: String, reason: String },
    /// 错误
    Error { peer_id: String, message: String },
}

/// 业务连接
///
/// 封装与单个 peer 的业务消息通道
pub struct BusinessConnection {
    /// 目标 peer ID
    peer_id: String,
    /// 连接密码
    password: Option<String>,
    /// 连接状态
    state: Arc<RwLock<BusinessConnectionState>>,
    /// 事件发送通道
    event_tx: mpsc::Sender<BusinessConnectionEvent>,
    /// 底层流（建立后设置）
    stream: Arc<RwLock<Option<Stream>>>,
    /// 是否直连
    is_direct: Arc<RwLock<bool>>,
}

impl BusinessConnection {
    /// 创建新的业务连接
    pub fn new(
        peer_id: &str,
        password: Option<String>,
        event_tx: mpsc::Sender<BusinessConnectionEvent>,
    ) -> Self {
        Self {
            peer_id: peer_id.to_string(),
            password,
            state: Arc::new(RwLock::new(BusinessConnectionState::Disconnected)),
            event_tx,
            stream: Arc::new(RwLock::new(None)),
            is_direct: Arc::new(RwLock::new(false)),
        }
    }

    /// 获取 peer ID
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    /// 获取当前状态
    pub async fn state(&self) -> BusinessConnectionState {
        self.state.read().await.clone()
    }

    /// 是否已连接
    pub async fn is_connected(&self) -> bool {
        matches!(
            *self.state.read().await,
            BusinessConnectionState::Connected | BusinessConnectionState::Authenticated
        )
    }

    /// 是否直连
    pub async fn is_direct(&self) -> bool {
        *self.is_direct.read().await
    }

    /// 设置底层流
    pub async fn set_stream(&self, stream: Stream, is_direct: bool) {
        *self.stream.write().await = Some(stream);
        *self.is_direct.write().await = is_direct;
        *self.state.write().await = BusinessConnectionState::Connected;

        let _ = self
            .event_tx
            .send(BusinessConnectionEvent::Connected {
                peer_id: self.peer_id.clone(),
            })
            .await;
    }

    /// 发送业务消息
    pub async fn send_message(&self, envelope: BusinessEnvelope) -> anyhow::Result<()> {
        let mut stream_guard = self.stream.write().await;
        let stream = stream_guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Not connected"))?;

        // 构建 RustDesk Message
        let mut msg = Message::new();
        let business_msg = BusinessMessage {
            message_id: envelope.message_id.clone(),
            type_: envelope.type_.into(),
            payload: envelope.payload.clone().into(),
            timestamp: envelope.timestamp,
            source_id: envelope.source_id.clone(),
            target_id: envelope.target_id.clone(),
            ..Default::default()
        };
        msg.union = Some(MessageUnion::BusinessMessage(business_msg));

        // 序列化并发送
        let msg_bytes = msg.write_to_bytes()?;
        stream.send_bytes(msg_bytes.into()).await?;

        debug!(
            "Sent business message to {}: type={:?}, id={}",
            self.peer_id, envelope.type_, envelope.message_id
        );

        Ok(())
    }

    /// 创建业务消息信封
    pub fn create_envelope(
        message_type: BusinessMessageType,
        payload: Vec<u8>,
        source_id: &str,
        target_id: &str,
    ) -> BusinessEnvelope {
        let mut envelope = BusinessEnvelope::new();
        envelope.message_id = uuid::Uuid::new_v4().to_string();
        envelope.type_ = message_type;
        envelope.payload = payload;
        envelope.timestamp = chrono::Utc::now().timestamp_millis();
        envelope.source_id = source_id.to_string();
        envelope.target_id = target_id.to_string();
        envelope
    }

    /// 启动消息接收循环
    ///
    /// 返回一个任务句柄，持续从流中读取消息并通过事件通道发送
    pub fn spawn_receive_loop(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        let peer_id = self.peer_id.clone();
        let event_tx = self.event_tx.clone();
        let stream = self.stream.clone();
        let state = self.state.clone();

        tokio::spawn(async move {
            if let Err(e) = tokio::panic::catch_unwind(|| {
                futures::executor::block_on(async {
                    Self::receive_loop_inner(&peer_id, &event_tx, &stream, &state).await;
                })
            }).await {
                error!("Receive loop for {} panicked: {:?}", peer_id, e);
            }
        })
    }

    async fn receive_loop_inner(
        peer_id: &str,
        event_tx: &mpsc::Sender<BusinessConnectionEvent>,
        stream: &Arc<RwLock<Option<Stream>>>,
        state: &Arc<RwLock<BusinessConnectionState>>,
    ) {
        info!("Starting receive loop for {}", peer_id);

        loop {
            // 获取流
            let mut stream_guard = stream.write().await;
            let stream_ref = match stream_guard.as_mut() {
                Some(s) => s,
                None => {
                    warn!("Stream not available for {}", peer_id);
                    break;
                }
            };

            // 读取下一条消息
            match stream_ref.next().await {
                Some(Ok(bytes)) => {
                    drop(stream_guard); // 释放锁

                    // 解析消息
                    match Message::parse_from_bytes(&bytes) {
                        Ok(msg) => {
                            if let Some(MessageUnion::BusinessMessage(business_msg)) = msg.union
                            {
                                // 转换为 BusinessEnvelope
                                let envelope = BusinessEnvelope {
                                    message_id: business_msg.message_id,
                                    type_: BusinessMessageType::from(business_msg.type_),
                                    payload: business_msg.payload.to_vec(),
                                    timestamp: business_msg.timestamp,
                                    source_id: business_msg.source_id,
                                    target_id: business_msg.target_id,
                                };
                                debug!(
                                    "Received business message from {}: type={:?}",
                                    peer_id, envelope.type_
                                );
                                let _ = event_tx
                                    .send(BusinessConnectionEvent::MessageReceived { envelope })
                                    .await;
                            }
                            // 忽略非业务消息
                        }
                        Err(e) => {
                            warn!("Failed to parse message from {}: {}", peer_id, e);
                        }
                    }
                }
                Some(Err(e)) => {
                    error!("Error reading from {}: {}", peer_id, e);
                    *state.write().await = BusinessConnectionState::Error(e.to_string());
                    let _ = event_tx
                        .send(BusinessConnectionEvent::Error {
                            peer_id: peer_id.to_string(),
                            message: e.to_string(),
                        })
                        .await;
                    break;
                }
                None => {
                    info!("Connection closed for {}", peer_id);
                    *state.write().await = BusinessConnectionState::Disconnected;
                    let _ = event_tx
                        .send(BusinessConnectionEvent::Disconnected {
                            peer_id: peer_id.to_string(),
                            reason: "Stream closed".to_string(),
                        })
                        .await;
                    break;
                }
            }
        }

        info!("Receive loop ended for {}", peer_id);
    }

    /// 关闭连接
    pub async fn close(&self) {
        *self.stream.write().await = None;
        *self.state.write().await = BusinessConnectionState::Disconnected;
        let _ = self
            .event_tx
            .send(BusinessConnectionEvent::Disconnected {
                peer_id: self.peer_id.clone(),
                reason: "Closed by user".to_string(),
            })
            .await;
    }

    // ============================================================================
    // 文件传输相关方法
    // ============================================================================

    /// 发送文件到远程端
    ///
    /// # 参数
    /// - `files`: 要发送的文件路径列表
    /// - `remote_path`: 远程保存路径
    ///
    /// # 返回
    /// 传输任务 ID
    pub async fn send_file(&self, files: Vec<PathBuf>, remote_path: &str) -> anyhow::Result<i32> {
        let transfer_id = get_next_transfer_id();

        // 构建文件列表
        let mut file_entries = Vec::new();
        for path in &files {
            if !path.exists() {
                return Err(anyhow::anyhow!("File not found: {:?}", path));
            }
            if let Ok(meta) = std::fs::metadata(path) {
                let entry = FileEntry {
                    name: path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    size: meta.len(),
                    ..Default::default()
                };
                file_entries.push(entry);
            }
        }

        // 构建文件传输请求
        let mut request = FileTransferSendRequest::default();
        request.id = transfer_id;
        request.path = remote_path.to_string();
        request.include_hidden = false;
        request.file_num = file_entries.len() as i32;

        // 序列化请求
        let mut payload = Vec::new();
        request
            .write_to_vec(&mut payload)
            .map_err(|e| anyhow::anyhow!("Failed to serialize request: {}", e))?;

        // 发送请求
        let envelope = Self::create_envelope(
            BusinessMessageType::FileTransferRequest,
            payload,
            &self.peer_id, // source is actually this side
            &self.peer_id, // target will be set by connection layer
        );

        self.send_message(envelope).await?;

        info!(
            "File transfer initiated: id={}, files={}",
            transfer_id,
            files.len()
        );
        Ok(transfer_id)
    }

    /// 处理接收到的文件块
    pub async fn handle_file_block(&self, block: FileTransferBlock) -> anyhow::Result<()> {
        info!(
            "Received file block: id={}, file_num={}, size={}",
            block.id,
            block.file_num,
            block.data.len()
        );

        // 将文件块发送到远程端
        let mut payload = Vec::new();
        block
            .write_to_vec(&mut payload)
            .map_err(|e| anyhow::anyhow!("Failed to serialize block: {}", e))?;

        let envelope =
            Self::create_envelope(BusinessMessageType::FileBlock, payload, "", &self.peer_id);

        self.send_message(envelope).await?;
        Ok(())
    }

    /// 取消文件传输
    pub async fn cancel_file_transfer(&self, transfer_id: i32) -> anyhow::Result<()> {
        let mut cancel = FileTransferCancel::default();
        cancel.id = transfer_id;

        let mut payload = Vec::new();
        cancel.write_to_vec(&mut payload)?;

        let envelope = Self::create_envelope(
            BusinessMessageType::FileTransferCancel,
            payload,
            "",
            &self.peer_id,
        );

        self.send_message(envelope).await?;
        info!("File transfer cancelled: id={}", transfer_id);
        Ok(())
    }

    /// 确认文件传输（响应 FILE_TRANSFER_REQUEST）
    pub async fn confirm_file_transfer(
        &self,
        transfer_id: i32,
        file_num: i32,
        skip: bool,
        offset_blk: Option<u32>,
    ) -> anyhow::Result<()> {
        let mut confirm = FileTransferSendConfirmRequest::default();
        confirm.id = transfer_id;
        confirm.file_num = file_num;

        if skip {
            confirm.set_skip(true);
        } else if let Some(offset) = offset_blk {
            confirm.set_offset_blk(offset);
        }

        let mut payload = Vec::new();
        confirm.write_to_vec(&mut payload)?;

        let envelope = Self::create_envelope(
            BusinessMessageType::FileTransferResponse,
            payload,
            "",
            &self.peer_id,
        );

        self.send_message(envelope).await?;
        info!(
            "File transfer confirmed: id={}, file_num={}",
            transfer_id, file_num
        );
        Ok(())
    }
}

// ============================================================================
// BusinessInterface - 实现 Interface trait 用于 P2P 连接
// ============================================================================

/// 业务连接接口
///
/// 实现 librustdesk Interface trait，用于建立 P2P 连接。
/// 这是一个最小化实现，只处理认证相关的回调，忽略远程桌面功能。
#[derive(Clone)]
pub struct BusinessInterface {
    /// 目标 peer ID
    peer_id: String,
    /// 连接密码
    password: String,
    /// 登录配置处理器
    lc: Arc<std::sync::RwLock<LoginConfigHandler>>,
    /// 数据发送通道
    sender: mpsc::UnboundedSender<Data>,
    /// 事件发送通道
    event_tx: mpsc::Sender<BusinessConnectionEvent>,
}

impl BusinessInterface {
    /// 创建新的业务连接接口
    pub fn new(
        peer_id: &str,
        password: Option<String>,
        event_tx: mpsc::Sender<BusinessConnectionEvent>,
    ) -> (Self, mpsc::UnboundedReceiver<Data>) {
        let (sender, receiver) = mpsc::unbounded_channel();

        // 初始化 LoginConfigHandler
        let lc = Arc::new(std::sync::RwLock::new(LoginConfigHandler::default()));
        lc.write().unwrap().initialize(
            peer_id.to_string(),
            ConnType::DEFAULT_CONN, // 使用默认连接类型
            None,                   // switch_uuid
            false,                  // force_relay
            None,                   // adapter_luid
            None,                   // shared_password
            None,                   // conn_token
        );

        let interface = Self {
            peer_id: peer_id.to_string(),
            password: password.unwrap_or_default(),
            lc,
            sender,
            event_tx,
        };

        (interface, receiver)
    }

    /// 获取 peer ID
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }
}

#[async_trait]
impl Interface for BusinessInterface {
    fn get_lch(&self) -> Arc<std::sync::RwLock<LoginConfigHandler>> {
        self.lc.clone()
    }

    fn send(&self, data: Data) {
        let _ = self.sender.send(data);
    }

    fn msgbox(&self, msgtype: &str, title: &str, text: &str, _link: &str) {
        match msgtype {
            "input-password" => {
                // 自动发送密码进行认证
                // Data::Login 参数顺序: (os_username, os_password, password, remember)
                debug!("Auto-sending password for {}", self.peer_id);
                self.sender
                    .send(Data::Login((
                        String::new(),         // os_username
                        String::new(),         // os_password
                        self.password.clone(), // password
                        true,                  // remember
                    )))
                    .ok();
            }
            "re-input-password" => {
                // 密码错误，重试
                warn!("Password error for {}: {} - {}", self.peer_id, title, text);
                // 发送错误事件（带 panic 捕获）
                let event_tx = self.event_tx.clone();
                let peer_id = self.peer_id.clone();
                let message = format!("{}: {}", title, text);
                tokio::spawn(async move {
                    if let Err(e) = event_tx
                        .send(BusinessConnectionEvent::Error { peer_id, message })
                        .await
                    {
                        error!("Failed to send error event: {}", e);
                    }
                });
            }
            msg if msg.contains("error") => {
                error!(
                    "Connection error for {}: {} - {}",
                    self.peer_id, title, text
                );
                // 发送错误事件（带 panic 捕获）
                let event_tx = self.event_tx.clone();
                let peer_id = self.peer_id.clone();
                let message = format!("{}: {}", title, text);
                tokio::spawn(async move {
                    if let Err(e) = event_tx
                        .send(BusinessConnectionEvent::Error { peer_id, message })
                        .await
                    {
                        error!("Failed to send error event: {}", e);
                    }
                });
            }
            _ => {
                debug!(
                    "Message for {}: [{}] {} - {}",
                    self.peer_id, msgtype, title, text
                );
            }
        }
    }

    fn handle_login_error(&self, err: &str) -> bool {
        handle_login_error(self.lc.clone(), err, self)
    }

    fn handle_peer_info(&self, pi: PeerInfo) {
        debug!(
            "Received peer info from {}: {:?}",
            self.peer_id, pi.username
        );
        self.lc.write().unwrap().handle_peer_info(&pi);

        // 发送认证成功事件（带 panic 捕获）
        let event_tx = self.event_tx.clone();
        let peer_id = self.peer_id.clone();
        tokio::spawn(async move {
            if let Err(e) = event_tx
                .send(BusinessConnectionEvent::Authenticated { peer_id })
                .await
            {
                error!("Failed to send Authenticated event: {}", e);
            }
        });
    }

    fn set_multiple_windows_session(&self, _sessions: Vec<WindowsSession>) {
        // 业务连接不需要处理多窗口会话
    }

    async fn handle_hash(&self, pass: &str, hash: Hash, peer: &mut Stream) {
        handle_hash(self.lc.clone(), pass, hash, self, peer).await;
    }

    async fn handle_login_from_ui(
        &self,
        os_username: String,
        os_password: String,
        password: String,
        remember: bool,
        peer: &mut Stream,
    ) {
        handle_login_from_ui(
            self.lc.clone(),
            os_username,
            os_password,
            password,
            remember,
            peer,
        )
        .await;
    }

    async fn handle_test_delay(&self, t: TestDelay, peer: &mut Stream) {
        handle_test_delay(t, peer).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_envelope() {
        let envelope = BusinessConnection::create_envelope(
            BusinessMessageType::AgentTaskRequest,
            b"test".to_vec(),
            "admin-1",
            "client-1",
        );

        assert!(!envelope.message_id.is_empty());
        assert_eq!(
            envelope.type_ as i32,
            BusinessMessageType::AgentTaskRequest as i32
        );
        assert_eq!(envelope.payload.as_slice(), b"test");
        assert_eq!(envelope.source_id, "admin-1");
        assert_eq!(envelope.target_id, "client-1");
    }

    #[tokio::test]
    async fn test_connection_state() {
        let (tx, _rx) = mpsc::channel(16);
        let conn = BusinessConnection::new("test-peer", None, tx);

        assert!(!conn.is_connected().await);
        assert_eq!(conn.state().await, BusinessConnectionState::Disconnected);
    }
}

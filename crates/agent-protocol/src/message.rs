//! 协议消息定义
//!
//! 包含所有通信消息的定义

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 消息 ID 类型
pub type MessageId = String;

/// 客户端 ID 类型
pub type ClientId = String;

/// 消息头
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageHeader {
    /// 消息 ID
    pub id: MessageId,
    /// 发送时间
    pub timestamp: DateTime<Utc>,
    /// 协议版本
    pub version: String,
    /// 消息类型
    pub msg_type: MessageType,
}

impl MessageHeader {
    pub fn new(msg_type: MessageType) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            version: crate::PROTOCOL_VERSION.to_string(),
            msg_type,
        }
    }
}

/// 消息类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u16)]
pub enum MessageType {
    // 握手消息 100-199
    HandshakeRequest = 100,
    HandshakeResponse = 101,
    HeartbeatPing = 102,
    HeartbeatPong = 103,

    // Agent 任务消息 200-299
    AgentTaskRequest = 200,
    AgentTaskResponse = 201,
    AgentTaskOutput = 202,
    AgentTaskCancel = 203,

    // 文件传输消息 300-399
    FileTransferRequest = 300,
    FileTransferChunk = 301,
    FileTransferComplete = 302,

    // 远程桌面消息 400-499
    ScreenCaptureRequest = 400,
    ScreenCaptureFrame = 401,
    InputEvent = 402,

    // 管理消息 500-599
    UpdatePasswordRequest = 500,
    UpdatePasswordResponse = 501,
}

/// 握手请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeRequest {
    /// 客户端版本
    pub client_version: String,
    /// 协议版本
    pub protocol_version: String,
    /// 操作系统
    pub os: String,
    /// 架构
    pub arch: String,
    /// 主机名
    pub hostname: String,
}

/// 握手响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeResponse {
    /// 是否成功
    pub success: bool,
    /// 分配的客户端 ID
    pub client_id: Option<ClientId>,
    /// 连接模式
    pub connection_mode: Option<ConnectionMode>,
    /// 错误信息
    pub error: Option<String>,
}

/// 连接模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionMode {
    /// P2P 直连
    P2P,
    /// 中继模式
    Relay,
}

/// 心跳请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatPing {
    /// 客户端 ID
    pub client_id: ClientId,
    /// 发送时间戳（用于计算延迟）
    pub timestamp: i64,
}

/// 心跳响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatPong {
    /// 原始时间戳
    pub echo_timestamp: i64,
    /// 服务器时间戳
    pub server_timestamp: i64,
}

/// Agent 任务请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskRequest {
    /// 任务 ID
    pub task_id: String,
    /// 会话 ID
    pub session_id: String,
    /// Prompt 内容
    pub prompt: String,
    /// 附件列表
    pub attachments: Vec<Attachment>,
}

/// 附件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    /// 文件名
    pub filename: String,
    /// MIME 类型
    pub mime_type: String,
    /// 文件内容（Base64 编码）
    pub content: String,
}

/// Agent 任务输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskOutput {
    /// 任务 ID
    pub task_id: String,
    /// 输出类型
    pub output_type: OutputType,
    /// 输出内容
    pub content: String,
    /// 是否完成
    pub is_final: bool,
}

/// 输出类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OutputType {
    /// 文本输出
    Text,
    /// 代码输出
    Code,
    /// 错误输出
    Error,
    /// 进度更新
    Progress,
}

/// Agent 任务取消
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskCancel {
    /// 任务 ID
    pub task_id: String,
    /// 取消原因
    pub reason: Option<String>,
}

/// 协议消息包装器 - 统一消息格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolMessage {
    /// 消息头
    pub header: MessageHeader,
    /// 消息体 (JSON 序列化的内容)
    pub payload: serde_json::Value,
}

impl ProtocolMessage {
    /// 创建新的协议消息
    pub fn new<T: Serialize>(
        msg_type: MessageType,
        payload: &T,
    ) -> Result<Self, serde_json::Error> {
        Ok(Self {
            header: MessageHeader::new(msg_type),
            payload: serde_json::to_value(payload)?,
        })
    }

    /// 解析消息体
    pub fn parse_payload<T: for<'de> Deserialize<'de>>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_value(self.payload.clone())
    }

    /// 序列化为 JSON
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// 从 JSON 反序列化
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// 序列化为字节
    pub fn to_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }

    /// 从字节反序列化
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_header() {
        let header = MessageHeader::new(MessageType::HeartbeatPing);
        assert!(!header.id.is_empty());
        assert_eq!(header.msg_type, MessageType::HeartbeatPing);
    }

    #[test]
    fn test_protocol_message_roundtrip() {
        let ping = HeartbeatPing {
            client_id: "test-client".to_string(),
            timestamp: 12345,
        };

        let msg = ProtocolMessage::new(MessageType::HeartbeatPing, &ping).unwrap();
        let json = msg.to_json().unwrap();
        let restored = ProtocolMessage::from_json(&json).unwrap();

        assert_eq!(msg.header.msg_type, restored.header.msg_type);

        let restored_ping: HeartbeatPing = restored.parse_payload().unwrap();
        assert_eq!(ping.client_id, restored_ping.client_id);
        assert_eq!(ping.timestamp, restored_ping.timestamp);
    }

    #[test]
    fn test_handshake_request() {
        let req = HandshakeRequest {
            client_version: "1.0.0".to_string(),
            protocol_version: "1.0.0".to_string(),
            os: "macos".to_string(),
            arch: "aarch64".to_string(),
            hostname: "test-host".to_string(),
        };

        let msg = ProtocolMessage::new(MessageType::HandshakeRequest, &req).unwrap();
        assert_eq!(msg.header.msg_type, MessageType::HandshakeRequest);

        let bytes = msg.to_bytes().unwrap();
        let restored = ProtocolMessage::from_bytes(&bytes).unwrap();
        let restored_req: HandshakeRequest = restored.parse_payload().unwrap();

        assert_eq!(req.client_version, restored_req.client_version);
        assert_eq!(req.hostname, restored_req.hostname);
    }
}

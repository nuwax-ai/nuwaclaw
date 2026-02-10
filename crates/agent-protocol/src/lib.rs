//! Agent Protocol - 通信协议定义
//!
//! 定义 agent-client、agent-server-admin、data-server 之间的通信消息格式

pub mod error;
pub mod message;
pub mod version;

// 导出版本相关类型
pub use version::{VersionError, VersionNegotiator, MIN_SUPPORTED_VERSION, PROTOCOL_VERSION};

// 导出错误类型
pub use error::ProtocolError;

// 导出消息类型
pub use message::{
    AgentTaskCancel, AgentTaskOutput, AgentTaskRequest, Attachment, ClientId, ConnectionMode,
    HandshakeRequest, HandshakeResponse, HeartbeatPing, HeartbeatPong, MessageHeader, MessageId,
    MessageType, OutputType, ProtocolMessage,
};

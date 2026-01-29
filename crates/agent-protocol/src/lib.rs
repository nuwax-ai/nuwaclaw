//! Agent Protocol - 通信协议定义
//!
//! 定义 agent-client、agent-server-admin、data-server 之间的通信消息格式

pub mod version;
pub mod message;
pub mod error;

// 导出版本相关类型
pub use version::{VersionNegotiator, VersionError, PROTOCOL_VERSION, MIN_SUPPORTED_VERSION};

// 导出错误类型
pub use error::ProtocolError;

// 导出消息类型
pub use message::{
    MessageHeader, MessageType, MessageId, ClientId,
    ProtocolMessage,
    HandshakeRequest, HandshakeResponse, ConnectionMode,
    HeartbeatPing, HeartbeatPong,
    AgentTaskRequest, AgentTaskOutput, AgentTaskCancel,
    Attachment, OutputType,
};

//! 协议错误定义

use thiserror::Error;

/// 协议错误
#[derive(Error, Debug)]
pub enum ProtocolError {
    #[error("序列化错误: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("版本不兼容: {0}")]
    VersionMismatch(String),

    #[error("消息格式错误: {0}")]
    InvalidMessage(String),

    #[error("连接错误: {0}")]
    Connection(String),

    #[error("超时")]
    Timeout,

    #[error("未知错误: {0}")]
    Unknown(String),
}

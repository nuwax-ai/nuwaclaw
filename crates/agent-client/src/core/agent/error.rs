//! Agent 错误定义

use thiserror::Error;

/// Agent 错误
#[derive(Error, Debug)]
pub enum AgentError {
    #[error("任务不存在: {0}")]
    TaskNotFound(String),
    #[error("任务已在运行: {0}")]
    TaskAlreadyRunning(String),
    #[error("任务执行失败: {0}")]
    ExecutionFailed(String),
    #[error("任务已被取消")]
    TaskCancelled,
    #[error("消息转换失败: {0}")]
    ConversionFailed(String),
    #[error("通道错误: {0}")]
    ChannelError(String),
    #[error("达到最大并发任务数: {0}")]
    MaxConcurrencyReached(usize),
}

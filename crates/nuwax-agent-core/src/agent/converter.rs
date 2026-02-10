//! 消息转换工具

use serde::{Deserialize, Serialize};

use crate::business_channel::{BusinessMessage, MessageType};

use super::error::AgentError;
use super::task::{AgentTask, TaskProgress, TaskResult};

/// 取消请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelRequest {
    pub task_id: String,
}

/// 消息转换工具
pub struct MessageConverter;

impl MessageConverter {
    /// 将 AgentTask 转换为 BusinessMessage
    pub fn task_to_message(task: &AgentTask) -> Result<BusinessMessage, AgentError> {
        task.to_business_message()
    }

    /// 将 BusinessMessage 转换为 AgentTask
    pub fn message_to_task(message: &BusinessMessage) -> Result<AgentTask, AgentError> {
        AgentTask::from_business_message(message)
    }

    /// 将 TaskProgress 转换为 BusinessMessage
    pub fn progress_to_message(progress: &TaskProgress) -> Result<BusinessMessage, AgentError> {
        progress.to_business_message()
    }

    /// 将 TaskResult 转换为 BusinessMessage
    pub fn result_to_message(result: &TaskResult) -> Result<BusinessMessage, AgentError> {
        result.to_business_message()
    }

    /// 从 BusinessMessage 解析 TaskProgress
    pub fn message_to_progress(message: &BusinessMessage) -> Result<TaskProgress, AgentError> {
        serde_json::from_slice(&message.payload)
            .map_err(|e| AgentError::ConversionFailed(format!("解析进度失败: {}", e)))
    }

    /// 从 BusinessMessage 解析 TaskResult
    pub fn message_to_result(message: &BusinessMessage) -> Result<TaskResult, AgentError> {
        serde_json::from_slice(&message.payload)
            .map_err(|e| AgentError::ConversionFailed(format!("解析结果失败: {}", e)))
    }

    /// 创建取消请求消息
    pub fn cancel_to_message(task_id: &str) -> Result<BusinessMessage, AgentError> {
        let req = CancelRequest {
            task_id: task_id.to_string(),
        };
        let payload =
            serde_json::to_vec(&req).map_err(|e| AgentError::ConversionFailed(e.to_string()))?;
        Ok(BusinessMessage::new(MessageType::TaskCancel, payload))
    }
}

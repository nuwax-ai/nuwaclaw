//! 任务相关数据结构

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::business_channel::{BusinessMessage, MessageType};

use super::error::AgentError;

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    /// 等待执行
    Pending,
    /// 正在执行
    Running,
    /// 已完成
    Completed,
    /// 执行失败
    Failed,
    /// 已取消
    Cancelled,
}

impl TaskStatus {
    /// 是否为终态
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

/// 任务优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
pub enum TaskPriority {
    Low = 0,
    #[default]
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// Agent 任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    /// 任务 ID
    pub id: String,
    /// 任务类型
    pub task_type: String,
    /// 任务负载（JSON 序列化的参数）
    pub payload: Vec<u8>,
    /// 优先级
    pub priority: TaskPriority,
    /// 来源（admin 的 ID）
    pub source_id: String,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 超时时间（毫秒）
    pub timeout_ms: Option<u64>,
}

impl AgentTask {
    /// 创建新任务
    pub fn new(
        task_type: impl Into<String>,
        payload: Vec<u8>,
        source_id: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            task_type: task_type.into(),
            payload,
            priority: TaskPriority::default(),
            source_id: source_id.into(),
            created_at: Utc::now(),
            timeout_ms: None,
        }
    }

    /// 设置优先级
    pub fn with_priority(mut self, priority: TaskPriority) -> Self {
        self.priority = priority;
        self
    }

    /// 设置超时
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }

    /// 从 BusinessMessage 转换
    pub fn from_business_message(message: &BusinessMessage) -> Result<Self, AgentError> {
        serde_json::from_slice(&message.payload)
            .map_err(|e| AgentError::ConversionFailed(format!("反序列化 AgentTask 失败: {}", e)))
    }

    /// 转换为 BusinessMessage
    pub fn to_business_message(&self) -> Result<BusinessMessage, AgentError> {
        let payload = serde_json::to_vec(self)
            .map_err(|e| AgentError::ConversionFailed(format!("序列化 AgentTask 失败: {}", e)))?;
        let mut msg = BusinessMessage::new(MessageType::AgentTaskRequest, payload);
        msg.target_id = Some(self.source_id.clone());
        Ok(msg)
    }
}

/// 任务进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgress {
    /// 任务 ID
    pub task_id: String,
    /// 进度百分比 (0-100)
    pub percentage: u8,
    /// 进度描述
    pub message: String,
    /// 阶段名称
    pub stage: Option<String>,
    /// 时间戳
    pub timestamp: DateTime<Utc>,
}

impl TaskProgress {
    /// 创建进度更新
    pub fn new(task_id: impl Into<String>, percentage: u8, message: impl Into<String>) -> Self {
        Self {
            task_id: task_id.into(),
            percentage: percentage.min(100),
            message: message.into(),
            stage: None,
            timestamp: Utc::now(),
        }
    }

    /// 设置阶段
    pub fn with_stage(mut self, stage: impl Into<String>) -> Self {
        self.stage = Some(stage.into());
        self
    }

    /// 转换为 BusinessMessage
    pub fn to_business_message(&self) -> Result<BusinessMessage, AgentError> {
        let payload = serde_json::to_vec(self)
            .map_err(|e| AgentError::ConversionFailed(format!("序列化进度失败: {}", e)))?;
        Ok(BusinessMessage::new(MessageType::TaskProgress, payload))
    }
}

/// 任务结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    /// 任务 ID
    pub task_id: String,
    /// 是否成功
    pub success: bool,
    /// 结果数据
    pub data: Option<Vec<u8>>,
    /// 错误信息
    pub error: Option<String>,
    /// 完成时间
    pub completed_at: DateTime<Utc>,
    /// 执行耗时（毫秒）
    pub duration_ms: u64,
}

impl TaskResult {
    /// 创建成功结果
    pub fn success(task_id: impl Into<String>, data: Option<Vec<u8>>, duration_ms: u64) -> Self {
        Self {
            task_id: task_id.into(),
            success: true,
            data,
            error: None,
            completed_at: Utc::now(),
            duration_ms,
        }
    }

    /// 创建失败结果
    pub fn failure(task_id: impl Into<String>, error: impl Into<String>, duration_ms: u64) -> Self {
        Self {
            task_id: task_id.into(),
            success: false,
            data: None,
            error: Some(error.into()),
            completed_at: Utc::now(),
            duration_ms,
        }
    }

    /// 转换为 BusinessMessage
    pub fn to_business_message(&self) -> Result<BusinessMessage, AgentError> {
        let payload = serde_json::to_vec(self)
            .map_err(|e| AgentError::ConversionFailed(format!("序列化结果失败: {}", e)))?;
        Ok(BusinessMessage::new(
            MessageType::AgentTaskResponse,
            payload,
        ))
    }
}

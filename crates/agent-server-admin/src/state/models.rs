//! 数据模型
//!
//! 任务、客户端、Agent 状态等数据结构定义

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ============================================================================
// 任务管理相关结构体（对齐 rcoder gRPC 接口）
// ============================================================================

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// 已创建，等待发送到 client
    Pending,
    /// 已发送到 client
    Sent,
    /// client 确认执行中
    Running,
    /// 执行完成
    Completed,
    /// 执行失败
    Failed,
    /// 已取消
    Cancelled,
}

impl TaskStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled
        )
    }
}

/// 任务信息（对齐 rcoder ChatRequest 核心字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskInfo {
    /// 任务 ID（对应 request_id）
    pub task_id: String,
    /// 目标 agent-client ID
    pub client_id: String,
    /// 项目 ID（对应 rcoder project_id）
    pub project_id: String,
    /// 会话 ID（对应 rcoder session_id，支持会话复用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// 用户输入 prompt
    pub prompt: String,
    /// 服务类型："RCoder" | "ComputerAgentRunner"
    #[serde(default = "default_service_type")]
    pub service_type: String,
    /// 模型配置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_config: Option<serde_json::Value>,
    /// 附件（文件、图片等）
    #[serde(default)]
    pub attachments: Vec<serde_json::Value>,
    /// 任务状态
    pub status: TaskStatus,
    /// 进度事件缓存
    #[serde(default)]
    pub progress_events: Vec<TaskProgressEvent>,
    /// 执行结果
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    /// 错误信息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 错误代码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 开始执行时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    /// 完成时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
}

pub fn default_service_type() -> String {
    "RCoder".to_string()
}

impl TaskInfo {
    /// 创建新任务
    pub fn new(client_id: String, project_id: String, prompt: String) -> Self {
        Self {
            task_id: uuid::Uuid::new_v4().to_string(),
            client_id,
            project_id,
            session_id: None,
            prompt,
            service_type: default_service_type(),
            model_config: None,
            attachments: Vec::new(),
            status: TaskStatus::Pending,
            progress_events: Vec::new(),
            result: None,
            error: None,
            error_code: None,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
        }
    }

    /// 设置会话 ID
    pub fn with_session_id(mut self, session_id: Option<String>) -> Self {
        self.session_id = session_id;
        self
    }

    /// 设置服务类型
    pub fn with_service_type(mut self, service_type: String) -> Self {
        self.service_type = service_type;
        self
    }

    /// 设置模型配置
    pub fn with_model_config(mut self, config: Option<serde_json::Value>) -> Self {
        self.model_config = config;
        self
    }

    /// 设置附件
    pub fn with_attachments(mut self, attachments: Vec<serde_json::Value>) -> Self {
        self.attachments = attachments;
        self
    }
}

/// 任务进度事件（对齐 rcoder ProgressEvent）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgressEvent {
    /// 事件类型
    pub event_type: TaskProgressEventType,
    /// 事件数据
    pub data: serde_json::Value,
    /// 事件时间
    pub timestamp: DateTime<Utc>,
}

/// 任务进度事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskProgressEventType {
    /// 会话 prompt 开始
    SessionPromptStart,
    /// 工具使用
    ToolUse,
    /// 文本增量
    TextDelta,
    /// 会话 prompt 结束
    SessionPromptEnd,
    /// 心跳
    Heartbeat,
    /// 错误
    Error,
}

/// 创建任务请求
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTaskRequest {
    /// 目标客户端 ID
    pub client_id: String,
    /// 项目 ID
    pub project_id: String,
    /// 会话 ID（可选，用于会话复用）
    #[serde(default)]
    pub session_id: Option<String>,
    /// 用户输入 prompt
    pub prompt: String,
    /// 服务类型
    #[serde(default)]
    pub service_type: Option<String>,
    /// 模型配置
    #[serde(default)]
    pub model_config: Option<serde_json::Value>,
    /// 附件
    #[serde(default)]
    pub attachments: Vec<serde_json::Value>,
}

/// Agent 状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    /// 空闲
    Idle,
    /// 忙碌（正在执行任务）
    Busy,
    /// 未知
    Unknown,
}

/// 客户端信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    /// 客户端 ID (RustDesk ID)
    pub id: String,
    /// 客户端名称
    pub name: Option<String>,
    /// 操作系统
    pub os: String,
    /// 操作系统版本
    pub os_version: String,
    /// 架构
    pub arch: String,
    /// 客户端版本
    pub client_version: String,
    /// 是否在线
    pub online: bool,
    /// 最后心跳时间
    pub last_heartbeat: DateTime<Utc>,
    /// 连接时间
    pub connected_at: DateTime<Utc>,
    /// 连接模式
    pub connection_mode: String,
    /// 延迟 (ms)
    pub latency: Option<u32>,
    /// 管理服务器地址（客户端用于回连）
    pub admin_endpoint: Option<String>,
    /// P2P 连接密码（不序列化到响应中，仅内部使用）
    #[serde(skip_serializing)]
    pub p2p_password: Option<String>,
}

impl ClientInfo {
    /// 创建测试客户端
    pub fn mock(id: &str) -> Self {
        Self {
            id: id.to_string(),
            name: Some(format!("Client-{}", id)),
            os: "darwin".to_string(),
            os_version: "24.0.0".to_string(),
            arch: "aarch64".to_string(),
            client_version: "0.1.0".to_string(),
            online: true,
            last_heartbeat: Utc::now(),
            connected_at: Utc::now(),
            connection_mode: "P2P".to_string(),
            latency: Some(15),
            admin_endpoint: None,
            p2p_password: Some("mock_password".to_string()),
        }
    }

    /// 从注册请求创建
    pub fn from_registration(req: &ClientRegistration) -> Self {
        Self {
            id: req.client_id.clone(),
            name: req.name.clone(),
            os: req.os.clone(),
            os_version: req.os_version.clone(),
            arch: req.arch.clone(),
            client_version: req.client_version.clone(),
            online: true,
            last_heartbeat: Utc::now(),
            connected_at: Utc::now(),
            connection_mode: "Registered".to_string(),
            latency: None,
            admin_endpoint: None,
            p2p_password: req.p2p_password.clone(),
        }
    }
}

/// 客户端注册请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientRegistration {
    /// RustDesk 客户端 ID
    pub client_id: String,
    /// 客户端名称
    pub name: Option<String>,
    /// 操作系统
    pub os: String,
    /// 操作系统版本
    pub os_version: String,
    /// 架构
    pub arch: String,
    /// 客户端版本
    pub client_version: String,
    /// P2P 连接密码（用于 admin-server 连接到 client）
    #[serde(default)]
    pub p2p_password: Option<String>,
}

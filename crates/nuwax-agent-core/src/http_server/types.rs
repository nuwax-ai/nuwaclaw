//! HTTP 请求/响应类型定义
//!
//! 用于 HTTP 服务层与 AgentRunnerApi 的协议转换

use serde::{Deserialize, Serialize};

/// Computer Chat 请求
#[derive(Debug, Clone, Deserialize)]
pub struct ComputerChatRequest {
    /// 项目 ID（可选，若未提供则自动生成 UUID）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,

    /// 会话 ID（可选）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,

    /// 提示内容
    pub prompt: String,

    /// 请求 ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,

    /// 附件列表
    #[serde(default)]
    pub attachments: Vec<super::super::api::traits::agent_runner::Attachment>,

    /// 模型提供商配置
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "model_provider")]
    pub model_config: Option<super::super::api::traits::agent_runner::ModelProviderConfig>,
}

/// Computer Chat 响应
#[derive(Debug, Clone, Serialize)]
pub struct ChatResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// 错误信息（成功时为 None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Computer Agent Stop 请求
#[derive(Debug, Clone, Deserialize)]
pub struct ComputerAgentStopRequest {
    pub project_id: String,
}

/// Computer Agent Stop 响应
#[derive(Debug, Clone, Serialize)]
pub struct StopResponse {
    pub project_id: String,
}

/// Computer Agent Status 请求
#[derive(Debug, Clone, Deserialize)]
pub struct ComputerAgentStatusRequest {
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// Computer Agent Status 响应
#[derive(Debug, Clone, Serialize)]
pub struct StatusResponse {
    pub is_found: bool,
    pub status: super::super::api::traits::agent_runner::AgentStatus,
}

/// Computer Agent Cancel 请求
#[derive(Debug, Clone, Deserialize)]
pub struct ComputerAgentCancelRequest {
    pub project_id: String,
    pub session_id: String,
}

/// Computer Agent Cancel 响应
#[derive(Debug, Clone, Serialize)]
pub struct CancelResponse {
    // 空响应，成功时不返回数据
}

/// 健康检查响应
#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

/// Computer Agent List 响应
#[derive(Debug, Clone, Serialize)]
pub struct AgentListResponse {
    pub agents: Vec<super::super::api::traits::agent_runner::AgentInfo>,
}

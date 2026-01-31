//! API 请求/响应 DTO 定义

use serde::{Deserialize, Serialize};

use crate::state::{AgentStatus, ClientInfo, TaskInfo, TaskStatus};

// ============================================================================
// 健康检查 / 状态
// ============================================================================

/// 健康检查响应
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

/// 桥接层状态响应
#[derive(Serialize)]
pub struct BridgeStatusResponse {
    pub bridge_running: bool,
    pub bridge_self_id: Option<String>,
    pub hbbs_addr: String,
    pub connected_clients: usize,
    pub online_clients: usize,
    pub p2p_connections: usize,
}

// ============================================================================
// 客户端 API
// ============================================================================

/// 注册响应
#[derive(Serialize)]
pub struct RegisterResponse {
    pub success: bool,
    pub message: String,
    pub client_info: Option<ClientInfo>,
}

/// 心跳请求
#[derive(Deserialize)]
pub struct HeartbeatRequest {
    pub client_id: String,
    #[serde(default)]
    pub latency_ms: Option<u32>,
}

/// 心跳响应
#[derive(Serialize)]
pub struct HeartbeatResponse {
    pub success: bool,
}

/// 客户端上报消息请求
#[derive(Deserialize)]
pub struct ReportRequest {
    pub client_id: String,
    pub message_type: String,
    pub payload: serde_json::Value,
    #[serde(default)]
    pub in_reply_to: Option<String>,
}

/// 客户端上报消息响应
#[derive(Serialize)]
pub struct ReportResponse {
    pub success: bool,
    pub message_id: String,
}

/// 客户端列表响应
#[derive(Serialize)]
pub struct ClientListResponse {
    pub clients: Vec<ClientInfo>,
    pub total: usize,
}

/// 连接请求
#[derive(Deserialize)]
pub struct ConnectRequest {
    pub mode: Option<String>,
    pub password: Option<String>,
}

/// 连接响应
#[derive(Serialize)]
pub struct ConnectResponse {
    pub success: bool,
    pub message: String,
    pub connection_id: Option<String>,
    pub p2p_connected: bool,
}

/// 消息请求
#[derive(Deserialize)]
pub struct MessageRequest {
    pub message_type: String,
    pub payload: serde_json::Value,
}

/// 消息响应
#[derive(Serialize)]
pub struct MessageResponse {
    pub success: bool,
    pub message_id: String,
    pub transport: Option<String>,
    pub error: Option<String>,
}

// ============================================================================
// 任务 API
// ============================================================================

/// 创建聊天任务请求（HTTP 请求体）
#[derive(Debug, Deserialize)]
pub struct ChatTaskRequest {
    pub client_id: String,
    pub project_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub service_type: Option<String>,
    #[serde(default)]
    pub model_config: Option<serde_json::Value>,
    #[serde(default)]
    pub attachments: Vec<serde_json::Value>,
}

/// 创建任务响应
#[derive(Serialize)]
pub struct ChatTaskResponse {
    pub success: bool,
    pub task_id: String,
    pub session_id: Option<String>,
    pub message: String,
}

/// 任务列表查询参数
#[derive(Debug, Deserialize)]
pub struct TaskListQuery {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

/// 任务列表响应
#[derive(Serialize)]
pub struct TaskListResponse {
    pub tasks: Vec<TaskInfo>,
    pub total: usize,
}

/// 任务状态响应
#[derive(Serialize)]
pub struct TaskStatusResponse {
    pub task_id: String,
    pub status: TaskStatus,
    pub progress_count: usize,
}

/// 取消任务请求
#[derive(Debug, Deserialize)]
pub struct CancelTaskRequest {
    #[serde(default)]
    pub reason: Option<String>,
}

/// 取消任务响应
#[derive(Serialize)]
pub struct CancelTaskResponse {
    pub success: bool,
    pub result: String,
}

// ============================================================================
// Agent API
// ============================================================================

/// Agent 状态响应
#[derive(Serialize)]
pub struct AgentStatusResponse {
    pub client_id: String,
    pub status: AgentStatus,
    pub running_tasks: usize,
}

/// 停止 Agent 请求
#[derive(Debug, Deserialize)]
pub struct StopAgentRequest {
    #[serde(default)]
    pub force: Option<bool>,
    #[serde(default)]
    pub reason: Option<String>,
}

/// 停止 Agent 响应
#[derive(Serialize)]
pub struct StopAgentResponse {
    pub success: bool,
    pub message: String,
    pub cancelled_tasks: usize,
}

// ============================================================================
// SSE
// ============================================================================

/// SSE 事件过滤参数
#[derive(Debug, Deserialize)]
pub struct SseFilterParams {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub token: Option<String>,
}

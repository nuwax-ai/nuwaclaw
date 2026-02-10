//! Agent 管理 API

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use tracing::info;

use nuwax_agent_core::business_channel::BusinessMessageType;

use crate::state::{AppState, TaskStatus};

use super::dto::{AgentStatusResponse, StopAgentRequest, StopAgentResponse};

/// 获取客户端 Agent 状态
///
/// GET /api/clients/:id/agent/status
pub async fn get_agent_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AgentStatusResponse>, StatusCode> {
    if state.get_client(&id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let status = state.get_agent_status(&id);
    let running_tasks = state
        .list_tasks_by_client(&id)
        .iter()
        .filter(|t| t.status == TaskStatus::Running)
        .count();

    Ok(Json(AgentStatusResponse {
        client_id: id,
        status,
        running_tasks,
    }))
}

/// 停止客户端 Agent
///
/// POST /api/clients/:id/agent/stop
pub async fn stop_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<StopAgentRequest>,
) -> Result<Json<StopAgentResponse>, StatusCode> {
    if state.get_client(&id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 取消所有正在执行的任务
    let running_tasks: Vec<_> = state
        .list_tasks_by_client(&id)
        .into_iter()
        .filter(|t| !t.status.is_terminal())
        .collect();

    let cancelled_count = running_tasks.len();

    for task in running_tasks {
        state.cancel_task(&task.task_id, req.reason.clone());
    }

    // 发送停止命令给客户端（Fail Fast，忽略发送失败）
    let stop_payload = serde_json::json!({
        "command": "stop_agent",
        "force": req.force.unwrap_or(false), // 客户端接口已移除 force，但服务端保留用于向后兼容
        "reason": req.reason,
    });

    let _ = state
        .dispatcher
        .dispatch(&id, BusinessMessageType::SystemNotify, stop_payload)
        .await;

    info!("Agent {} stopped, cancelled {} tasks", id, cancelled_count);

    Ok(Json(StopAgentResponse {
        success: true,
        message: format!("Agent stopped, {} tasks cancelled", cancelled_count),
        cancelled_tasks: cancelled_count,
    }))
}

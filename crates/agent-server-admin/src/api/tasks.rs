//! 任务管理 API

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use tracing::{info, warn};

use nuwax_agent_core::business_channel::BusinessMessageType;

use crate::state::{AppState, CreateTaskRequest, TaskInfo, TaskStatus};

use super::dto::{
    CancelTaskRequest, CancelTaskResponse, ChatTaskRequest, ChatTaskResponse, TaskListQuery,
    TaskListResponse, TaskStatusResponse,
};

/// 创建聊天任务
///
/// POST /api/tasks/chat
pub async fn create_chat_task(
    State(state): State<AppState>,
    Json(req): Json<ChatTaskRequest>,
) -> Result<Json<ChatTaskResponse>, StatusCode> {
    if state.get_client(&req.client_id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let create_req = CreateTaskRequest {
        client_id: req.client_id.clone(),
        project_id: req.project_id,
        session_id: req.session_id.clone(),
        prompt: req.prompt.clone(),
        service_type: req.service_type,
        model_config: req.model_config.clone(),
        attachments: req.attachments.clone(),
    };

    let task = state.create_task(create_req);
    let task_id = task.task_id.clone();
    let session_id = task.session_id.clone();

    info!(
        "Created task {} for client {}: prompt={}...",
        task_id,
        req.client_id,
        req.prompt.chars().take(50).collect::<String>()
    );

    // 构建任务 payload
    let payload = serde_json::json!({
        "task_id": task.task_id,
        "project_id": task.project_id,
        "session_id": task.session_id,
        "prompt": task.prompt,
        "service_type": task.service_type,
        "model_config": task.model_config,
        "attachments": task.attachments,
    });

    // 通过 dispatcher 发送，Fail Fast
    match state
        .dispatcher
        .dispatch(
            &req.client_id,
            BusinessMessageType::AgentTaskRequest,
            payload,
        )
        .await
    {
        Ok(_) => {
            state.update_task_status(&task_id, TaskStatus::Sent);
        }
        Err(e) => {
            warn!("Failed to dispatch task {}: {}", task_id, e);
            // 任务保持 Pending 状态，客户端连接后可重新投递
        }
    }

    Ok(Json(ChatTaskResponse {
        success: true,
        task_id,
        session_id,
        message: "Task created".to_string(),
    }))
}

/// 获取任务列表
///
/// GET /api/tasks
pub async fn list_tasks(
    State(state): State<AppState>,
    Query(params): Query<TaskListQuery>,
) -> Json<TaskListResponse> {
    let mut tasks = if let Some(client_id) = &params.client_id {
        state.list_tasks_by_client(client_id)
    } else {
        state.list_tasks()
    };

    // 按状态过滤
    if let Some(status_str) = &params.status {
        let status = match status_str.as_str() {
            "pending" => Some(TaskStatus::Pending),
            "sent" => Some(TaskStatus::Sent),
            "running" => Some(TaskStatus::Running),
            "completed" => Some(TaskStatus::Completed),
            "failed" => Some(TaskStatus::Failed),
            "cancelled" => Some(TaskStatus::Cancelled),
            _ => None,
        };
        if let Some(s) = status {
            tasks.retain(|t| t.status == s);
        }
    }

    // 按创建时间倒序
    tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let total = tasks.len();
    Json(TaskListResponse { tasks, total })
}

/// 获取任务详情
///
/// GET /api/tasks/:id
pub async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaskInfo>, StatusCode> {
    state.get_task(&id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

/// 获取任务状态
///
/// GET /api/tasks/:id/status
pub async fn get_task_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<TaskStatusResponse>, StatusCode> {
    let task = state.get_task(&id).ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(TaskStatusResponse {
        task_id: task.task_id,
        status: task.status,
        progress_count: task.progress_events.len(),
    }))
}

/// 取消任务
///
/// POST /api/tasks/:id/cancel
pub async fn cancel_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<CancelTaskRequest>,
) -> Result<Json<CancelTaskResponse>, StatusCode> {
    let task = state.get_task(&id).ok_or(StatusCode::NOT_FOUND)?;

    if task.status.is_terminal() {
        return Ok(Json(CancelTaskResponse {
            success: false,
            result: "Task already completed".to_string(),
        }));
    }

    if state.cancel_task(&id, req.reason.clone()) {
        // 尝试通知客户端取消（Fail Fast，忽略发送失败）
        let cancel_payload = serde_json::json!({
            "task_id": id,
            "reason": req.reason,
        });

        let _ = state
            .dispatcher
            .dispatch(
                &task.client_id,
                BusinessMessageType::TaskCancel,
                cancel_payload,
            )
            .await;

        info!("Task {} cancelled", id);
        Ok(Json(CancelTaskResponse {
            success: true,
            result: "success".to_string(),
        }))
    } else {
        Ok(Json(CancelTaskResponse {
            success: false,
            result: "failed".to_string(),
        }))
    }
}

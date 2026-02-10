//! API 路由模块

mod agents;
mod clients;
mod dto;
mod events;
mod status;
mod tasks;

use axum::{
    routing::{get, post},
    Router,
};

use crate::state::AppState;

/// 创建路由
pub fn create_router(state: AppState) -> Router {
    Router::new()
        // 健康检查和状态
        .route("/health", get(status::health_check))
        .route("/api/status", get(status::bridge_status))
        // 客户端注册和心跳（供 agent-client 调用）
        .route("/api/register", post(clients::register_client))
        .route("/api/heartbeat", post(clients::client_heartbeat))
        .route("/api/report", post(clients::report_message))
        // 管理端 API
        .route("/api/clients", get(clients::list_clients))
        .route("/api/clients/online", get(clients::list_online_clients))
        .route("/api/clients/:id", get(clients::get_client))
        .route("/api/clients/:id/connect", post(clients::connect_client))
        .route("/api/clients/:id/message", post(clients::send_message))
        .route(
            "/api/clients/:id/agent/status",
            get(agents::get_agent_status),
        )
        .route("/api/clients/:id/agent/stop", post(agents::stop_agent))
        // 任务管理 API
        .route("/api/tasks", get(tasks::list_tasks))
        .route("/api/tasks/chat", post(tasks::create_chat_task))
        .route("/api/tasks/:id", get(tasks::get_task))
        .route("/api/tasks/:id/status", get(tasks::get_task_status))
        .route("/api/tasks/:id/progress", get(events::task_progress_sse))
        .route("/api/tasks/:id/cancel", post(tasks::cancel_task))
        // SSE 事件
        .route("/api/events", get(events::sse_events))
        .with_state(state)
}

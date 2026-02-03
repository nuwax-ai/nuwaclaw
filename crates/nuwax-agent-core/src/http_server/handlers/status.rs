//! Computer Status Handler

use crate::api::traits::agent_runner::AgentRunnerApi;
use super::{AppError, HttpResult};
use axum::{
    extract::State,
    Json,
};
use std::sync::Arc;

use super::super::types::{ComputerAgentStatusRequest, StatusResponse};

/// Computer Status Handler
///
/// 调用 AgentRunnerApi::get_status 方法
#[axum::debug_handler]
pub async fn computer_status(
    State(agent_runner_api): State<Arc<dyn AgentRunnerApi>>,
    Json(request): Json<ComputerAgentStatusRequest>,
) -> Result<HttpResult<StatusResponse>, AppError> {
    let session_id = request.session_id.as_deref().unwrap_or("");

    let result = agent_runner_api.get_status(session_id, &request.project_id).await?;

    Ok(HttpResult::success(StatusResponse {
        is_found: result.is_found,
        status: result.status,
    }))
}

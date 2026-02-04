//! Computer Stop Handler

use crate::api::traits::agent_runner::AgentRunnerApi;
use super::{AppError, HttpResult};
use axum::{
    extract::State,
    Json,
};
use std::sync::Arc;

use super::super::types::{ComputerAgentStopRequest, StopResponse};

/// Computer Stop Handler
///
/// 调用 AgentRunnerApi::stop_agent 方法
#[axum::debug_handler]
pub async fn computer_stop(
    State(agent_runner_api): State<Arc<dyn AgentRunnerApi>>,
    Json(request): Json<ComputerAgentStopRequest>,
) -> Result<HttpResult<StopResponse>, AppError> {
    agent_runner_api
        .stop_agent(&request.project_id)
        .await?;

    Ok(HttpResult::success(StopResponse {
        project_id: request.project_id,
    }))
}

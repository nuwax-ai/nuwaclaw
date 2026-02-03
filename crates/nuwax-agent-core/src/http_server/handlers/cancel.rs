//! Computer Cancel Handler

use crate::api::traits::agent_runner::AgentRunnerApi;
use super::{AppError, HttpResult};
use axum::{
    extract::State,
    Json,
};
use std::sync::Arc;

use super::super::types::{ComputerAgentCancelRequest, CancelResponse};

/// Computer Cancel Handler
///
/// 调用 AgentRunnerApi::cancel_session 方法
#[axum::debug_handler]
pub async fn computer_cancel(
    State(agent_runner_api): State<Arc<dyn AgentRunnerApi>>,
    Json(request): Json<ComputerAgentCancelRequest>,
) -> Result<HttpResult<CancelResponse>, AppError> {
    agent_runner_api
        .cancel_session(&request.session_id, &request.project_id)
        .await?;

    Ok(HttpResult::success(CancelResponse {}))
}

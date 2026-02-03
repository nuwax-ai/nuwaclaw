//! Computer Chat Handler

use crate::api::traits::agent_runner::{AgentRunnerApi, ChatRequest};
use super::{AppError, HttpResult};
use axum::{
    extract::State,
    Json,
};
use std::sync::Arc;

use super::super::types::ComputerChatRequest;

/// Computer Chat Handler
///
/// 调用 AgentRunnerApi::chat 方法
#[axum::debug_handler]
pub async fn computer_chat(
    State(agent_runner_api): State<Arc<dyn AgentRunnerApi>>,
    Json(request): Json<ComputerChatRequest>,
) -> Result<HttpResult<super::super::types::ChatResponse>, AppError> {
    let project_id = request.project_id.clone();
    let chat_request = ChatRequest {
        project_id: request.project_id,
        session_id: request.session_id,
        prompt: request.prompt,
        request_id: request.request_id,
        attachments: request.attachments,
        model_config: None,
        service_type: None,
    };

    let response = agent_runner_api.chat(chat_request).await?;

    Ok(HttpResult::success(super::super::types::ChatResponse {
        project_id: response.project_id,
        session_id: response.session_id,
        request_id: response.request_id,
    }))
}

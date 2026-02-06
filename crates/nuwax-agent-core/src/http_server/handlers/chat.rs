//! Computer Chat Handler

use crate::api::traits::agent_runner::{AgentRunnerApi, ChatRequest};
use super::{AppError, HttpResult};
use axum::{
    extract::State,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

use super::super::types::ComputerChatRequest;

/// Computer Chat Handler
///
/// 调用 AgentRunnerApi::chat 方法
#[axum::debug_handler]
pub async fn computer_chat(
    State(agent_runner_api): State<Arc<dyn AgentRunnerApi>>,
    Json(request): Json<ComputerChatRequest>,
) -> Result<HttpResult<super::super::types::ChatResponse>, AppError> {
    // 生成或使用提供的 project_id（参照 rcoder 实现）
    let project_id = match &request.project_id {
        Some(id) if !id.trim().is_empty() => id.clone(),
        _ => Uuid::new_v4().to_string(),
    };

    let chat_request = ChatRequest {
        project_id: Some(project_id),
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

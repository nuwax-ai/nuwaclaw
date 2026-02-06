//! Computer Chat Handler

use super::{AppError, HttpResult};
use crate::api::traits::agent_runner::{AgentRunnerApi, ChatRequest};
use axum::{extract::State, Json};
use std::sync::Arc;
use tracing::{error, info};
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
    info!(
        "[computer_chat] 收到请求: project_id={:?}, session_id={:?}, prompt_len={}, request_id={:?}",
        request.project_id,
        request.session_id,
        request.prompt.len(),
        request.request_id
    );

    // 生成或使用提供的 project_id（参照 rcoder 实现）
    let project_id = match &request.project_id {
        Some(id) if !id.trim().is_empty() => id.clone(),
        _ => Uuid::new_v4().to_string(),
    };

    let chat_request = ChatRequest {
        project_id: Some(project_id.clone()),
        session_id: request.session_id,
        prompt: request.prompt,
        request_id: request.request_id,
        attachments: request.attachments,
        model_config: None,
        service_type: None,
    };

    info!(
        "[computer_chat] 调用 agent_runner_api.chat(), project_id={}",
        project_id
    );

    let response = match agent_runner_api.chat(chat_request).await {
        Ok(resp) => {
            info!(
                "[computer_chat] chat 成功: success={}, session_id={}, error={:?}, error_code={:?}",
                resp.success, resp.session_id, resp.error, resp.error_code
            );
            resp
        }
        Err(e) => {
            error!("[computer_chat] chat 失败: {}", e);
            return Err(AppError::from(e));
        }
    };

    Ok(HttpResult::success(super::super::types::ChatResponse {
        project_id: response.project_id,
        session_id: response.session_id,
        request_id: response.request_id,
    }))
}

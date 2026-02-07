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
    // 详细打印模型配置和 agent_config
    info!(
        "[computer_chat] 收到请求: project_id={:?}, session_id={:?}, prompt_len={}, request_id={:?}, has_model_config={}, has_agent_config={}, has_system_prompt={}",
        request.project_id,
        request.session_id,
        request.prompt.len(),
        request.request_id,
        request.model_config.is_some(),
        request.agent_config.is_some(),
        request.system_prompt.is_some()
    );

    // 打印 agent_config 详情
    if let Some(ref agent_config) = request.agent_config {
        info!(
            "[computer_chat] agent_config: has_agent_server={}, context_servers={}",
            agent_config.has_agent_server(),
            agent_config.context_servers.len()
        );
        if let Some(ref server) = agent_config.agent_server {
            info!(
                "[computer_chat] agent_server: agent_id={:?}, command={:?}",
                server.agent_id, server.command
            );
        }
    }

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
        data_source_attachments: request.data_source_attachments.unwrap_or_default(),
        model_config: request.model_config,
        agent_config_override: request.agent_config,
        system_prompt_override: request.system_prompt,
        user_prompt_template_override: None,
    };

    info!(
        "[computer_chat] 调用 agent_runner_api.chat(), project_id={}, agent_config_override={}",
        project_id,
        chat_request.agent_config_override.is_some()
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
        error: response.error,
    }))
}

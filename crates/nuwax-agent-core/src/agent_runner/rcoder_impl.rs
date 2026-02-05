//! Rcoder Agent Runner 实现
//!
//! 使用 rcoder 的 agent_runner 库实现 AgentRunnerApi trait

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::api::traits::agent_runner::{
    AgentRunnerApi, ChatRequest, ChatResponse, ProgressMessage,
    AgentStatus, AgentStatusResult, AgentInfo,
};

// 使用 agent_runner 导出的类型
use agent_runner::{AgentRuntime, AgentRequest, WorkerState, AGENT_REGISTRY};

// 使用 shared_types 中的类型
use shared_types::ServiceType;

/// Rcoder Agent Runner 配置
#[derive(Debug, Clone)]
pub struct RcoderAgentRunnerConfig {
    /// 项目工作目录
    pub projects_dir: PathBuf,
    /// API Key
    pub api_key: Option<String>,
    /// API Base URL
    pub api_base_url: String,
    /// 默认模型
    pub default_model: String,
}

impl Default for RcoderAgentRunnerConfig {
    fn default() -> Self {
        Self {
            projects_dir: PathBuf::from("./projects"),
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
        }
    }
}

/// Rcoder Agent Runner 实现
///
/// 使用 rcoder 的 agent_runner 作为后端
#[derive(Clone)]
pub struct RcoderAgentRunner {
    /// rcoder AgentRuntime (Arc 包装)
    runtime: Arc<AgentRuntime>,
    /// 配置
    config: Arc<RcoderAgentRunnerConfig>,
    /// 活跃会话追踪
    active_sessions: Arc<dashmap::DashMap<String, tokio::time::Instant>>,
}

impl RcoderAgentRunner {
    /// 创建新的 Runner
    pub fn new(config: RcoderAgentRunnerConfig) -> Self {
        // 创建 AgentRuntime，缓冲区大小为 100
        let (runtime, request_rx) = AgentRuntime::new(100);

        // 包装为 Arc
        let runtime = Arc::new(runtime);

        // 在后台启动运行时
        let rt = runtime.clone();
        tokio::spawn(async move {
            rt.start(request_rx).await;
        });

        Self {
            runtime,
            config: Arc::new(config),
            active_sessions: Arc::new(dashmap::DashMap::new()),
        }
    }

    /// 获取配置引用
    pub fn config(&self) -> &RcoderAgentRunnerConfig {
        &self.config
    }

    /// 停止 Runner
    pub async fn stop(&self) {
        info!("[RcoderAgentRunner] 正在停止...");

        // 停止所有活跃会话
        let session_ids: Vec<_> = self.active_sessions.iter().map(|r| r.key().clone()).collect();
        for session_id in session_ids {
            let _ = self.cancel_session(&session_id, "").await;
        }

        info!("[RcoderAgentRunner] 已停止");
    }
}

/// 将 nuwax 的 ChatRequest 转换为 rcoder 的 PromptMessage
fn convert_chat_request(
    request: &ChatRequest,
    config: &RcoderAgentRunnerConfig,
) -> agent_abstraction::PromptMessage {
    let project_path = config.projects_dir.join(&request.project_id);

    agent_abstraction::PromptMessage::new(
        request.prompt.clone(),
        request.project_id.clone(),
        project_path,
        request.request_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string()),
        ServiceType::ComputerAgentRunner,
    )
    .with_session_id(request.session_id.clone())
}

/// 将 rcoder 的 ChatPromptResponse 转换为 nuwax 的 ChatResponse
fn convert_response(response: agent_runner::ChatPromptResponse) -> ChatResponse {
    let code = response.code.clone();
    // rcoder 的成功码是 "0000"
    let is_success = response.error.is_none() && code == "0000";

    ChatResponse {
        success: is_success,
        error: response.error,
        error_code: if !is_success { Some(code) } else { None },
        project_id: response.project_id,
        session_id: response.session_id,
        request_id: response.request_id,
    }
}

/// 转换 Agent 状态
fn convert_status(status: agent_runner::AgentStatus) -> AgentStatus {
    match status {
        agent_runner::AgentStatus::Pending => AgentStatus::Pending,
        agent_runner::AgentStatus::Active => AgentStatus::Active,
        agent_runner::AgentStatus::Idle => AgentStatus::Idle,
        agent_runner::AgentStatus::Terminating => AgentStatus::Terminating,
    }
}

#[async_trait::async_trait]
impl AgentRunnerApi for RcoderAgentRunner {
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String> {
        info!(
            "[RcoderAgentRunner] 收到聊天请求: project_id={}, prompt_len={}",
            request.project_id,
            request.prompt.len()
        );

        // 检查运行时状态
        if self.runtime.state() == WorkerState::Stopped {
            return Err("Agent 运行时已停止".to_string());
        }

        // 转换请求
        let prompt_message = convert_chat_request(&request, &self.config);

        // 创建请求 (不使用模型配置)
        let (agent_request, rx) = AgentRequest::new(prompt_message, None);

        // 使用 runtime.send() 发送请求
        self.runtime
            .send(agent_request)
            .await
            .map_err(|e| format!("发送请求失败: {}", e))?;

        // 等待响应
        let response = rx.await.map_err(|e| format!("接收响应失败: {}", e))?;

        // 追踪会话
        self.active_sessions
            .insert(response.session_id.clone(), tokio::time::Instant::now());

        info!(
            "[RcoderAgentRunner] 聊天响应: project_id={}, session_id={}, success={}",
            response.project_id,
            response.session_id,
            response.error.is_none()
        );

        Ok(convert_response(response))
    }

    async fn subscribe_progress(
        &self,
        session_id: &str,
    ) -> Result<mpsc::Receiver<ProgressMessage>, String> {
        debug!(
            "[RcoderAgentRunner] 订阅进度: session_id={}",
            session_id
        );

        // TODO: 等待 rcoder 提供 SSE 流支持
        // 进度订阅需要 rcoder 的 AgentRuntime 支持事件流
        // 当前返回空通道占位，rcoder 实现后需要补充
        let (_tx, rx) = mpsc::channel(32);

        debug!(
            "[RcoderAgentRunner] 进度订阅已创建 (等待 rcoder SSE 支持): session_id={}",
            session_id
        );

        Ok(rx)
    }

    async fn cancel_session(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<(), String> {
        info!(
            "[RcoderAgentRunner] 取消会话: session_id={}, project_id={}",
            session_id, project_id
        );

        // 从注册表获取 Agent 信息
        let agent_info = AGENT_REGISTRY.get_agent_info_by_session(session_id);

        if let Some(info) = agent_info {
            let _info = info.value();

            // TODO: 等待 rcoder 提供简洁的取消 API
            // 当前实现依赖 rcoder 的 CancelNotification 机制
            // 模拟方案：从活跃会话移除并标记状态
            // 未来需要调用 info.cancel_tx.send(...) 发送真正的取消信号
            self.active_sessions.remove(session_id);

            info!("[RcoderAgentRunner] 会话已标记为取消: {}", session_id);
            Ok(())
        } else {
            warn!("[RcoderAgentRunner] 会话不存在，无法取消: {}", session_id);
            Err(format!("会话不存在: {}", session_id))
        }
    }

    async fn get_status(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<AgentStatusResult, String> {
        debug!(
            "[RcoderAgentRunner] 查询状态: session_id={}, project_id={}",
            session_id, project_id
        );

        // 优先通过 project_id 查询
        if !project_id.is_empty() {
            if let Some(info) = AGENT_REGISTRY.get_agent_info(project_id) {
                let info = info.value();
                return Ok(AgentStatusResult {
                    status: convert_status(info.status),
                    is_found: true,
                });
            }
        }

        // 通过 session_id 查询
        if let Some(info) = AGENT_REGISTRY.get_agent_info_by_session(session_id) {
            let info = info.value();
            Ok(AgentStatusResult {
                status: convert_status(info.status),
                is_found: true,
            })
        } else {
            Ok(AgentStatusResult {
                status: AgentStatus::Idle,
                is_found: false,
            })
        }
    }

    async fn stop_agent(&self, project_id: &str) -> Result<(), String> {
        info!("[RcoderAgentRunner] 停止 Agent: project_id={}", project_id);

        // 获取 session_id
        let session_id = if let Some(sid) = AGENT_REGISTRY.get_session_by_project(project_id) {
            sid
        } else {
            return Err(format!("Agent 不存在: {}", project_id));
        };

        // 取消会话
        self.cancel_session(&session_id, project_id).await?;

        // 从注册表移除
        AGENT_REGISTRY.remove_by_project(project_id);

        info!("[RcoderAgentRunner] Agent 已停止: {}", project_id);
        Ok(())
    }

    async fn get_all_agents(&self) -> Result<Vec<AgentInfo>, String> {
        debug!("[RcoderAgentRunner] 获取所有活跃 Agent");

        let agents: Vec<AgentInfo> = AGENT_REGISTRY
            .iter_agents()
            .map(|ref_multi| {
                let info = ref_multi.value();
                AgentInfo {
                    project_id: info.project_id.clone(),
                    session_id: info.session_id.to_string(),
                    status: convert_status(info.status),
                    last_active_at: info.last_activity,
                }
            })
            .collect();

        info!("[RcoderAgentRunner] 找到 {} 个活跃 Agent", agents.len());
        Ok(agents)
    }
}

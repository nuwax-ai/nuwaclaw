//! Rcoder Agent Runner 实现
//!
//! 使用 rcoder 的 agent_runner 库实现 AgentRunnerApi trait

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::api::traits::agent_runner::{
    AgentInfo, AgentRunnerApi, AgentStatus, AgentStatusResult, ChatRequest, ChatResponse,
    ProgressMessage, ProgressMessageType,
};

// 使用 agent_runner 导出的类型
use agent_runner::{AgentRequest, AgentRuntime, WorkerState, AGENT_REGISTRY};
// 使用 agent_runner::service 模块导出的 SESSION_CACHE 和 SessionData
use agent_runner::service::{SessionData, SESSION_CACHE};
// 使用 agent_runner 导出的消息类型
use agent_runner::{SessionMessageType, UnifiedSessionMessage};
// 使用 agent_runner 导出的取消相关类型
use agent_runner::{CancelNotification, CancelNotificationRequestWrapper, CancelResult, SessionId};

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
        let session_ids: Vec<_> = self
            .active_sessions
            .iter()
            .map(|r| r.key().clone())
            .collect();
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
    // 获取 project_id，如果为 None 则使用默认值
    let project_id = request
        .project_id
        .clone()
        .unwrap_or_else(|| "default".to_string());

    let project_path = config.projects_dir.join(&project_id);

    agent_abstraction::PromptMessage::new(
        request.prompt.clone(),
        project_id,
        project_path,
        request
            .request_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
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
        project_id: Some(response.project_id),
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
            "[RcoderAgentRunner] 收到聊天请求: project_id={:?}, prompt_len={}",
            request.project_id,
            request.prompt.len()
        );

        // 检查运行时状态
        let current_state = self.runtime.state();
        info!(
            "[RcoderAgentRunner] 运行时状态: {:?}, is_closed={}",
            current_state,
            self.runtime.is_closed()
        );
        if current_state == WorkerState::Stopped {
            error!("[RcoderAgentRunner] Agent 运行时已停止，拒绝请求");
            return Err("Agent 运行时已停止".to_string());
        }

        // 转换请求
        let prompt_message = convert_chat_request(&request, &self.config);

        // 创建请求 (不使用模型配置)
        let (agent_request, rx) = AgentRequest::new(prompt_message, None);

        // 使用 runtime.send() 发送请求
        info!("[RcoderAgentRunner] 发送请求到 runtime...");
        self.runtime.send(agent_request).await.map_err(|e| {
            error!("[RcoderAgentRunner] 发送请求失败: {}", e);
            format!("发送请求失败: {}", e)
        })?;

        info!("[RcoderAgentRunner] 请求已发送，等待响应...");

        // 等待响应
        let response = rx.await.map_err(|e| {
            error!("[RcoderAgentRunner] 接收响应失败: {}", e);
            format!("接收响应失败: {}", e)
        })?;

        // 追踪会话
        self.active_sessions
            .insert(response.session_id.clone(), tokio::time::Instant::now());

        info!(
            "[RcoderAgentRunner] 聊天响应: project_id={}, session_id={}, code={}, error={:?}, success={}",
            response.project_id,
            response.session_id,
            response.code,
            response.error,
            response.error.is_none() && response.code == "0000"
        );

        let converted = convert_response(response);
        info!(
            "[RcoderAgentRunner] 转换后响应: success={}, error={:?}, error_code={:?}",
            converted.success, converted.error, converted.error_code
        );

        Ok(converted)
    }

    async fn subscribe_progress(
        &self,
        session_id: &str,
    ) -> Result<mpsc::Receiver<ProgressMessage>, String> {
        info!("[RcoderAgentRunner] 订阅进度: session_id={}", session_id);

        // 获取或创建 SessionData（参照 rcoder gRPC 实现）
        // 使用 entry API 避免 DashMap 的读写锁死锁问题
        let session_data = match SESSION_CACHE.entry(session_id.to_string()) {
            dashmap::mapref::entry::Entry::Occupied(entry) => {
                info!(
                    "[RcoderAgentRunner] SESSION_CACHE 已存在，复用: session_id={}",
                    session_id
                );
                entry.get().clone()
            }
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                info!(
                    "[RcoderAgentRunner] SESSION_CACHE 不存在，创建新的: session_id={}",
                    session_id
                );
                let session_data = SessionData::new(1000);
                entry.insert(session_data.clone());
                session_data
            }
        };

        // 创建新连接获取 receiver
        let (mut message_rx, cancellation_token) = session_data
            .create_new_connection(100)
            .await
            .map_err(|e| format!("创建 session 连接失败: {}", e))?;

        info!(
            "[RcoderAgentRunner] 成功创建 session 连接: session_id={}",
            session_id
        );

        // 创建输出 channel
        let (tx, rx) = mpsc::channel::<ProgressMessage>(100);
        let session_id_clone = session_id.to_string();

        // 启动后台任务转发消息
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancellation_token.cancelled() => {
                        info!(
                            "[RcoderAgentRunner] Session 连接被取消: session_id={}",
                            session_id_clone
                        );
                        // 发送结束消息
                        let end_message = ProgressMessage {
                            session_id: session_id_clone.clone(),
                            message_type: ProgressMessageType::SessionPromptEnd,
                            sub_type: "cancelled".to_string(),
                            data: serde_json::json!({
                                "reason": "Cancelled",
                                "description": "用户主动取消任务"
                            }),
                            timestamp: chrono::Utc::now(),
                        };
                        let _ = tx.send(end_message).await;
                        break;
                    }
                    msg = message_rx.recv() => {
                        match msg {
                            Some(unified_message) => {
                                // 检查是否为终止消息
                                let is_terminal = matches!(
                                    unified_message.message_type,
                                    SessionMessageType::SessionPromptEnd
                                );

                                // 转换消息
                                let progress_message = convert_unified_to_progress(&unified_message);

                                if tx.send(progress_message).await.is_err() {
                                    debug!(
                                        "[RcoderAgentRunner] 客户端已断开连接: session_id={}",
                                        session_id_clone
                                    );
                                    break;
                                }

                                // 收到终止消息后主动关闭
                                if is_terminal {
                                    info!(
                                        "[RcoderAgentRunner] 收到 SessionPromptEnd，关闭流: session_id={}",
                                        session_id_clone
                                    );
                                    break;
                                }
                            }
                            None => {
                                debug!(
                                    "[RcoderAgentRunner] Session 消息通道已关闭: session_id={}",
                                    session_id_clone
                                );
                                // 发送结束消息
                                let end_message = ProgressMessage {
                                    session_id: session_id_clone.clone(),
                                    message_type: ProgressMessageType::SessionPromptEnd,
                                    sub_type: "end_turn".to_string(),
                                    data: serde_json::json!({
                                        "reason": "EndTurn",
                                        "description": "Agent 当前无在执行任务"
                                    }),
                                    timestamp: chrono::Utc::now(),
                                };
                                let _ = tx.send(end_message).await;
                                break;
                            }
                        }
                    }
                    // 心跳保活（30秒）
                    _ = tokio::time::sleep(Duration::from_secs(30)) => {
                        let heartbeat = ProgressMessage {
                            session_id: session_id_clone.clone(),
                            message_type: ProgressMessageType::Heartbeat,
                            sub_type: "ping".to_string(),
                            data: serde_json::json!({
                                "type": "heartbeat",
                                "message": "keep-alive"
                            }),
                            timestamp: chrono::Utc::now(),
                        };

                        if tx.send(heartbeat).await.is_err() {
                            debug!(
                                "[RcoderAgentRunner] 发送心跳失败，客户端已断开: session_id={}",
                                session_id_clone
                            );
                            break;
                        }
                    }
                }
            }
        });

        Ok(rx)
    }

    async fn cancel_session(&self, session_id: &str, project_id: &str) -> Result<(), String> {
        info!(
            "[RcoderAgentRunner] 取消会话: session_id={}, project_id={}",
            session_id, project_id
        );

        // 1. 获取 agent_info 并提取需要的数据
        // 使用代码块限制读锁生命周期，避免跨 .await 持有读锁导致死锁
        let (status, cancel_tx) = {
            let agent_info = match AGENT_REGISTRY.get_agent_info_by_session(session_id) {
                Some(info) => info,
                None => {
                    // 会话不存在，幂等返回成功
                    info!(
                        "[RcoderAgentRunner] session_id={} 无活跃会话，取消目标已达成（幂等）",
                        session_id
                    );
                    self.active_sessions.remove(session_id);
                    return Ok(());
                }
            };

            // 主动克隆数据，然后显式释放读锁
            let status = agent_info.status;
            let cancel_tx = agent_info.cancel_tx.clone();

            // 显式释放读锁
            drop(agent_info);

            (status, cancel_tx)
        };

        // 2. 幂等性检查
        match status {
            agent_runner::AgentStatus::Idle => {
                info!(
                    "[RcoderAgentRunner] Agent 已处于 Idle 状态，取消请求幂等成功: session_id={}",
                    session_id
                );
                self.active_sessions.remove(session_id);
                return Ok(());
            }
            agent_runner::AgentStatus::Terminating => {
                info!(
                    "[RcoderAgentRunner] Agent 正在停止中，取消请求幂等成功: session_id={}",
                    session_id
                );
                self.active_sessions.remove(session_id);
                return Ok(());
            }
            agent_runner::AgentStatus::Active | agent_runner::AgentStatus::Pending => {
                debug!(
                    "[RcoderAgentRunner] Agent 状态为 {:?}，执行取消: session_id={}",
                    status, session_id
                );
            }
        }

        // 3. 检查 cancel_tx 通道是否仍然有效
        if cancel_tx.is_closed() {
            error!(
                "[RcoderAgentRunner] cancel_tx 通道已关闭，Agent 可能已停止: session_id={}",
                session_id
            );
            self.active_sessions.remove(session_id);
            return Err("取消通道已关闭，Agent 可能已停止".to_string());
        }

        // 4. 创建 SessionId 和 CancelNotification
        let session_id_obj = SessionId::new(Arc::from(session_id));
        let cancel_notification = CancelNotification::new(session_id_obj);

        // 5. 创建 oneshot 通道等待取消结果
        let (result_tx, result_rx) = oneshot::channel::<CancelResult>();
        let cancel_request = CancelNotificationRequestWrapper {
            cancel_notification,
            result_tx,
        };

        // 6. 发送取消通知
        if let Err(e) = cancel_tx.send(cancel_request).await {
            error!("[RcoderAgentRunner] 发送取消通知失败: {}", e);
            self.active_sessions.remove(session_id);
            return Err(format!("发送取消通知失败: {}", e));
        }

        info!(
            "[RcoderAgentRunner] 等待 Agent 取消响应: session_id={}",
            session_id
        );

        // 7. 等待取消响应（30秒超时）
        match tokio::time::timeout(Duration::from_secs(30), result_rx).await {
            Ok(Ok(cancel_result)) => {
                let is_success = cancel_result.is_success();
                info!(
                    "[RcoderAgentRunner] 收到 Agent 取消响应: session_id={}, success={}",
                    session_id, is_success
                );

                self.active_sessions.remove(session_id);

                // 关闭 SSE 连接
                if let Some(session_data) = SESSION_CACHE.get(session_id) {
                    session_data.close_current_connection().await;
                }

                if is_success {
                    Ok(())
                } else {
                    Err(format!("取消失败: {:?}", cancel_result))
                }
            }
            Ok(Err(_)) => {
                warn!(
                    "[RcoderAgentRunner] 取消结果通道被关闭: session_id={}",
                    session_id
                );
                self.active_sessions.remove(session_id);
                // 通道关闭但任务可能已被取消，视为成功
                Ok(())
            }
            Err(_) => {
                warn!(
                    "[RcoderAgentRunner] 等待取消响应超时: session_id={}",
                    session_id
                );
                self.active_sessions.remove(session_id);
                Err("等待取消响应超时".to_string())
            }
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

/// 将 UnifiedSessionMessage 转换为 ProgressMessage
fn convert_unified_to_progress(unified: &UnifiedSessionMessage) -> ProgressMessage {
    let message_type = match unified.message_type {
        SessionMessageType::SessionPromptStart => ProgressMessageType::SessionPromptStart,
        SessionMessageType::SessionPromptEnd => ProgressMessageType::SessionPromptEnd,
        SessionMessageType::AgentSessionUpdate => ProgressMessageType::AgentSessionUpdate,
        SessionMessageType::Heartbeat => ProgressMessageType::Heartbeat,
    };

    ProgressMessage {
        session_id: unified.session_id.clone(),
        message_type,
        sub_type: unified.sub_type.clone(),
        data: unified.data.clone(),
        timestamp: unified.timestamp,
    }
}

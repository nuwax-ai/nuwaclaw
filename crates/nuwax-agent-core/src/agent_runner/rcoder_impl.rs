//! Rcoder Agent Runner 实现
//!
//! 使用 rcoder 的 agent_runner 库实现 AgentRunnerApi trait

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::api::traits::agent_runner::{
    AgentInfo, AgentRunnerApi, AgentStatus, AgentStatusResult, ChatAgentConfig, ChatRequest,
    ChatResponse, ProgressMessage, ProgressMessageType,
};

// 使用 agent_runner 导出的类型
use agent_runner::{AgentRuntime, AGENT_REGISTRY};
// 使用 agent_runner::service 模块导出的 SESSION_CACHE 和 SessionData
use agent_runner::service::{SessionData, SESSION_CACHE};
// 使用 agent_runner 导出的消息类型
use agent_runner::{SessionMessageType, UnifiedSessionMessage};
// 使用 agent_runner 导出的取消相关类型
use agent_runner::{CancelNotification, CancelNotificationRequestWrapper, CancelResult, SessionId};
// 使用 agent_runner 导出的 chat_handler 共享函数
use agent_runner::{handle_chat_core, ChatHandlerContext, ChatHandlerInput};

// 使用 shared_types 中的类型
use dashmap::DashMap;
use shared_types::{ModelProviderConfig as SharedModelProviderConfig, ServiceType};

// 使用 rcoder_proxy 启动代理服务
use rcoder_proxy::{PingoraServerManager, ProxyConfig, PingoraProxyService};

/// 代理服务默认监听端口
const DEFAULT_PROXY_PORT: u16 = 8088;
/// Agent HTTP 服务默认端口
const DEFAULT_BACKEND_PORT: u16 = 9086;

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
    /// 代理服务端口（默认 8088）
    pub proxy_port: u16,
    /// Agent HTTP 服务端口（默认 9086，用于 pingora 反向代理到后端）
    pub backend_port: u16,
}

impl Default for RcoderAgentRunnerConfig {
    fn default() -> Self {
        Self {
            projects_dir: PathBuf::from("./projects"),
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: DEFAULT_PROXY_PORT,
            backend_port: DEFAULT_BACKEND_PORT,
        }
    }
}

/// Rcoder Agent Runner 实现
///
/// 使用 rcoder 的 agent_runner 作为后端
pub struct RcoderAgentRunner {
    /// rcoder AgentRuntime (Arc 包装)
    runtime: Arc<AgentRuntime>,
    /// 配置
    config: Arc<RcoderAgentRunnerConfig>,
    /// 活跃会话追踪
    active_sessions: Arc<DashMap<String, tokio::time::Instant>>,
    /// 共享的 API 密钥管理器（用于存储 ModelProviderConfig）
    shared_api_key_manager: Arc<DashMap<String, SharedModelProviderConfig>>,
    /// project_id -> UUID 映射（用于后续清理时查找）
    project_uuid_map: Arc<DashMap<String, String>>,
    /// 代理服务句柄（用于停止）
    _proxy_handle: Option<JoinHandle<()>>,
    /// 代理服务引用（用于指标等）
    _pingora_service: Option<Arc<PingoraProxyService>>,
}

impl Clone for RcoderAgentRunner {
    fn clone(&self) -> Self {
        Self {
            runtime: self.runtime.clone(),
            config: self.config.clone(),
            active_sessions: self.active_sessions.clone(),
            shared_api_key_manager: self.shared_api_key_manager.clone(),
            project_uuid_map: self.project_uuid_map.clone(),
            _proxy_handle: None, // Clone 时不复制句柄
            _pingora_service: self._pingora_service.clone(),
        }
    }
}

impl RcoderAgentRunner {
    /// 创建新的 Runner
    pub fn new(config: RcoderAgentRunnerConfig) -> Self {
        // 创建共享的 API 密钥管理器
        let shared_api_key_manager: Arc<DashMap<String, SharedModelProviderConfig>> =
            Arc::new(DashMap::new());

        // 创建 AgentRuntime，缓冲区大小为 100
        let (runtime, request_rx) = AgentRuntime::new(100);

        // 包装为 Arc
        let runtime = Arc::new(runtime);

        // 在后台启动运行时
        let rt = runtime.clone();
        tokio::spawn(async move {
            rt.start(request_rx).await;
        });

        // 启动代理服务
        let proxy_port = config.proxy_port;
        let api_key_manager_for_proxy = shared_api_key_manager.clone();

        info!(
            "[RcoderAgentRunner] 🚀 启动 Pingora 代理服务，监听端口: {}",
            proxy_port
        );

        // 创建代理配置
        let proxy_config = ProxyConfig {
            listen_port: proxy_port,
            default_backend_port: config.backend_port,
            backend_host: "127.0.0.1".to_string(),
            port_param: "port".to_string(),
            config_file: None,
            verbose: false,
        };

        // 创建 Pingora 服务器管理器并注入共享的 API 密钥管理器
        // 使用 builder 模式的 with_api_key_manager 方法
        let mut server_manager = PingoraServerManager::new(proxy_config)
            .with_api_key_manager(api_key_manager_for_proxy);

        // 获取服务引用（用于后续指标读取等）
        let pingora_service = server_manager.service();

        info!("[RcoderAgentRunner] ✅ Pingora 代理服务配置完成，已注入 API 密钥管理器");

        // 在后台启动 Pingora 服务器
        let proxy_handle = tokio::spawn(async move {
            info!("[RcoderAgentRunner] 📍 正在启动 Pingora 代理服务器...");
            if let Err(e) = server_manager.start().await {
                error!(
                    "[RcoderAgentRunner] ❌ Pingora 代理服务器启动失败: {:?}",
                    e
                );
            }
            info!("[RcoderAgentRunner] ✅ Pingora 代理服务器已退出");
        });

        Self {
            runtime,
            config: Arc::new(config),
            active_sessions: Arc::new(DashMap::new()),
            shared_api_key_manager,
            project_uuid_map: Arc::new(DashMap::new()),
            _proxy_handle: Some(proxy_handle),
            _pingora_service: Some(pingora_service),
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
            "[RcoderAgentRunner] 收到聊天请求: project_id={:?}, prompt_len={}, has_model_config={}",
            request.project_id,
            request.prompt.len(),
            request.model_config.is_some()
        );

        // 1. 准备参数
        let project_id = request
            .project_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string().replace("-", ""));

        let session_id = request.session_id.clone();

        let request_id = request
            .request_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string().replace("-", ""));

        // 2. 转换 model_config 并打印详细信息
        let model_config = request.model_config.map(|config| {
            info!(
                "[RcoderAgentRunner] 转换模型配置: id={}, name={}, base_url={}, api_key_len={}, default_model={}, requires_openai_auth={}, api_protocol={:?}",
                config.id,
                config.name,
                config.base_url,
                config.api_key.len(),
                config.default_model,
                config.requires_openai_auth,
                config.api_protocol
            );
            SharedModelProviderConfig {
                id: config.id,
                name: config.name,
                base_url: config.base_url,
                api_key: config.api_key,
                requires_openai_auth: config.requires_openai_auth,
                default_model: config.default_model,
                api_protocol: config.api_protocol,
            }
        });

        // 打印转换后的配置
        if let Some(ref cfg) = model_config {
            info!(
                "[RcoderAgentRunner] 转换后 SharedModelProviderConfig: id={}, name={}, base_url={}, api_key_len={}, default_model={}",
                cfg.id, cfg.name, cfg.base_url, cfg.api_key.len(), cfg.default_model
            );
        } else {
            warn!("[RcoderAgentRunner] model_config 为 None，将使用环境变量或默认配置");
        }

        // 2.1 计算项目工作目录（使用配置的 projects_dir）
        let project_dir = self.config.projects_dir.join(&project_id);
        info!(
            "[RcoderAgentRunner] 项目工作目录: {:?}",
            project_dir
        );

        // 2.2 打印 agent_config_override
        if let Some(ref config) = request.agent_config_override {
            info!(
                "[RcoderAgentRunner] agent_config_override: has_agent_server={}, context_servers={}",
                config.has_agent_server(),
                config.context_servers.len()
            );
        }

        // 3. 构建 ChatHandlerInput
        let input = ChatHandlerInput {
            project_id: project_id.clone(),
            project_dir,
            session_id,
            prompt: request.prompt,
            request_id,
            attachments: vec![], // HTTP 接口暂不支持附件
            data_source_attachments: request.data_source_attachments,
            model_config,
            service_type: ServiceType::ComputerAgentRunner,
            agent_config_override: request.agent_config_override,
            system_prompt_override: request.system_prompt_override,
            user_prompt_template_override: request.user_prompt_template_override,
        };

        info!(
            "[RcoderAgentRunner] 构建 ChatHandlerInput: agent_config_override={}, system_prompt_override={}, data_source_attachments={}",
            input.agent_config_override.is_some(),
            input.system_prompt_override.is_some(),
            input.data_source_attachments.len()
        );

        // 4. 构建 ChatHandlerContext
        let context = ChatHandlerContext {
            agent_runtime: self.runtime.clone(),
            shared_api_key_manager: self.shared_api_key_manager.clone(),
            project_uuid_map: self.project_uuid_map.clone(),
        };

        // 5. 调用共享 handler
        let output = handle_chat_core(input, &context).await;

        // 6. 追踪会话
        self.active_sessions
            .insert(output.session_id.clone(), tokio::time::Instant::now());

        info!(
            "[RcoderAgentRunner] 聊天响应: project_id={}, session_id={}, success={}, error={:?}, error_code={:?}",
            output.project_id,
            output.session_id,
            output.success,
            output.error,
            output.error_code
        );

        // 7. 转换为 ChatResponse
        Ok(ChatResponse {
            success: output.success,
            error: output.error,
            error_code: output.error_code,
            project_id: Some(output.project_id),
            session_id: output.session_id,
            request_id: output.request_id,
        })
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

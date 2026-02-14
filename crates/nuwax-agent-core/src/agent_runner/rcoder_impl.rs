/// Rcoder Agent Runner 实现
///
/// 使用 rcoder 的 agent_runner 库
/// 通过 start_http_server 启动 HTTP 服务器（包含 Pingora 代理）
///
/// 注意：chat、subscribe_progress 等方法已由 agent_runner 内置的 HTTP 服务处理
/// 此模块主要用于配置管理和服务器启动
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
use agent_runner::{
    start_http_server, AgentRuntime, AppConfig, HealthCheckConfig, HttpServerConfig,
    HttpServerHandle, ProxyConfig, AGENT_REGISTRY,
};
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

/// 代理服务默认监听端口
const DEFAULT_PROXY_PORT: u16 = 60002;
/// Agent HTTP 服务默认端口
const DEFAULT_BACKEND_PORT: u16 = 60001;
/// MCP Server 默认端口
const DEFAULT_MCP_SERVER_PORT: u16 = 60004;

/// Rcoder Agent Runner 配置
#[derive(Debug, Clone)]
pub struct RcoderAgentRunnerConfig {
    /// 项目工作目录
    pub projects_dir: PathBuf,
    /// 应用数据目录（用于查找 claude-code-acp-ts 等）
    pub app_data_dir: Option<PathBuf>,
    /// API Key
    pub api_key: Option<String>,
    /// API Base URL
    pub api_base_url: String,
    /// 默认模型
    pub default_model: String,
    /// 代理服务端口（默认 60002）
    pub proxy_port: u16,
    /// Agent HTTP 服务端口（默认 60001，用于 pingora 反向代理到后端）
    pub backend_port: u16,
    /// MCP Server 端口（默认 60004）
    pub mcp_server_port: u16,
    /// MCP Proxy 日志目录（可选）
    /// 当设置此值时，mcp-proxy convert 命令会输出诊断日志
    pub mcp_proxy_log_dir: Option<PathBuf>,
}

impl Default for RcoderAgentRunnerConfig {
    fn default() -> Self {
        Self {
            projects_dir: PathBuf::from("./projects"),
            app_data_dir: None,
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: DEFAULT_PROXY_PORT,
            backend_port: DEFAULT_BACKEND_PORT,
            mcp_server_port: DEFAULT_MCP_SERVER_PORT,
            mcp_proxy_log_dir: None,
        }
    }
}

/// Rcoder Agent Runner
///
/// 使用 agent_runner 作为后端，通过 start_http_server 启动 HTTP 服务
/// HTTP 服务包含：
/// - POST /computer/chat
/// - GET /computer/progress/{session_id} (SSE)
/// - POST /computer/stop
/// - GET /computer/status
pub struct RcoderAgentRunner {
    /// 配置
    config: Arc<RcoderAgentRunnerConfig>,
    /// 活跃会话追踪
    active_sessions: Arc<DashMap<String, tokio::time::Instant>>,
    /// 共享的 API 密钥管理器（用于存储 ModelProviderConfig）
    shared_api_key_manager: Arc<DashMap<String, SharedModelProviderConfig>>,
    /// project_id -> UUID 映射（用于后续清理时查找）
    project_uuid_map: Arc<DashMap<String, String>>,
    /// HTTP 服务器句柄（包含 Pingora 代理）
    server_handle: Option<HttpServerHandle>,
    /// AgentRuntime 引用，用于在 stop() 时关闭 sender
    runtime: Option<Arc<AgentRuntime>>,
    /// AgentRuntime worker JoinHandle，用于等待 worker 退出
    worker_handle: Option<tokio::task::JoinHandle<()>>,
}

impl Clone for RcoderAgentRunner {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            active_sessions: self.active_sessions.clone(),
            shared_api_key_manager: self.shared_api_key_manager.clone(),
            project_uuid_map: self.project_uuid_map.clone(),
            server_handle: None, // Clone 时不复制句柄
            runtime: None,       // Clone 时不复制 runtime
            worker_handle: None, // Clone 时不复制 worker_handle
        }
    }
}

impl RcoderAgentRunner {
    /// 构造（仅保存配置，不启动服务）
    pub fn new(config: RcoderAgentRunnerConfig) -> Self {
        Self {
            config: Arc::new(config),
            active_sessions: Arc::new(DashMap::new()),
            shared_api_key_manager: Arc::new(DashMap::new()),
            project_uuid_map: Arc::new(DashMap::new()),
            server_handle: None,
            runtime: None,
            worker_handle: None,
        }
    }

    /// 启动服务器，返回 Result 而非 panic
    pub async fn start(&mut self) -> Result<(), String> {
        if self.server_handle.is_some() {
            return Err("服务器已在运行中".to_string());
        }

        // 🔧 设置 CLAUDE_CODE_ACP_PATH 环境变量，确保使用应用内安装的版本
        // 这样不会与用户全局安装的版本冲突，也不会弹 CMD 窗口
        if let Some(ref app_data_dir) = self.config.app_data_dir {
            let acp_bin_path = app_data_dir.join("node_modules").join(".bin").join("claude-code-acp-ts");
            if acp_bin_path.exists() {
                std::env::set_var("CLAUDE_CODE_ACP_PATH", acp_bin_path.to_string_lossy().to_string());
                info!(
                    "[RcoderAgentRunner] ✅ 已设置 CLAUDE_CODE_ACP_PATH: {}",
                    acp_bin_path.display()
                );
            }
        }

        let shared_api_key_manager = Arc::new(dashmap::DashMap::new());

        // 创建 AgentRuntime，缓冲区大小为 100
        let (runtime, request_rx) = AgentRuntime::new(100);
        let runtime = Arc::new(runtime);

        // 保存 runtime 引用用于 stop() 时关闭 sender
        self.runtime = Some(runtime.clone());

        // 启动 AgentRuntime worker 并保存 JoinHandle
        let rt = runtime.clone();
        self.worker_handle = Some(tokio::spawn(async move {
            rt.start(request_rx).await;
        }));

        let app_config = Self::build_app_config(&self.config);

        let http_config = HttpServerConfig {
            port: self.config.backend_port,
            app_config,
            agent_runtime: runtime,
            shared_api_key_manager,
        };

        info!(
            "[RcoderAgentRunner] 启动 HTTP 服务器，后端端口: {}, 代理端口: {}",
            self.config.backend_port, self.config.proxy_port
        );

        let server_handle = start_http_server(http_config)
            .await
            .map_err(|e| format!("启动 HTTP 服务器失败: {}", e))?;

        self.server_handle = Some(server_handle);
        Ok(())
    }

    /// 停止服务器（确定性等待完成）
    ///
    /// 停止顺序：
    /// 1. 先停止 HTTP 服务器（释放 runtime 引用）
    /// 2. 再关闭 sender（触发 worker 退出）
    /// 3. 等待 worker 完成（带 5 秒超时）
    pub async fn stop(&mut self) {
        // 1. 先停止 HTTP 服务器（释放 http_config 中的 runtime 引用）
        if let Some(handle) = self.server_handle.take() {
            info!("[RcoderAgentRunner] 正在停止 HTTP 服务器...");
            handle.stop().await;
            info!("[RcoderAgentRunner] HTTP 服务器已停止");
        }
        // 此时 runtime 引用: self.runtime + tokio::spawn 中的 rt

        // 2. 关闭 runtime sender（触发 worker 正常退出）
        if self.runtime.is_some() {
            drop(self.runtime.take());
            info!("[RcoderAgentRunner] AgentRuntime sender 已关闭");
        }
        // sender 关闭后，worker 的 request_rx 会收到 None

        // 3. 等待 worker 完成（带 5 秒超时）
        if let Some(handle) = self.worker_handle.take() {
            use tokio::time::{timeout, Duration};
            match timeout(Duration::from_secs(5), handle).await {
                Ok(Ok(())) => info!("[RcoderAgentRunner] Worker 已正常退出"),
                Ok(Err(e)) => warn!("[RcoderAgentRunner] Worker 出错退出: {}", e),
                Err(_) => warn!("[RcoderAgentRunner] Worker 超时未退出（将被强制终止）"),
            }
        }
    }

    /// 是否正在运行
    pub fn is_running(&self) -> bool {
        self.server_handle.is_some()
    }

    /// 重启（stop + start）
    pub async fn restart(&mut self) -> Result<(), String> {
        self.stop().await;
        self.start().await
    }

    /// 获取配置引用
    pub fn config(&self) -> &RcoderAgentRunnerConfig {
        &self.config
    }

    /// 构建 AppConfig
    fn build_app_config(config: &RcoderAgentRunnerConfig) -> AppConfig {
        AppConfig {
            projects_dir: config.projects_dir.clone(),
            port: config.backend_port,
            proxy_config: Some(ProxyConfig {
                listen_port: config.proxy_port,
                default_backend_port: config.backend_port,
                backend_host: "127.0.0.1".to_string(),
                port_param: "port".to_string(),
                health_check: HealthCheckConfig {
                    enabled: true,
                    interval_seconds: 5,
                    timeout_seconds: 1,
                    healthy_threshold: 2,
                    unhealthy_threshold: 3,
                },
            }),
            mcp_proxy_log_dir: config
                .mcp_proxy_log_dir
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            ..Default::default()
        }
    }

    /// 停止 Runner（通过 Arc 调用，非独占）
    pub async fn shutdown(&self) {
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

        // 停止 HTTP 服务器和 Pingora 代理
        if let Some(ref handle) = self.server_handle {
            handle.stop().await;
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
        info!("[RcoderAgentRunner] 项目工作目录: {:?}", project_dir);

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
            skip_slot_limit: false,
        };

        info!(
            "[RcoderAgentRunner] 构建 ChatHandlerInput: agent_config_override={}, system_prompt_override={}, data_source_attachments={}",
            input.agent_config_override.is_some(),
            input.system_prompt_override.is_some(),
            input.data_source_attachments.len()
        );

        // 4. 构建 ChatHandlerContext
        let agent_runtime = self
            .runtime
            .clone()
            .ok_or_else(|| "AgentRuntime 未初始化，请先调用 start()".to_string())?;
        let context = ChatHandlerContext {
            agent_runtime,
            shared_api_key_manager: self.shared_api_key_manager.clone(),
            project_uuid_map: self.project_uuid_map.clone(),
        };

        // 5. 调用共享 handler
        let output = handle_chat_core(input, &context).await;

        // 6. 将 session 写入 SESSION_CACHE（SSE 进度流需要从这里读取）
        // 注意：handle_chat_core 内部没有写入 SESSION_CACHE，需要手动写入
        let session_id_str = output.session_id.clone();
        let _session_data = match SESSION_CACHE.entry(session_id_str.clone()) {
            dashmap::mapref::entry::Entry::Occupied(_) => {
                // 已存在，使用现有的
                SESSION_CACHE.get(&session_id_str).unwrap().clone()
            }
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                // 不存在，创建新的
                let data = SessionData::new(1000);
                entry.insert(data.clone());
                data
            }
        };
        info!(
            "[RcoderAgentRunner] Session 已写入 SESSION_CACHE: session_id={}",
            session_id_str
        );

        // 7. 追踪会话
        self.active_sessions
            .insert(session_id_str.clone(), tokio::time::Instant::now());

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

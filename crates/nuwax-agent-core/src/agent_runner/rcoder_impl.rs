/// Rcoder Agent Runner 实现
///
/// 使用 rcoder 的 agent_runner 库
/// 通过 start_http_server 启动 HTTP 服务器（包含 Pingora 代理）
///
/// 注意：chat、subscribe_progress 等方法已由 agent_runner 内置的 HTTP 服务处理
/// 此模块主要用于配置管理和服务器启动

use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

use agent_runner::{start_http_server, AppConfig, AgentRuntime, HealthCheckConfig, HttpServerHandle, HttpServerConfig, ProxyConfig};

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
            mcp_server_port: DEFAULT_MCP_SERVER_PORT,
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
    /// HTTP 服务器控制柄
    server_handle: Option<HttpServerHandle>,
    /// AgentRuntime 引用，用于在 stop() 时关闭 sender
    runtime: Option<Arc<AgentRuntime>>,
    /// AgentRuntime worker JoinHandle，用于等待 worker 退出
    worker_handle: Option<tokio::task::JoinHandle<()>>,
}

impl RcoderAgentRunner {
    /// 构造（仅保存配置，不启动服务）
    pub fn new(config: RcoderAgentRunnerConfig) -> Self {
        Self {
            config: Arc::new(config),
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
            ..Default::default()
        }
    }
}

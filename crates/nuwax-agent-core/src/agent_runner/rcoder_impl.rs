/// Rcoder Agent Runner 实现
///
/// 使用 rcoder 的 agent_runner 库
/// 通过 start_http_server 启动 HTTP 服务器（包含 Pingora 代理）
///
/// 注意：chat、subscribe_progress 等方法已由 agent_runner 内置的 HTTP 服务处理
/// 此模块主要用于配置管理和服务器启动

use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

use agent_runner::{start_http_server, AppConfig, AgentRuntime, HealthCheckConfig, HttpServerHandle, HttpServerConfig, ProxyConfig};

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

/// Rcoder Agent Runner
///
/// 使用 agent_runner 作为后端，通过 start_http_server 启动 HTTP 服务
/// HTTP 服务包含：
/// - POST /computer/chat
/// - GET /computer/progress/{session_id} (SSE)
/// - POST /computer/stop
/// - GET /computer/status
#[derive(Clone)]
pub struct RcoderAgentRunner {
    /// 配置
    pub config: Arc<RcoderAgentRunnerConfig>,
    /// HTTP 服务器控制柄
    server_handle: Option<HttpServerHandle>,
}

impl RcoderAgentRunner {
    /// 创建新的 Runner
    pub async fn new(config: RcoderAgentRunnerConfig) -> Self {
        // 创建共享的 API 密钥管理器
        let shared_api_key_manager = Arc::new(dashmap::DashMap::new());

        // 创建 AgentRuntime，缓冲区大小为 100
        let (runtime, request_rx) = AgentRuntime::new(100);
        let runtime = Arc::new(runtime);

        // 单独启动 AgentRuntime
        let rt = runtime.clone();
        tokio::spawn(async move {
            rt.start(request_rx).await;
        });

        // 1. 构建 agent_runner 的 AppConfig
        let app_config = AppConfig {
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
        };

        // 2. 构建 HttpServerConfig
        let http_config = HttpServerConfig {
            port: config.backend_port,
            app_config,
            agent_runtime: runtime.clone(),
            shared_api_key_manager: shared_api_key_manager.clone(),
        };

        info!(
            "[RcoderAgentRunner] 启动 HTTP 服务器，后端端口: {}, 代理端口: {}",
            config.backend_port, config.proxy_port
        );

        // 3. 启动 HTTP 服务器（包含 Pingora 代理、HTTP API、gRPC）
        let server_handle = start_http_server(http_config)
            .await
            .expect("启动 HTTP 服务器失败");

        Self {
            config: Arc::new(config),
            server_handle: Some(server_handle),
        }
    }

    /// 获取配置引用
    pub fn config(&self) -> &RcoderAgentRunnerConfig {
        &self.config
    }

    /// 停止 Runner
    pub async fn stop(&self) {
        info!("[RcoderAgentRunner] 正在停止...");

        if let Some(ref handle) = self.server_handle {
            handle.stop().await;
        }

        info!("[RcoderAgentRunner] 已停止");
    }
}

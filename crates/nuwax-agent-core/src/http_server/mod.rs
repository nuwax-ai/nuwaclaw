//! HTTP Server 模块
//!
//! 提供嵌入式 HTTP 服务，监听指定端口并提供 /computer 前缀的 REST API
//! 通过 AgentRunnerApi trait 与本地 Agent Runner 进行通信

pub mod types;
pub mod error;
pub mod handlers;

use crate::api::traits::agent_runner::AgentRunnerApi;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tracing::info;

/// HTTP 服务器内部状态
#[derive(Clone)]
struct HttpServerInner {
    /// 取消令牌
    cancel_token: CancellationToken,
    /// 服务器地址
    addr: SocketAddr,
}

/// HTTP 服务器实例
#[derive(Clone)]
pub struct HttpServer {
    /// 内部状态
    inner: Arc<HttpServerInner>,
}

impl HttpServer {
    /// 创建新的 HTTP 服务器实例
    pub fn new(port: u16) -> Self {
        Self {
            inner: Arc::new(HttpServerInner {
                cancel_token: CancellationToken::new(),
                addr: SocketAddr::from(([0, 0, 0, 0], port)),
            }),
        }
    }

    /// 获取服务器地址
    pub fn addr(&self) -> SocketAddr {
        self.inner.addr
    }

    /// 启动 HTTP 服务
    ///
    /// # 参数
    /// * `agent_runner_api` - AgentRunnerApi 实现
    ///
    /// # 返回
    /// Result<(), anyhow::Error>
    pub async fn start(
        &self,
        agent_runner_api: Arc<dyn AgentRunnerApi>,
    ) -> Result<(), anyhow::Error> {
        let addr = self.inner.addr;
        let cancel_token = self.inner.cancel_token.clone();

        let listener = TcpListener::bind(addr).await?;

        info!("HTTP server listening on {}", addr);

        // 使用 graceful shutdown
        axum::serve(listener, router(agent_runner_api))
            .with_graceful_shutdown(async move {
                cancel_token.cancelled().await;
            })
            .await?;

        Ok(())
    }

    /// 停止 HTTP 服务
    pub fn stop(&self) {
        self.inner.cancel_token.cancel();
    }
}

/// 健康检查 Handler
async fn health_handler() -> &'static str {
    "OK"
}

/// 创建 HTTP 路由器
///
/// # 参数
/// * `agent_runner_api` - AgentRunnerApi 实现（通过 Arc<dyn Trait> 注入）
///
/// # 返回
/// 配置好的 Axum Router
pub fn router(agent_runner_api: Arc<dyn AgentRunnerApi>) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/computer/chat", post(handlers::computer_chat))
        .route("/computer/agent/status", post(handlers::computer_status))
        .route("/computer/agent/stop", post(handlers::computer_stop))
        .route("/computer/agent/session/cancel", post(handlers::computer_cancel))
        .route("/computer/progress/{session_id}", get(handlers::computer_progress))
        .with_state(agent_runner_api)
}

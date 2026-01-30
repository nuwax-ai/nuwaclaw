//! agent-server-admin - Agent 服务器管理端
//!
//! 提供 HTTP API 用于管理和监控连接的客户端

mod api;
mod rustdesk_bridge;
mod state;

use std::net::SocketAddr;

use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, Level};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use api::create_router;
use state::AppState;

/// 服务器配置
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// 监听地址
    pub host: String,
    /// 监听端口
    pub port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8080,
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(true)
                .with_level(true),
        )
        .with(
            tracing_subscriber::filter::Targets::new()
                .with_target("agent_server_admin", Level::DEBUG)
                .with_target("tower_http", Level::DEBUG)
                .with_default(Level::INFO),
        )
        .init();

    info!("Starting agent-server-admin...");

    // 加载配置
    let config = ServerConfig::default();

    // 创建应用状态
    let state = AppState::new();

    // 创建 CORS 配置
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // 创建路由
    let app = create_router(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    // 启动服务器
    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    let listener = TcpListener::bind(addr).await?;

    info!("Server listening on http://{}", addr);
    info!("API endpoints:");
    info!("  GET  /health                - Health check");
    info!("  GET  /api/clients           - List clients");
    info!("  GET  /api/clients/:id       - Get client");
    info!("  POST /api/clients/:id/connect - Connect to client");
    info!("  POST /api/clients/:id/message - Send message");
    info!("  GET  /api/events            - SSE events");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("Shutdown complete");
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C handler");
    info!("Received shutdown signal");
}

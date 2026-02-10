//! agent-server-admin - Agent 服务器管理端
//!
//! 提供 HTTP API 用于管理和监控连接的客户端

mod api;
mod auth;
mod business_connection;
mod dispatch;
mod peer_connection;
mod rustdesk_bridge;
mod state;

use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, warn, Level};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use api::create_router;
use auth::{AuthConfig, SharedAuthConfig};
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

    // 加载认证配置
    let auth_config = AuthConfig::from_env();
    // TODO: 将 shared_auth_config 应用到路由中间件
    let _shared_auth_config: SharedAuthConfig = Arc::new(auth_config.clone());

    if auth_config.enabled {
        info!("Authentication enabled");
        if auth_config.admin_api_key.is_some() {
            info!("  Admin API Key: configured (env: ADMIN_API_KEY)");
        }
        if auth_config.client_token.is_some() {
            info!("  Client Token: configured (env: CLIENT_API_TOKEN)");
        }
    } else {
        warn!("Authentication disabled - all endpoints are open");
    }

    // 创建应用状态
    let state = AppState::new();

    // 启动 RustDesk 桥接层（连接到 data-server）
    match state.start_bridge().await {
        Ok(()) => info!("RustDesk bridge started"),
        Err(e) => warn!(
            "Failed to start RustDesk bridge: {} (will retry on connect)",
            e
        ),
    }

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
    info!("  GET  /health                      - Health check (no auth)");
    info!("  GET  /api/status                  - Bridge status");
    info!("  --- Client API (X-Client-Token) ---");
    info!("  POST /api/register                - Client registration");
    info!("  POST /api/heartbeat               - Client heartbeat");
    info!("  POST /api/report                  - Report message");
    info!("  --- Admin API (X-API-Key) ---");
    info!("  GET  /api/clients                 - List clients");
    info!("  GET  /api/clients/online          - List online clients");
    info!("  GET  /api/clients/:id             - Get client");
    info!("  POST /api/clients/:id/connect     - Connect to client");
    info!("  POST /api/clients/:id/message     - Send message");
    info!("  GET  /api/clients/:id/agent/status- Agent status");
    info!("  POST /api/clients/:id/agent/stop  - Stop agent");
    info!("  --- Task API (X-API-Key) ---");
    info!("  GET  /api/tasks                   - List tasks");
    info!("  POST /api/tasks/chat              - Create chat task");
    info!("  GET  /api/tasks/:id               - Get task");
    info!("  GET  /api/tasks/:id/status        - Task status");
    info!("  GET  /api/tasks/:id/progress      - Task progress (SSE)");
    info!("  POST /api/tasks/:id/cancel        - Cancel task");
    info!("  --- Events ---");
    info!("  GET  /api/events                  - SSE events (?token=xxx)");

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

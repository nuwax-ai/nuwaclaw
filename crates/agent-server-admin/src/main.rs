//! agent-server-admin - Agent 服务器管理端

use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志
    tracing_subscriber::fmt::init();

    info!("Starting agent-server-admin...");

    // TODO: 启动 HTTP 服务

    // 等待关闭信号
    tokio::signal::ctrl_c().await?;

    info!("Shutdown complete");
    Ok(())
}

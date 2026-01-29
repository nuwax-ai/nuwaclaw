//! data-server - 数据中转服务器

use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志
    tracing_subscriber::fmt::init();

    info!("Starting data-server...");

    // TODO: 启动信令和中继服务

    // 等待关闭信号
    tokio::signal::ctrl_c().await?;

    info!("Shutdown complete");
    Ok(())
}

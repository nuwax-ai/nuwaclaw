//! 服务健康检查模块
//!
//! 提供端口就绪检查、MCP 健康检查等功能

use tracing::info;

use super::utils::run_command_with_timeout;

/// 等待端口就绪（可被连接）
///
/// 通过尝试 TCP 连接来检测服务是否已经在监听端口
///
/// # Arguments
/// * `port` - 要检查的端口
/// * `timeout_secs` - 超时时间（秒）
///
/// # Returns
/// * `Ok(())` - 端口已就绪
/// * `Err(String)` - 超时或错误
pub(crate) async fn wait_for_port_ready(port: u16, timeout_secs: u64) -> Result<(), String> {
    use std::time::Duration;
    use tokio::net::TcpStream;
    use tokio::time::{sleep, timeout};

    let start = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(timeout_secs);
    let retry_interval = Duration::from_millis(100);

    loop {
        match timeout(
            Duration::from_millis(500),
            TcpStream::connect(format!("127.0.0.1:{}", port)),
        )
        .await
        {
            Ok(Ok(_)) => {
                info!("Port {} is ready", port);
                return Ok(());
            }
            Ok(Err(_)) | Err(_) => {
                // 连接失败或超时，检查是否已超过总超时时间
                if start.elapsed() > timeout_duration {
                    return Err(format!(
                        "Timeout waiting for port {} to be ready after {}s",
                        port, timeout_secs
                    ));
                }
                // 继续重试
                sleep(retry_interval).await;
            }
        }
    }
}

/// 等待 MCP Proxy 服务就绪（使用 mcp-proxy health 命令）
pub(crate) async fn wait_for_mcp_proxy_ready(
    bin_path: &str,
    port: u16,
    host: &str,
    timeout_secs: u64,
) -> Result<(), String> {
    let start = std::time::Instant::now();
    let timeout_duration = std::time::Duration::from_secs(timeout_secs);
    let retry_interval = std::time::Duration::from_millis(500);
    let health_url = format!("http://{}:{}/mcp", host, port);

    loop {
        let healthy =
            run_command_with_timeout(bin_path, &["health", &health_url, "--quiet"], 5).await;

        if healthy {
            info!("[McpProxy] Service ready (port {})", port);
            return Ok(());
        }

        if start.elapsed() > timeout_duration {
            return Err(format!(
                "MCP Proxy health check timeout: {} not ready after waiting {}s",
                health_url, timeout_secs
            ));
        }

        tokio::time::sleep(retry_interval).await;
    }
}

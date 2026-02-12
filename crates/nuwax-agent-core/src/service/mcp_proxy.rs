//! McpProxy 服务管理模块
//!
//! 负责 mcp-proxy 的启动、停止、重启逻辑

use tracing::{error, info, warn};

use super::config::McpProxyConfig;
use super::health::wait_for_mcp_proxy_ready;
use super::process::kill_stale_mcp_proxy_processes;
use super::utils::{spawn_wrapped, stop_child_process};

/// 停止 MCP Proxy
pub(crate) async fn stop(manager: &super::ServiceManager) -> Result<(), String> {
    info!("[McpProxy] Stopping MCP Proxy...");

    let mut guard = manager.mcp_proxy.lock().await;
    if let Some(child) = guard.take() {
        drop(guard);
        stop_child_process(child, "McpProxy").await
    } else {
        warn!("[McpProxy] MCP Proxy is not running");
        Ok(())
    }
}

/// 使用指定配置启动 MCP Proxy
pub(crate) async fn start_with_config(
    manager: &super::ServiceManager,
    config: McpProxyConfig,
) -> Result<(), String> {
    info!("[McpProxy] ========== Starting MCP Proxy Service ==========");

    // 检查配置是否包含至少一个 MCP 服务
    if config.config_json == r#"{"mcpServers":{}}"# || config.config_json.is_empty() {
        warn!("[McpProxy] mcpServers configuration is empty, skipping startup");
        return Ok(());
    }

    // 检测并清理残留进程
    kill_stale_mcp_proxy_processes().await;

    info!("[McpProxy] Executable path: {}", config.bin_path);
    info!("[McpProxy] Listen address: {}:{}", config.host, config.port);

    let port_str = config.port.to_string();
    let cmd = process_wrap::tokio::CommandWrap::with_new(config.bin_path.as_str(), |cmd| {
        cmd.arg("proxy")
            .arg("--port")
            .arg(&port_str)
            .arg("--host")
            .arg(&config.host)
            .arg("--config")
            .arg(&config.config_json);
    });

    // 跨平台 spawn
    let child = spawn_wrapped(cmd, "mcp-proxy")?;

    {
        let mut guard = manager.mcp_proxy.lock().await;
        *guard = Some(child);
    }

    // 等待进程初始化
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 检查进程是否还在运行（未立即退出）
    {
        let mut guard = manager.mcp_proxy.lock().await;
        if let Some(ref child) = *guard {
            if child.id().is_none() {
                // 进程已退出，清理
                let _ = guard.take();
                return Err(
                    "[McpProxy] Process exited immediately after start, check configuration or mcp-proxy executable"
                        .to_string(),
                );
            }
        }
    }

    // 使用 mcp-proxy health 命令检查服务就绪
    if let Err(e) =
        wait_for_mcp_proxy_ready(&config.bin_path, config.port, &config.host, 15).await
    {
        error!("[McpProxy] Health check failed: {}", e);

        // 健康检查失败，清理已存储的 child
        let mut guard = manager.mcp_proxy.lock().await;
        let _ = guard.take();
        drop(guard);

        return Err(e);
    }

    info!("[McpProxy] Process started successfully");
    Ok(())
}

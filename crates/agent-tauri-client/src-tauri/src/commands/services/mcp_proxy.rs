use crate::models::ServiceHealthDto;
use crate::state::*;
use crate::utils::*;
use nuwax_agent_core::service::DEFAULT_MCP_PROXY_PORT;

/// 启动 MCP Proxy 服务
///
/// 参数:
/// - config_json: mcpServers JSON 配置 (必需，如 `{"mcpServers":{"name":{...}}}`)
/// - port: 监听端口 (可选，默认 DEFAULT_MCP_PROXY_PORT)
///
/// 如果未传 config_json，则从 store 读取 `setup.mcp_proxy_config`
#[tauri::command]
pub async fn mcp_proxy_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
    config_json: Option<String>,
    port: Option<u16>,
) -> Result<bool, String> {
    info!("[McpProxy] 开始读取启动配置...");

    let port = port.unwrap_or_else(|| match read_store_port(&app, "setup.mcp_proxy_port") {
        Ok(Some(p)) => {
            info!("[McpProxy] 找到 mcp_proxy_port: {}", p);
            p
        }
        Ok(None) => {
            info!(
                "[McpProxy] 未找到 mcp_proxy_port，使用默认值: {}",
                DEFAULT_MCP_PROXY_PORT
            );
            DEFAULT_MCP_PROXY_PORT
        }
        Err(e) => {
            warn!(
                "[McpProxy] 读取 mcp_proxy_port 失败: {}，使用默认值 {}",
                e, DEFAULT_MCP_PROXY_PORT
            );
            DEFAULT_MCP_PROXY_PORT
        }
    });

    let config_json =
        config_json.unwrap_or_else(|| match read_store_string(&app, "setup.mcp_proxy_config") {
            Ok(Some(json)) => {
                info!("[McpProxy] 找到 mcp_proxy_config");
                json
            }
            Ok(None) => {
                info!("[McpProxy] 未找到 mcp_proxy_config，使用默认空配置");
                r#"{"mcpServers":{}}"#.to_string()
            }
            Err(e) => {
                warn!(
                    "[McpProxy] 读取 mcp_proxy_config 失败: {}，使用默认空配置",
                    e
                );
                r#"{"mcpServers":{}}"#.to_string()
            }
        });

    let mcp_proxy_config = nuwax_agent_core::McpProxyConfig {
        bin_path: nuwax_agent_core::service::DEFAULT_MCP_PROXY_BIN.to_string(),
        port,
        host: nuwax_agent_core::service::DEFAULT_MCP_PROXY_HOST.to_string(),
        config_json,
    };

    let manager = state.manager.lock().await;
    manager
        .mcp_proxy_start_with_config(mcp_proxy_config)
        .await?;
    Ok(true)
}

/// 停止 MCP Proxy 服务
#[tauri::command]
pub async fn mcp_proxy_stop(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.mcp_proxy_stop().await?;
    Ok(true)
}

/// 重启 MCP Proxy 服务
#[tauri::command]
pub async fn mcp_proxy_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
    config_json: Option<String>,
    port: Option<u16>,
) -> Result<bool, String> {
    info!("[McpProxy] 正在重启服务...");

    {
        let manager = state.manager.lock().await;
        manager.mcp_proxy_stop().await?;
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    mcp_proxy_start(app, state, config_json, port).await
}

/// 获取 MCP Proxy 运行状态
#[tauri::command]
pub async fn mcp_proxy_status(
    state: tauri::State<'_, ServiceManagerState>,
    app: tauri::AppHandle,
) -> Result<ServiceHealthDto, String> {
    let manager = state.manager.lock().await;
    let statuses = manager.services_status_all().await;

    let mcp_info = statuses
        .iter()
        .find(|s| format!("{:?}", s.service_type) == "McpProxy");

    let port = read_store_port(&app, "setup.mcp_proxy_port")
        .ok()
        .flatten()
        .unwrap_or(nuwax_agent_core::DEFAULT_MCP_PROXY_PORT);

    let port_reachable = !nuwax_agent_core::platform::check_port_available(port);

    match mcp_info {
        Some(info) => Ok(ServiceHealthDto {
            service_type: "McpProxy".to_string(),
            state: format!("{:?}", info.state),
            pid: info.pid,
            port: Some(port),
            port_reachable,
        }),
        None => Ok(ServiceHealthDto {
            service_type: "McpProxy".to_string(),
            state: "Unknown".to_string(),
            pid: None,
            port: Some(port),
            port_reachable,
        }),
    }
}

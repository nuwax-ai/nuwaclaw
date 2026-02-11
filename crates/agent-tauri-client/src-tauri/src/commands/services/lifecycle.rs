use crate::models::*;
use crate::state::*;
use crate::utils::*;
use nuwax_agent_core::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};
use nuwax_agent_core::service::DEFAULT_MCP_PROXY_BIN;
use nuwax_agent_core::service::DEFAULT_MCP_PROXY_HOST;
use nuwax_agent_core::service::DEFAULT_MCP_PROXY_PORT;
use std::sync::Arc;
use tauri::Manager;

/// 停止所有服务
#[tauri::command]
pub async fn services_stop_all(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    // 停止 RcoderAgentRunner（包括 Pingora 代理）
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            old_runner.shutdown().await;
        }
    }
    let manager = state.manager.lock().await;
    manager.services_stop_all().await?;
    Ok(true)
}

/// 重启所有服务
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: Agent 服务端口 (默认 60001)
/// - setup.file_server_port: 文件服务端口 (默认 60000)
/// - lanproxy.server_host: lanproxy 服务器地址 (从 API 返回)
/// - lanproxy.server_port: lanproxy 服务器端口 (从 API 返回)
/// - auth.saved_key: 客户端密钥
#[tauri::command]
pub async fn services_restart_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    info!("[Services] ========== 开始重启所有服务 ==========");

    // 停止所有服务
    info!("[Services] 1/5 停止所有服务...");
    {
        // 停止 RcoderAgentRunner（包括 Pingora 代理）
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            info!("[Services] 停止旧的 RcoderAgentRunner...");
            old_runner.shutdown().await;
        }
    }
    {
        let manager = state.manager.lock().await;
        manager.services_stop_all().await?;
    }
    info!("[Services] 所有服务已停止");

    // 重新启动所有服务（依次调用各个启动命令）
    // rcoder
    info!("[Services] 2/5 启动 Agent 服务 (rcoder)...");
    {
        let port = match read_store_port(&app, "setup.agent_port") {
            Ok(Some(p)) => {
                info!("[Services]   - 找到 agent_port: {}", p);
                p
            }
            Ok(None) => {
                let err = "配置缺失: setup.agent_port (Agent 服务端口)";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 setup.agent_port 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 读取工作区目录作为项目目录
        let projects_dir = match read_store_string(&app, "setup.workspace_dir") {
            Ok(Some(dir)) => {
                info!("[Services]   - 找到 workspace_dir: {}", dir);
                std::path::PathBuf::from(dir)
            }
            Ok(None) => {
                // 如果没有配置，使用应用数据目录下的 workspace
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                let default_workspace = app_data_dir.join("workspace");
                info!(
                    "[Services]   - 未找到 workspace_dir，使用默认值: {}",
                    default_workspace.display()
                );
                default_workspace
            }
            Err(e) => {
                warn!("[Services]   - 读取 workspace_dir 失败: {}，使用默认值", e);
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                app_data_dir.join("workspace")
            }
        };

        // 创建 RcoderAgentRunner 配置
        let config = RcoderAgentRunnerConfig {
            projects_dir: projects_dir.join("computer-project-workspace"),
            ..RcoderAgentRunnerConfig::default()
        };
        info!("[Services]   - 创建 RcoderAgentRunner 配置: {:?}", config);

        // 创建 RcoderAgentRunner 实例并启动
        let mut runner = RcoderAgentRunner::new(config);
        runner
            .start()
            .await
            .map_err(|e| format!("启动 Agent Runner 失败: {}", e))?;
        let agent_runner = Arc::new(runner);

        // 存储新的 runner
        {
            let mut runner_guard = state.agent_runner.lock().await;
            *runner_guard = Some(agent_runner.clone());
        }

        let manager = state.manager.lock().await;
        manager.rcoder_start(port, agent_runner).await?;
        info!("[Services]   - Agent 服务启动命令已发送");
    }

    // file_server - 读取端口配置和 bin 路径
    info!("[Services] 3/5 启动文件服务 (nuwax-file-server)...");
    {
        // 获取 file_server 可执行文件路径
        let bin_path = match get_file_server_bin_path(&app) {
            Ok(path) => {
                info!("[Services]   - 可执行文件路径: {}", path);
                path
            }
            Err(e) => {
                let err = format!("获取 nuwax-file-server 路径失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 读取文件服务端口，如果没有配置则使用默认值 60000
        let port = match read_store_port(&app, "setup.file_server_port") {
            Ok(Some(p)) => {
                info!("[Services]   - 找到 file_server_port: {}", p);
                p
            }
            Ok(None) => {
                let default_port = 60000u16;
                info!(
                    "[Services]   - 未找到 file_server_port，使用默认值: {}",
                    default_port
                );
                default_port
            }
            Err(e) => {
                warn!(
                    "[Services]   - 读取 file_server_port 失败: {}，使用默认值 60000",
                    e
                );
                60000u16
            }
        };

        // 读取用户配置的工作区目录
        let workspace_dir = match read_store_string(&app, "setup.workspace_dir") {
            Ok(Some(dir)) => {
                info!("[Services]   - 找到 workspace_dir: {}", dir);
                dir
            }
            Ok(None) => {
                // 如果没有配置，使用应用数据目录下的 workspace
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                let default_workspace = app_data_dir.join("workspace");
                let default_workspace_str = default_workspace.to_string_lossy().to_string();
                info!(
                    "[Services]   - 未找到 workspace_dir，使用默认值: {}",
                    default_workspace_str
                );
                default_workspace_str
            }
            Err(e) => {
                warn!("[Services]   - 读取 workspace_dir 失败: {}，使用默认值", e);
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                app_data_dir.join("workspace").to_string_lossy().to_string()
            }
        };

        // 获取应用数据目录用于日志等
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

        // 使用完整配置启动，基于用户工作区目录设置各路径
        // workspace_dir 替换容器中的 /app 前缀
        let _file_server_config = nuwax_agent_core::NuwaxFileServerConfig {
            bin_path: bin_path.clone(),
            port,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_init")
                .to_string_lossy()
                .to_string(),
            upload_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_zips")
                .to_string_lossy()
                .to_string(),
            project_source_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_workspace")
                .to_string_lossy()
                .to_string(),
            dist_target_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_nginx")
                .to_string_lossy()
                .to_string(),
            log_base_dir: app_data_dir
                .join("logs")
                .join("project_logs")
                .to_string_lossy()
                .to_string(),
            computer_workspace_dir: std::path::PathBuf::from(&workspace_dir)
                .join("computer-project-workspace")
                .to_string_lossy()
                .to_string(),
            computer_log_dir: app_data_dir
                .join("logs")
                .join("computer_logs")
                .to_string_lossy()
                .to_string(),
            capture_output_to_log: true,
        };

        // 确保 computer-project-workspace 目录存在
        let computer_workspace_path =
            std::path::PathBuf::from(&workspace_dir).join("computer-project-workspace");
        if !computer_workspace_path.exists() {
            std::fs::create_dir_all(&computer_workspace_path)
                .map_err(|e| format!("创建 computer-project-workspace 目录失败: {}", e))?;
            info!("[Services]   - 已创建 computer-project-workspace 目录");
        }

        let file_server_config = nuwax_agent_core::NuwaxFileServerConfig {
            bin_path,
            port,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_init")
                .to_string_lossy()
                .to_string(),
            upload_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_zips")
                .to_string_lossy()
                .to_string(),
            project_source_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_workspace")
                .to_string_lossy()
                .to_string(),
            dist_target_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_nginx")
                .to_string_lossy()
                .to_string(),
            log_base_dir: app_data_dir
                .join("logs")
                .join("project_logs")
                .to_string_lossy()
                .to_string(),
            computer_workspace_dir: computer_workspace_path.to_string_lossy().to_string(),
            computer_log_dir: app_data_dir
                .join("logs")
                .join("computer_logs")
                .to_string_lossy()
                .to_string(),
            // 是否将 file-server 的 stdout/stderr 捕获到 agent 日志（便于排查崩溃）；对应 subapp-deployer 的 LOG_CONSOLE_ENABLED
            capture_output_to_log: read_store_bool(&app, "setup.file_server_capture_output")
                .ok()
                .flatten()
                .unwrap_or(true),
        };

        // 打印完整配置用于调试
        info!("[Services]   - file_server_config:");
        info!("[Services]     env: {}", file_server_config.env);
        info!(
            "[Services]     init_project_dir: {}",
            file_server_config.init_project_dir
        );
        info!(
            "[Services]     upload_project_dir: {}",
            file_server_config.upload_project_dir
        );
        info!(
            "[Services]     project_source_dir: {}",
            file_server_config.project_source_dir
        );
        info!(
            "[Services]     dist_target_dir: {}",
            file_server_config.dist_target_dir
        );
        info!(
            "[Services]     log_base_dir: {}",
            file_server_config.log_base_dir
        );
        info!(
            "[Services]     computer_workspace_dir: {}",
            file_server_config.computer_workspace_dir
        );
        info!(
            "[Services]     computer_log_dir: {}",
            file_server_config.computer_log_dir
        );
        info!(
            "[Services]     capture_output_to_log: {}",
            file_server_config.capture_output_to_log
        );

        let manager = state.manager.lock().await;
        manager
            .file_server_start_with_config(file_server_config)
            .await?;
        info!("[Services]   - 文件服务启动命令已发送");
    }

    // lanproxy - 需要读取配置并调用 lanproxy_start_with_config
    info!("[Services] 4/5 启动代理服务 (nuwax-lanproxy)...");
    {
        // 读取 lanproxy server_host (从 API 返回)
        let server_host = match read_store_string(&app, "lanproxy.server_host") {
            Ok(Some(host)) => {
                info!("[Services]   - 找到 lanproxy.server_host: {}", host);
                host
            }
            Ok(None) => {
                let err = "配置缺失: lanproxy.server_host (lanproxy服务器地址) - 请先登录以获取服务器配置";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 lanproxy.server_host 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };
        let server_ip = strip_host_from_url(&server_host);
        info!("[Services]   - 处理后的服务器地址: {}", server_ip);

        // 读取 lanproxy server_port (从 API 返回)
        let server_port = match read_store_port(&app, "lanproxy.server_port") {
            Ok(Some(port)) => {
                info!("[Services]   - 找到 lanproxy.server_port: {}", port);
                port
            }
            Ok(None) => {
                let err = "配置缺失: lanproxy.server_port (lanproxy服务器端口) - 请先登录以获取服务器配置";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 lanproxy.server_port 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 读取 client_key
        let client_key = match read_store_string(&app, "auth.saved_key") {
            Ok(Some(key)) => {
                let masked = if key.len() > 8 {
                    format!("{}****{}", &key[..4], &key[key.len() - 4..])
                } else {
                    "****".to_string()
                };
                info!("[Services]   - 找到 client_key: {}", masked);
                key
            }
            Ok(None) => {
                let err = "配置缺失: auth.saved_key (客户端密钥)";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 auth.saved_key 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 获取 lanproxy 可执行文件完整路径
        let bin_path = match get_lanproxy_bin_path(&app) {
            Ok(path) => {
                info!("[Services]   - 可执行文件路径: {}", path);
                path
            }
            Err(e) => {
                let err = format!("获取 lanproxy 可执行文件路径失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 打印关键配置信息（注意脱敏）
        info!("[Services]   - 服务器地址: {}:{}", server_ip, server_port);
        info!(
            "[Services]   - 客户端密钥: {}****{}",
            &client_key[..client_key.len().saturating_sub(4).min(client_key.len())],
            if client_key.len() > 4 {
                &client_key[client_key.len() - 4..]
            } else {
                "****"
            }
        );

        let lanproxy_config = nuwax_agent_core::NuwaxLanproxyConfig {
            bin_path,
            server_ip,
            server_port,
            client_key,
        };

        let manager = state.manager.lock().await;
        manager.lanproxy_start_with_config(lanproxy_config).await?;
        info!("[Services]   - 代理服务启动命令已发送");
    }

    // mcp-proxy
    info!("[Services] 5/5 启动 MCP Proxy 服务...");
    {
        let port = match read_store_port(&app, "setup.mcp_proxy_port") {
            Ok(Some(p)) => {
                info!("[Services]   - 找到 mcp_proxy_port: {}", p);
                p
            }
            Ok(None) => {
                info!(
                    "[Services]   - 未找到 mcp_proxy_port，使用默认值: {}",
                    DEFAULT_MCP_PROXY_PORT
                );
                DEFAULT_MCP_PROXY_PORT
            }
            Err(e) => {
                warn!(
                    "[Services]   - 读取 mcp_proxy_port 失败: {}，使用默认值 {}",
                    e, DEFAULT_MCP_PROXY_PORT
                );
                DEFAULT_MCP_PROXY_PORT
            }
        };

        let config_json = match read_store_string(&app, "setup.mcp_proxy_config") {
            Ok(Some(json)) => json,
            _ => r#"{"mcpServers":{}}"#.to_string(),
        };

        let mcp_proxy_config = nuwax_agent_core::McpProxyConfig {
            bin_path: DEFAULT_MCP_PROXY_BIN.to_string(),
            port,
            host: DEFAULT_MCP_PROXY_HOST.to_string(),
            config_json,
        };

        let manager = state.manager.lock().await;
        manager
            .mcp_proxy_start_with_config(mcp_proxy_config)
            .await?;
        info!("[Services]   - MCP Proxy 启动命令已发送");
    }

    info!("[Services] ========== 所有服务重启命令已发送 ==========");
    Ok(true)
}

/// 获取所有服务状态
#[tauri::command]
pub async fn services_status_all(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<Vec<ServiceInfoDto>, String> {
    let manager = state.manager.lock().await;
    let statuses = manager.services_status_all().await;
    Ok(statuses.into_iter().map(|s| s.into()).collect())
}

/// 获取所有服务的健康状态（包含端口可达性检测）
#[tauri::command]
pub async fn service_health(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<Vec<ServiceHealthDto>, String> {
    let manager = state.manager.lock().await;
    let statuses = manager.services_status_all().await;

    let mut results = Vec::new();
    for info in statuses {
        // 根据服务类型确定对应端口
        let port = match format!("{:?}", info.service_type).as_str() {
            "FileServer" => read_store_port(&app, "setup.file_server_port")
                .ok()
                .flatten(),
            "McpProxy" => read_store_port(&app, "setup.mcp_proxy_port").ok().flatten(),
            "HttpServer" => read_store_port(&app, "setup.agent_port").ok().flatten(),
            _ => None,
        };

        let port_reachable = port
            .map(|p| !nuwax_agent_core::platform::check_port_available(p))
            .unwrap_or(false);

        results.push(ServiceHealthDto {
            service_type: format!("{:?}", info.service_type),
            state: format!("{:?}", info.state),
            pid: info.pid,
            port,
            port_reachable,
        });
    }

    Ok(results)
}

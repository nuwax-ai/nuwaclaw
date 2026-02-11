use crate::state::*;
use crate::utils::*;
use nuwax_agent_core::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};
use std::sync::Arc;

/// 从 Tauri store 读取配置，构建 RcoderAgentRunnerConfig
fn build_rcoder_config(app: &tauri::AppHandle) -> Result<RcoderAgentRunnerConfig, String> {
    let port = read_store_port(app, "setup.agent_port")?
        .ok_or_else(|| "配置缺失: setup.agent_port (Agent 服务端口)".to_string())?;
    info!("[Rcoder] 找到 agent_port: {}", port);

    let projects_dir = resolve_projects_dir(app)?;
    let computer_workspace_dir = projects_dir.join("computer-project-workspace");

    // 确保 computer-project-workspace 目录存在
    if !computer_workspace_dir.exists() {
        std::fs::create_dir_all(&computer_workspace_dir)
            .map_err(|e| format!("创建 computer-project-workspace 目录失败: {}", e))?;
        info!("[Rcoder] 已创建目录: {}", computer_workspace_dir.display());
    }

    let config = RcoderAgentRunnerConfig {
        projects_dir: computer_workspace_dir,
        backend_port: port,
        ..RcoderAgentRunnerConfig::default()
    };
    info!("[Rcoder] 创建 RcoderAgentRunner 配置: {:?}", config);
    Ok(config)
}

/// 启动 HTTP Server (rcoder)
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: HTTP Server 端口 (默认 60001)
/// - setup.workspace_dir: 工作区目录
#[tauri::command]
pub async fn rcoder_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let config = build_rcoder_config(&app)?;
    let port = config.backend_port;

    // 停止旧的 runner（如果存在），释放端口
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            info!("[Rcoder] 停止旧的 RcoderAgentRunner...");
            old_runner.shutdown().await;
            // 等待端口释放
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        }
    }

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
    Ok(true)
}

/// 停止 HTTP Server (rcoder)
#[tauri::command]
pub async fn rcoder_stop(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    // 停止 RcoderAgentRunner（包括 Pingora 代理）
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            old_runner.shutdown().await;
        }
    }
    let manager = state.manager.lock().await;
    manager.rcoder_stop().await?;
    Ok(true)
}

/// 重启 HTTP Server (rcoder)
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: HTTP Server 端口 (默认 60001)
#[tauri::command]
pub async fn rcoder_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let config = build_rcoder_config(&app)?;
    let manager = state.manager.lock().await;
    manager.rcoder_restart(config).await?;
    Ok(true)
}

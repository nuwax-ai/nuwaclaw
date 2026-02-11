// 命令执行相关工具函数
use nuwax_agent_core::agent_runner::RcoderAgentRunnerConfig;
use std::process::Command;

/// 跨平台检查命令是否存在
/// Windows: 使用 where
/// Unix/Linux/macOS: 使用 which
pub fn which_command(bin_name: &str) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        Command::new("where").arg(bin_name).output()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("which").arg(bin_name).output()
    }
}

/// 解析 node/npm/npx 等二进制的实际路径
/// 优先查找 ~/.local/bin/ → 最后 fallback 到命令名（依赖 PATH）
pub fn resolve_node_bin(bin_name: &str) -> String {
    // 1. ~/.local/bin/ (node 安装目录)
    let global_bin = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".local")
        .join("bin");

    #[cfg(unix)]
    let bin_path = global_bin.join(bin_name);
    #[cfg(windows)]
    let bin_path = if bin_name == "node" {
        global_bin.join("node.exe")
    } else {
        global_bin.join(format!("{}.cmd", bin_name))
    };

    if bin_path.exists() {
        info!("[resolve_node_bin] {} -> {:?}", bin_name, bin_path);
        return bin_path.to_string_lossy().to_string();
    }

    // 2. 降级到 PATH
    info!("[resolve_node_bin] {} -> fallback to PATH", bin_name);
    bin_name.to_string()
}

/// 从 Tauri store 读取配置，构建 RcoderAgentRunnerConfig
pub fn build_rcoder_config(app: &tauri::AppHandle) -> Result<RcoderAgentRunnerConfig, String> {
    use crate::utils::{read_store_port, resolve_projects_dir};

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

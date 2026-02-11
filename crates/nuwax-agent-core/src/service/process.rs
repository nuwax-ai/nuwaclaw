//! 跨平台进程管理模块
//!
//! 提供进程检测、清理、PID 管理等功能

use tracing::{error, info, warn};

use super::utils::run_command_with_timeout;

// ========== 辅助函数 ==========

/// 获取 nuwax-file-server 的 PID 文件路径
///
/// 跨平台实现：
/// - Unix: /tmp/nuwax-file-server/server.pid
/// - Windows: %TEMP%\nuwax-file-server\server.pid
pub(crate) fn get_file_server_pid_file_path() -> std::path::PathBuf {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        std::path::PathBuf::from("/tmp/nuwax-file-server/server.pid")
    }

    #[cfg(target_os = "windows")]
    {
        let temp = std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".to_string());
        std::path::PathBuf::from(temp)
            .join("nuwax-file-server")
            .join("server.pid")
    }
}

// ========== 进程检测函数 ==========

/// 通过进程名称检测进程是否正在运行
///
/// 跨平台实现：
/// - macOS/Linux: 使用 `pgrep -x <name>` 精确匹配进程名
/// - Windows: 使用 `tasklist /FI "IMAGENAME eq <name>.exe"`
///
/// # Arguments
/// * `process_name` - 进程名称（不含路径）
///
/// # Returns
/// * `Option<Vec<u32>>` - 如果进程存在，返回 PID 列表；否则返回 None
pub async fn find_processes_by_name(process_name: &str) -> Option<Vec<u32>> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pgrep -x 精确匹配进程名
        let output = tokio::process::Command::new("pgrep")
            .arg("-x")
            .arg(process_name)
            .output()
            .await
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .lines()
                .filter_map(|line| line.trim().parse::<u32>().ok())
                .collect();
            if !pids.is_empty() {
                return Some(pids);
            }
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 tasklist 查询进程
        let exe_name = if process_name.ends_with(".exe") {
            process_name.to_string()
        } else {
            format!("{}.exe", process_name)
        };

        let output = tokio::process::Command::new("tasklist")
            .args([
                "/FI",
                &format!("IMAGENAME eq {}", exe_name),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
            .await
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .lines()
                .filter(|line| !line.trim().is_empty() && !line.contains("No tasks"))
                .filter_map(|line| {
                    // CSV 格式: "process.exe","PID","Session Name","Session#","Mem Usage"
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() >= 2 {
                        parts[1].trim_matches('"').parse::<u32>().ok()
                    } else {
                        None
                    }
                })
                .collect();
            if !pids.is_empty() {
                return Some(pids);
            }
        }
        None
    }
}

/// 检测指定进程名是否正在运行
///
/// # Arguments
/// * `process_name` - 进程名称（不含路径）
///
/// # Returns
/// * `bool` - 如果进程存在返回 true
pub async fn is_process_running(process_name: &str) -> bool {
    find_processes_by_name(process_name).await.is_some()
}

/// 通过进程名前缀查找进程（模糊匹配）
///
/// # Arguments
/// * `process_prefix` - 进程名前缀
///
/// # Returns
/// * `Option<Vec<u32>>` - 如果进程存在，返回 PID 列表；否则返回 None
pub async fn find_processes_by_prefix(process_prefix: &str) -> Option<Vec<u32>> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pgrep -f 进行模糊匹配
        let output = tokio::process::Command::new("pgrep")
            .arg("-f")
            .arg(process_prefix)
            .output()
            .await
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .lines()
                .filter_map(|line| line.trim().parse::<u32>().ok())
                .collect();
            if !pids.is_empty() {
                return Some(pids);
            }
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 tasklist 然后过滤
        let output = tokio::process::Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .await
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let pids: Vec<u32> = stdout
                .lines()
                .filter(|line| line.to_lowercase().contains(&process_prefix.to_lowercase()))
                .filter_map(|line| {
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() >= 2 {
                        parts[1].trim_matches('"').parse::<u32>().ok()
                    } else {
                        None
                    }
                })
                .collect();
            if !pids.is_empty() {
                return Some(pids);
            }
        }
        None
    }
}

/// 检测指定进程名（支持模糊匹配）是否正在运行
///
/// 用于开发模式下检测带平台后缀的二进制文件
/// 如 `nuwax-lanproxy` 可以匹配 `nuwax-lanproxy-aarch64-apple-darwin`
///
/// # Arguments
/// * `process_prefix` - 进程名前缀
///
/// # Returns
/// * `bool` - 如果匹配的进程存在返回 true
pub async fn is_process_running_fuzzy(process_prefix: &str) -> bool {
    find_processes_by_prefix(process_prefix).await.is_some()
}

/// 终止指定名称的所有进程
///
/// # Arguments
/// * `process_name` - 进程名称（不含路径）
///
/// # Returns
/// * `Result<u32, String>` - 成功返回终止的进程数量
pub async fn kill_processes_by_name(process_name: &str) -> Result<u32, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pkill -x 精确匹配并终止进程
        let success = run_command_with_timeout("pkill", &["-x", process_name], 5).await;

        // pkill 返回 0 表示至少终止了一个进程
        if success {
            // 获取实际终止的数量
            if find_processes_by_name(process_name).await.is_some() {
                Ok(0) // 进程仍存在，可能需要 SIGKILL
            } else {
                Ok(1) // 假设至少终止了 1 个
            }
        } else {
            // 返回码 1 表示没有匹配的进程
            Ok(0)
        }
    }

    #[cfg(target_os = "windows")]
    {
        let exe_name = if process_name.ends_with(".exe") {
            process_name.to_string()
        } else {
            format!("{}.exe", process_name)
        };

        let success = run_command_with_timeout("taskkill", &["/F", "/IM", &exe_name], 5).await;

        if success {
            Ok(1)
        } else {
            Ok(0)
        }
    }
}

// ========== FileServer 特定进程管理 ==========

/// 检测 nuwax-file-server 是否正在运行
///
/// nuwax-file-server 是 Node.js 服务，它使用 PID 文件管理进程
/// PID 文件位置: /tmp/nuwax-file-server/server.pid (Unix) 或 %TEMP%\nuwax-file-server\server.pid (Windows)
pub async fn is_file_server_running() -> bool {
    // 使用跨平台辅助函数获取 PID 文件路径
    let pid_file = get_file_server_pid_file_path();

    if !pid_file.exists() {
        return false;
    }

    // 读取 PID 文件内容 (JSON 格式)
    if let Ok(content) = tokio::fs::read_to_string(&pid_file).await {
        // 尝试解析 JSON 获取 PID
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pid) = json.get("pid").and_then(|v| v.as_u64()) {
                // 检查进程是否存在
                return is_pid_running(pid as u32).await;
            }
        }
    }

    false
}

/// 检查指定 PID 的进程是否存在
async fn is_pid_running(pid: u32) -> bool {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 kill -0 检查进程是否存在（通过 shell 命令）
        let output = tokio::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .await;

        match output {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
            .output()
            .await;

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            !stdout.contains("No tasks") && stdout.contains(&pid.to_string())
        } else {
            false
        }
    }
}

/// 通过 PID 文件强制终止 file-server 残留进程
async fn kill_file_server_by_pid() {
    // 使用跨平台辅助函数获取 PID 文件路径
    let pid_file = get_file_server_pid_file_path();

    if let Ok(content) = tokio::fs::read_to_string(&pid_file).await {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pid) = json.get("pid").and_then(|v| v.as_u64()) {
                let pid_str = pid.to_string();

                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    run_command_with_timeout("kill", &["-9", &pid_str], 5).await;
                }
                #[cfg(target_os = "windows")]
                {
                    run_command_with_timeout("taskkill", &["/F", "/PID", &pid_str], 5).await;
                }
            }
        }
        // 清理 PID 文件
        let _ = tokio::fs::remove_file(&pid_file).await;
    }
}

/// 检测并清理残留的 file-server 进程，确保只有一个实例运行
///
/// # Arguments
/// * `bin_path` - nuwax-file-server 可执行文件的完整路径
pub(crate) async fn kill_stale_file_server_processes(bin_path: &str) {
    if is_file_server_running().await {
        warn!("[FileServer] Detected stale nuwax-file-server process, terminating");
        info!("[FileServer] Using path: {} stop", bin_path);

        // 使用 process_wrap 执行 stop 命令
        let success = run_command_with_timeout(bin_path, &["stop"], 5).await;

        if success {
            info!("[FileServer] Stop command succeeded");
        } else {
            warn!("[FileServer] Stop command failed or timed out");
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        // 如果还在运行，强制 kill
        if is_file_server_running().await {
            warn!("[FileServer] Graceful stop failed, forcing termination");
            kill_file_server_by_pid().await;
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        // 最终验证
        if is_file_server_running().await {
            error!("[FileServer] Unable to clean up stale process, startup may fail");
        }
    }
}

// ========== Lanproxy 特定进程管理 ==========

/// 检测并清理残留的 lanproxy 进程，确保只有一个实例运行
pub async fn kill_stale_lanproxy_processes() {
    if is_process_running_fuzzy("nuwax-lanproxy").await {
        warn!("[Lanproxy] Detected stale nuwax-lanproxy process, terminating");
        if let Some(pids) = find_processes_by_prefix("nuwax-lanproxy").await {
            for pid in &pids {
                info!("[Lanproxy] Terminating stale process PID: {}", pid);
                let pid_str = pid.to_string();

                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    run_command_with_timeout("kill", &["-9", &pid_str], 5).await;
                }
                #[cfg(target_os = "windows")]
                {
                    run_command_with_timeout("taskkill", &["/F", "/PID", &pid_str], 5).await;
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }
}

// ========== McpProxy 特定进程管理 ==========

/// 检测并清理残留的 mcp-proxy 进程
pub(crate) async fn kill_stale_mcp_proxy_processes() {
    if is_process_running_fuzzy("mcp-proxy").await {
        warn!("[McpProxy] Detected stale mcp-proxy process, terminating");
        if let Some(pids) = find_processes_by_prefix("mcp-proxy").await {
            for pid in &pids {
                info!("[McpProxy] Terminating stale process PID: {}", pid);
                let pid_str = pid.to_string();

                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    run_command_with_timeout("kill", &["-9", &pid_str], 5).await;
                }
                #[cfg(target_os = "windows")]
                {
                    run_command_with_timeout("taskkill", &["/F", "/PID", &pid_str], 5).await;
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }
}

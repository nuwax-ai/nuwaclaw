//! 服务管理器模块
//!
//! 管理 nuwax-file-server, nuwax-lanproxy 和 HTTP Server 服务的启动、停止、重启

use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::utils::CommandNoWindowExt;

// Windows 静默运行支持
#[cfg(windows)]
use process_wrap::tokio::{CreationFlags, JobObject};
#[cfg(windows)]
use windows::Win32::System::Threading::CREATE_NO_WINDOW;

// Unix 进程组支持
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;

// 类型别名，解决 trait object 类型推断问题
type ChildWrapperType = Box<dyn process_wrap::tokio::ChildWrapper>;

// 导入 RcoderAgentRunner
use super::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};
#[cfg(target_os = "windows")]
mod windows_launch;

// ========== 默认常量 ==========

/// MCP Proxy 默认监听端口
pub const DEFAULT_MCP_PROXY_PORT: u16 = 18099;

/// MCP Proxy 默认监听地址
pub const DEFAULT_MCP_PROXY_HOST: &str = "127.0.0.1";

/// MCP Proxy 默认可执行文件名
pub const DEFAULT_MCP_PROXY_BIN: &str = "mcp-proxy";

// ========== 跨平台辅助函数 ==========

#[cfg(target_os = "windows")]
fn find_node_exe_for_windows_launch() -> Option<std::path::PathBuf> {
    let local_node = crate::dependency::node::NodeDetector::get_local_node_path();
    if local_node.exists() {
        debug!(
            "[Service] Windows node 解析命中本地 runtime: {}",
            local_node.display()
        );
        return Some(local_node);
    }

    let output = match std::process::Command::new("where")
        .no_window()
        .arg("node.exe")
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            warn!("[Service] Windows node 解析失败: where node.exe 执行错误: {}", e);
            return None;
        }
    };
    if !output.status.success() {
        warn!(
            "[Service] Windows node 解析失败: where node.exe exit={:?}",
            output.status.code()
        );
        return None;
    }
    let binding = String::from_utf8_lossy(&output.stdout);
    let path = binding
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)?;
    debug!("[Service] Windows node 解析命中 PATH: {}", path);
    Some(std::path::PathBuf::from(path))
}

/// 获取 Node.js bin 目录路径（用于设置 PATH 环境变量）
///
/// 优先顺序：
/// 1. NUWAX_APP_RUNTIME_PATH 环境变量（由 Tauri 层设置，指向 .app 包内资源）
/// 2. 本地安装的 node（~/.local/bin/node）
/// 3. 系统 PATH 中的 node
#[cfg(target_os = "windows")]
pub fn get_node_bin_path() -> Option<String> {
    // 优先使用环境变量指定的路径
    if let Ok(runtime_path) = std::env::var("NUWAX_APP_RUNTIME_PATH") {
        let runtime_path = runtime_path.trim();
        if !runtime_path.is_empty() {
            // NUWAX_APP_RUNTIME_PATH 可能包含多个路径（用 ; 分隔）
            for dir in runtime_path.split(';') {
                let dir = dir.trim();
                if !dir.is_empty() {
                    let node_path = std::path::Path::new(dir).join("node.exe");
                    if node_path.exists() {
                        debug!(
                            "[Service] Windows node 解析命中 NUWAX_APP_RUNTIME_PATH: {}",
                            dir
                        );
                        return Some(dir.to_string());
                    }
                }
            }
        }
    }

    if let Some(node_exe) = find_node_exe_for_windows_launch() {
        if let Some(bin_dir) = node_exe.parent() {
            debug!(
                "[Service] Windows node 解析命中本地: {}",
                bin_dir.display()
            );
            return Some(bin_dir.to_string_lossy().to_string());
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
pub fn get_node_bin_path() -> Option<String> {
    use std::env::var;

    // 优先使用环境变量指定的路径
    if let Ok(runtime_path) = var("NUWAX_APP_RUNTIME_PATH") {
        let runtime_path = runtime_path.trim();
        if !runtime_path.is_empty() {
            // NUWAX_APP_RUNTIME_PATH 可能包含多个路径（用 : 分隔）
            for dir in runtime_path.split(':') {
                let dir = dir.trim();
                if !dir.is_empty() {
                    let node_path = std::path::Path::new(dir).join("node");
                    if node_path.exists() {
                        debug!(
                            "[Service] Node 解析命中 NUWAX_APP_RUNTIME_PATH: {}",
                            dir
                        );
                        return Some(dir.to_string());
                    }
                }
            }
        }
    }

    if let Ok(path) = var("PATH") {
        for dir in path.split(':') {
            let node_path = std::path::Path::new(dir).join("node");
            if node_path.exists() {
                debug!("[Service] Node 解析命中 PATH: {}", dir);
                return Some(dir.to_string());
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn resolve_js_entry_from_npm_bin_shim(
    program: &std::path::Path,
    package_name: &str,
) -> Option<std::path::PathBuf> {
    let bin_dir = program.parent()?;
    let bin_name = bin_dir.file_name()?.to_string_lossy();
    if !bin_name.eq_ignore_ascii_case(".bin") {
        return None;
    }
    let node_modules_dir = bin_dir.parent()?;
    let package_dir = node_modules_dir.join(package_name);
    if !package_dir.exists() {
        return None;
    }

    let package_json_path = package_dir.join("package.json");
    let content = std::fs::read_to_string(&package_json_path).ok()?;
    let package_json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let bin_field = package_json.get("bin")?;
    let rel_entry = if let Some(bin_str) = bin_field.as_str() {
        Some(bin_str.to_string())
    } else if let Some(bin_obj) = bin_field.as_object() {
        bin_obj
            .get(package_name)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| {
                bin_obj
                    .values()
                    .find_map(|v| v.as_str())
                    .map(str::to_string)
            })
    } else {
        None
    }?;

    let js_entry = package_dir.join(rel_entry);
    if js_entry.exists() {
        Some(js_entry)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn get_windows_cmd_script_path(program: &std::path::Path) -> Option<std::path::PathBuf> {
    match program.extension().and_then(|s| s.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("cmd") => Some(program.to_path_buf()),
        None => {
            let candidate = program.with_extension("cmd");
            if candidate.exists() {
                Some(candidate)
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn resolve_js_entry_from_cmd_shim(cmd_script: &std::path::Path) -> Option<std::path::PathBuf> {
    let content = match std::fs::read_to_string(cmd_script) {
        Ok(c) => c,
        Err(e) => {
            debug!(
                "[Service] cmd shim 读取失败: {} ({})",
                cmd_script.display(),
                e
            );
            return None;
        }
    };
    let base_dir = cmd_script.parent()?;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if !line.contains("%~dp0") || !line.to_ascii_lowercase().contains(".js") {
            continue;
        }
        let clean = line.replace('"', "");
        let start = clean.find("%~dp0")?;
        let js_pos = clean.to_ascii_lowercase().find(".js")?;
        let end = js_pos + 3;
        if end <= start + 5 || end > clean.len() {
            continue;
        }
        let rel = clean[start + 5..end].trim_start_matches(['\\', '/']);
        if rel.is_empty() {
            continue;
        }
        let rel = rel.replace('/', "\\");
        let entry = base_dir.join(std::path::Path::new(&rel));
        if entry.exists() {
            debug!(
                "[Service] cmd shim 解析命中入口: {} -> {}",
                cmd_script.display(),
                entry.display()
            );
            return Some(entry);
        }
    }
    debug!(
        "[Service] cmd shim 未解析到入口: {}",
        cmd_script.display()
    );
    None
}

/// 构建实际启动命令（Windows 下优先绕过 .cmd，避免弹出 CMD 窗口）
///
/// 返回值：
/// - 第一个值：实际可执行程序（program）
/// - 第二个值：实际参数（args）
fn resolve_launch_command(program: &str, args: &[&str]) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        return windows_launch::resolve_launch_command(program, args);
    }

    (
        program.to_string(),
        args.iter().map(|s| (*s).to_string()).collect(),
    )
}

fn format_launch_args_for_log(args: &[String]) -> String {
    if args.is_empty() {
        return "<none>".to_string();
    }
    args.iter()
        .map(|a| {
            if a.contains(' ') {
                format!("\"{}\"", a)
            } else {
                a.clone()
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

fn find_node_executable_for_sidecar() -> Option<std::path::PathBuf> {
    if let Ok(node_from_env) = std::env::var("NUWAX_NODE_EXE") {
        let p = std::path::PathBuf::from(node_from_env);
        if p.exists() {
            return Some(p);
        }
    }

    let path_env = crate::utils::build_node_path_env();
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path_env.split(sep) {
        if dir.trim().is_empty() {
            continue;
        }
        let base = std::path::Path::new(dir);
        let candidates = if cfg!(windows) {
            vec![base.join("node.exe"), base.join("node")]
        } else {
            vec![base.join("node")]
        };
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
    }
    None
}

fn resolve_file_server_sidecar_launch(bin_path: &str) -> Option<(String, Vec<String>)> {
    let bin = std::path::Path::new(bin_path);
    let package_dir = bin
        .parent() // .../node_modules/.bin
        .and_then(|p| p.parent()) // .../node_modules
        .map(|p| p.join("nuwax-file-server"))?;
    let server_js = package_dir.join("dist").join("server.js");
    if !server_js.exists() {
        warn!(
            "[FileServer] sidecar 直启解析失败: 未找到 server.js: {}",
            server_js.display()
        );
        return None;
    }
    let node_exe = find_node_executable_for_sidecar()?;
    Some((
        node_exe.to_string_lossy().to_string(),
        vec![server_js.to_string_lossy().to_string()],
    ))
}

#[cfg(target_os = "windows")]
fn is_file_server_program(program: &str) -> bool {
    let lower = std::path::Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();
    lower == "nuwax-file-server" || lower == "nuwax-file-server.cmd" || lower == "nuwax-file-server.exe"
}

#[cfg(target_os = "windows")]
fn is_cmd_fallback_program(program: &str) -> bool {
    let lower = std::path::Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();
    lower == "cmd.exe" || lower == "cmd"
}

#[cfg(target_os = "windows")]
fn is_file_server_unsafe_windows_program(program: &str) -> bool {
    let p = std::path::Path::new(program);
    let lower_name = p
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();
    let lower_ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    is_cmd_fallback_program(program)
        || lower_ext == "cmd"
        || lower_name == "nuwax-file-server"
        || lower_name == "nuwax-file-server.cmd"
}

/// 获取 nuwax-file-server 的 PID 文件路径
///
/// 跨平台实现：
/// - Unix: /tmp/nuwax-file-server/server.pid
/// - Windows: %TEMP%\nuwax-file-server\server.pid
fn get_file_server_pid_file_path() -> std::path::PathBuf {
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

/// 使用 process_wrap 执行命令，带超时机制
///
/// # Arguments
/// * `program` - 可执行文件路径
/// * `args` - 命令参数
/// * `timeout_secs` - 超时时间（秒）
///
/// # Returns
/// * `bool` - 命令是否成功执行（true = 成功，false = 失败或超时）
async fn run_command_with_timeout(program: &str, args: &[&str], timeout_secs: u64) -> bool {
    let node_path = crate::utils::build_node_path_env();
    let (actual_program, actual_args) = resolve_launch_command(program, args);
    #[cfg(target_os = "windows")]
    {
        if is_file_server_program(program) && is_file_server_unsafe_windows_program(&actual_program) {
            warn!(
                "[FileServer] 硬防线: 禁止不安全启动链路。program={} resolved={} args={}",
                program,
                actual_program,
                format_launch_args_for_log(&actual_args)
            );
            return false;
        }
    }
    debug!(
        "[Service] 运行命令(超时={}s): program={} args={}",
        timeout_secs,
        actual_program,
        format_launch_args_for_log(&actual_args)
    );
    let mut cmd = process_wrap::tokio::CommandWrap::with_new(actual_program.as_str(), |cmd| {
        use crate::utils::CommandNoWindowExt;
        cmd.no_window()
            .env_clear()
            .envs(crate::utils::build_base_env())
            .env("PATH", &node_path);
        for arg in &actual_args {
            cmd.arg(arg);
        }
    });

    // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject + CREATE_NO_WINDOW
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let spawn_result = cmd
        .wrap(process_wrap::tokio::KillOnDrop)
        .wrap(ProcessGroup::leader())
        .spawn();

    #[cfg(target_os = "windows")]
    let spawn_result = cmd
        .wrap(process_wrap::tokio::KillOnDrop)
        .wrap(CreationFlags(CREATE_NO_WINDOW))
        .wrap(JobObject)
        .spawn();

    match spawn_result {
        Ok(mut child) => {
            match tokio::time::timeout(tokio::time::Duration::from_secs(timeout_secs), child.wait())
                .await
            {
                Ok(Ok(status)) => status.success(),
                Ok(Err(e)) => {
                    warn!("Command wait failed: {}", e);
                    false
                }
                Err(_) => {
                    warn!("Command timed out, killing process");
                    let _ = child.start_kill();
                    false
                }
            }
        }
        Err(e) => {
            warn!("Failed to spawn command: {}", e);
            false
        }
    }
}

// ========== 进程检测辅助函数 ==========

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
            .no_window()
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
            .no_window()
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
    if let Ok(content) = std::fs::read_to_string(&pid_file) {
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
            .no_window()
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
            .no_window()
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

    if let Ok(content) = std::fs::read_to_string(&pid_file) {
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
        let _ = std::fs::remove_file(&pid_file);
    }
}

/// 检测并清理残留的 lanproxy 进程，确保只有一个实例运行
async fn kill_stale_lanproxy_processes() {
    if is_process_running_fuzzy("nuwax-lanproxy").await {
        warn!("[Lanproxy] 检测到残留 nuwax-lanproxy 进程，正在终止");
        if let Some(pids) = find_processes_by_prefix("nuwax-lanproxy").await {
            for pid in &pids {
                info!("[Lanproxy] 终止残留进程 PID: {}", pid);
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

/// 清理使用 chrome-devtools-mcp profile 的 Chrome 进程
///
/// 只清理使用特定 profile 的 Chrome 进程，不影响用户正常的 Chrome 使用
async fn kill_chrome_devtools_processes() {
    let profile_path = "chrome-devtools-mcp/chrome-profile";

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // 使用 pgrep 清理包含特定 profile 路径的 Chrome 进程
        let output = tokio::process::Command::new("pgrep")
            .no_window()
            .arg("-f")
            .arg(profile_path)
            .output()
            .await;

        if let Ok(output) = output {
            let pids: Vec<String> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            if !pids.is_empty() {
                warn!("[McpProxy] 检测到 {} 个残留的 Chrome DevTools 进程，正在终止", pids.len());
                for pid in &pids {
                    info!("[McpProxy] 终止残留 Chrome 进程 PID: {}", pid);
                    if let Err(e) = tokio::process::Command::new("kill")
                        .no_window()
                        .arg("-9")
                        .arg(pid)
                        .status()
                        .await
                    {
                        warn!("[McpProxy] 终止进程 {} 失败: {}", pid, e);
                    }
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 wmic 查询包含特定 profile 路径的进程
        let profile_path_win = profile_path.replace("/", "\\\\");
        let output = tokio::process::Command::new("wmic")
            .no_window()
            .args(["process", "where", &format!("CommandLine like '%{}%'", profile_path_win), "get", "ProcessId"])
            .output()
            .await;

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut killed_any = false;
            for line in stdout.lines() {
                // 跳过标题行 "ProcessId"
                if line.trim() == "ProcessId" || line.trim().is_empty() {
                    continue;
                }
                if let Ok(pid) = line.trim().parse::<u32>() {
                    if pid > 0 {
                        warn!("[McpProxy] 终止残留 Chrome 进程 PID: {}", pid);
                        if let Err(e) = tokio::process::Command::new("taskkill")
                            .no_window()
                            .args(["/F", "/PID", &pid.to_string()])
                            .status()
                            .await
                        {
                            warn!("[McpProxy] 终止进程 {} 失败: {}", pid, e);
                        }
                        killed_any = true;
                    }
                }
            }
            if killed_any {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
        }
    }
}

/// 清理孤立的 chrome-devtools-mcp 进程
async fn kill_chrome_devtools_mcp_processes() {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let output = tokio::process::Command::new("pgrep")
            .no_window()
            .arg("-f")
            .arg("chrome-devtools-mcp")
            .output()
            .await;

        if let Ok(output) = output {
            let pids: Vec<String> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            if !pids.is_empty() {
                warn!("[McpProxy] 检测到 {} 个残留的 chrome-devtools-mcp 进程，正在终止", pids.len());
                for pid in &pids {
                    info!("[McpProxy] 终止残留 chrome-devtools-mcp 进程 PID: {}", pid);
                    if let Err(e) = tokio::process::Command::new("kill")
                        .no_window()
                        .arg("-9")
                        .arg(pid)
                        .status()
                        .await
                    {
                        warn!("[McpProxy] 终止进程 {} 失败: {}", pid, e);
                    }
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("wmic")
            .no_window()
            .args(["process", "where", "CommandLine like '%chrome-devtools-mcp%'", "get", "ProcessId"])
            .output()
            .await;

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut killed_any = false;
            for line in stdout.lines() {
                // 跳过标题行 "ProcessId"
                if line.trim() == "ProcessId" || line.trim().is_empty() {
                    continue;
                }
                if let Ok(pid) = line.trim().parse::<u32>() {
                    if pid > 0 {
                        warn!("[McpProxy] 终止残留 chrome-devtools-mcp 进程 PID: {}", pid);
                        if let Err(e) = tokio::process::Command::new("taskkill")
                            .no_window()
                            .args(["/F", "/PID", &pid.to_string()])
                            .status()
                            .await
                        {
                            warn!("[McpProxy] 终止进程 {} 失败: {}", pid, e);
                        }
                        killed_any = true;
                    }
                }
            }
            if killed_any {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            }
        }
    }
}

/// 检测并清理残留的 mcp-proxy 及相关进程
///
/// 清理顺序：
/// 1. Chrome DevTools 相关的 Chrome 进程（使用特定 profile）
/// 2. 孤立的 chrome-devtools-mcp 进程
/// 3. mcp-proxy 进程
async fn kill_stale_mcp_proxy_processes() {
    info!("[McpProxy] 开始清理残留进程...");

    // 1. 清理 Chrome DevTools 相关的 Chrome 进程
    kill_chrome_devtools_processes().await;

    // 2. 清理孤立的 chrome-devtools-mcp 进程
    kill_chrome_devtools_mcp_processes().await;

    // 3. 清理 mcp-proxy 进程
    if is_process_running_fuzzy("mcp-proxy").await {
        warn!("[McpProxy] 检测到残留 mcp-proxy 进程，正在终止");
        if let Some(pids) = find_processes_by_prefix("mcp-proxy").await {
            for pid in &pids {
                info!("[McpProxy] 终止残留进程 PID: {}", pid);
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

    info!("[McpProxy] 残留进程清理完成");
}

/// 等待 MCP Proxy 服务就绪（优先判断端口监听）
async fn wait_for_mcp_proxy_ready(port: u16, host: &str, timeout_secs: u64) -> Result<(), String> {
    use std::time::Duration;
    use tokio::net::TcpStream;
    use tokio::time::{sleep, timeout};

    let start = std::time::Instant::now();
    let timeout_duration = Duration::from_secs(timeout_secs);
    let retry_interval = Duration::from_millis(500);
    // mcp-proxy 常见监听 host=0.0.0.0，此时应使用本机回环地址探活
    let probe_host = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    let probe_addr = format!("{}:{}", probe_host, port);

    loop {
        let healthy = timeout(Duration::from_millis(700), TcpStream::connect(&probe_addr))
            .await
            .ok()
            .and_then(Result::ok)
            .is_some();

        if healthy {
            info!("[McpProxy] 服务就绪 (port {})", port);
            return Ok(());
        }

        if start.elapsed() > timeout_duration {
            return Err(format!(
                "MCP Proxy 健康检查超时: 等待 {}s 后 {} 仍未就绪",
                timeout_secs, probe_addr
            ));
        }

        sleep(retry_interval).await;
    }
}

/// 检测并清理残留的 file-server 进程，确保只有一个实例运行
///
/// # Arguments
/// * `bin_path` - nuwax-file-server 可执行文件的完整路径
async fn kill_stale_file_server_processes(bin_path: &str) {
    if is_file_server_running().await {
        warn!("[FileServer] 检测到残留 nuwax-file-server 进程，正在终止");
        debug!("[FileServer] sidecar 模式优先使用 PID 文件清理残留进程");
        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        // sidecar 直启模式：直接按 PID 文件强制清理
        let _ = bin_path;
        kill_file_server_by_pid().await;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // 最终验证
        if is_file_server_running().await {
            error!("[FileServer] 无法清理残留进程，启动可能失败");
        }
    }
}

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
async fn wait_for_port_ready(port: u16, timeout_secs: u64) -> Result<(), String> {
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

/// 将子进程的 stdout/stderr 管道按行读取并写入 tracing 日志，便于排查崩溃原因。
/// 会 spawn 两个独立任务，不阻塞调用方；管道关闭后任务自然退出。
///
/// # Arguments
/// * `label` - 日志前缀标签，如 "FileServer" 或 "McpProxy"
/// * `stdout` - 子进程的 stdout 管道
/// * `stderr` - 子进程的 stderr 管道
fn spawn_child_output_loggers(
    label: &'static str,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
) {
    if let Some(pipe) = stdout {
        tokio::spawn(async move {
            let mut reader = BufReader::new(pipe);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');
                        if !trimmed.is_empty() {
                            info!("[{} stdout] {}", label, trimmed);
                        }
                    }
                    Err(e) => {
                        debug!("[{} stdout] read error: {}", label, e);
                        break;
                    }
                }
            }
        });
    }
    if let Some(pipe) = stderr {
        tokio::spawn(async move {
            let mut reader = BufReader::new(pipe);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');
                        if !trimmed.is_empty() {
                            warn!("[{} stderr] {}", label, trimmed);
                        }
                    }
                    Err(e) => {
                        debug!("[{} stderr] read error: {}", label, e);
                        break;
                    }
                }
            }
        });
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
            .no_window()
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
            .no_window()
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

/// 服务类型
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceType {
    /// nuwax-file-server 服务
    NuwaxFileServer,
    /// nuwax-lanproxy 服务
    NuwaxLanproxy,
    /// HTTP Server (rcoder) 服务
    Rcoder,
    /// MCP Proxy 服务
    McpProxy,
}

/// 服务状态
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceState {
    /// 停止
    Stopped,
    /// 运行中
    Running,
    /// 启动中
    Starting,
    /// 停止中
    Stopping,
    /// 错误
    Error(String),
}

/// 服务信息
#[derive(Debug, Clone)]
pub struct ServiceInfo {
    /// 服务类型
    pub service_type: ServiceType,
    /// 服务状态
    pub state: ServiceState,
    /// 进程 PID（如果是运行中）
    pub pid: Option<u32>,
}

/// NuwaxFileServer 配置
#[derive(Debug, Clone)]
pub struct NuwaxFileServerConfig {
    /// 可执行文件完整路径
    pub bin_path: String,
    /// 端口
    pub port: u16,
    /// 环境
    pub env: String,
    /// 项目名称
    pub init_project_name: String,
    /// 项目目录
    pub init_project_dir: String,
    /// 上传目录
    pub upload_project_dir: String,
    /// 工作空间目录
    pub project_source_dir: String,
    /// 目标目录
    pub dist_target_dir: String,
    /// 日志基础目录
    pub log_base_dir: String,
    /// 工作空间目录
    pub computer_workspace_dir: String,
    /// 计算机日志目录
    pub computer_log_dir: String,
    /// 是否将 file-server 子进程的 stdout/stderr 捕获并写入 agent 的 tracing 日志（便于排查崩溃）。
    /// 对应 subapp-deployer 的 LOG_CONSOLE_ENABLED：file-server 端控制是否打 console；本项控制 agent 是否接管管道并落盘。
    pub capture_output_to_log: bool,
}

impl Default for NuwaxFileServerConfig {
    /// 默认配置使用跨平台临时/数据目录，兼容 Windows / Linux / macOS。
    /// 实际部署时由 Tauri 客户端根据 workspace_dir 与 app_data_dir 覆盖这些字段。
    fn default() -> Self {
        // 使用系统临时目录下的子目录，避免硬编码 /data、/var 等 Unix 路径
        let base = std::env::temp_dir().join("nuwax-file-server-default");
        Self {
            bin_path: "nuwax-file-server".to_string(),
            port: 60000,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: base.join("init").to_string_lossy().to_string(),
            upload_project_dir: base.join("zips").to_string_lossy().to_string(),
            project_source_dir: base.join("workspace").to_string_lossy().to_string(),
            dist_target_dir: base.join("nginx").to_string_lossy().to_string(),
            log_base_dir: base
                .join("logs")
                .join("project_logs")
                .to_string_lossy()
                .to_string(),
            computer_workspace_dir: base.join("computer").to_string_lossy().to_string(),
            computer_log_dir: base
                .join("logs")
                .join("computer")
                .to_string_lossy()
                .to_string(),
            capture_output_to_log: true,
        }
    }
}

/// NuwaxLanproxy 配置
#[derive(Debug, Clone)]
pub struct NuwaxLanproxyConfig {
    /// 可执行文件完整路径
    pub bin_path: String,
    /// 服务器 IP
    pub server_ip: String,
    /// 服务器端口
    pub server_port: u16,
    /// 客户端密钥
    pub client_key: String,
}

impl Default for NuwaxLanproxyConfig {
    fn default() -> Self {
        Self {
            bin_path: "nuwax-lanproxy".to_string(),
            server_ip: "127.0.0.1".to_string(),
            server_port: 60003,
            client_key: "test_key".to_string(),
        }
    }
}

/// MCP Proxy 配置
#[derive(Debug, Clone)]
pub struct McpProxyConfig {
    /// 可执行文件路径（默认 "mcp-proxy"，假设在 PATH 中）
    pub bin_path: String,
    /// 监听端口（默认 18099）
    pub port: u16,
    /// 监听主机地址（默认 "127.0.0.1"）
    pub host: String,
    /// mcpServers 配置（JSON 字符串，直接传递给 --config 参数）
    pub config_json: String,
    /// Node.js bin 目录路径（可选，用于设置 PATH 环境变量）
    pub node_bin_path: Option<String>,
    /// 日志目录路径（可选）
    pub log_dir: Option<String>,
}

impl Default for McpProxyConfig {
    fn default() -> Self {
        Self {
            bin_path: DEFAULT_MCP_PROXY_BIN.to_string(),
            port: DEFAULT_MCP_PROXY_PORT,
            host: DEFAULT_MCP_PROXY_HOST.to_string(),
            config_json: r#"{"mcpServers":{}}"#.to_string(),
            node_bin_path: None,
            log_dir: None,
        }
    }
}

/// 服务管理器
#[derive(Clone)]
pub struct ServiceManager {
    /// nuwax-file-server 进程（统一使用 process_wrap）
    nuwax_file_server: Arc<Mutex<Option<ChildWrapperType>>>,
    /// nuwax-file-server 配置
    config: Arc<NuwaxFileServerConfig>,
    /// nuwax-lanproxy 进程（使用 process_wrap 进程组）
    lanproxy: Arc<Mutex<Option<ChildWrapperType>>>,
    /// nuwax-lanproxy 配置
    lanproxy_config: Arc<NuwaxLanproxyConfig>,
    /// Rcoder Agent Runner
    rcoder: Arc<Mutex<Option<Arc<RcoderAgentRunner>>>>,
    /// MCP Proxy 进程
    mcp_proxy: Arc<Mutex<Option<ChildWrapperType>>>,
    /// MCP Proxy 配置
    mcp_proxy_config: Arc<McpProxyConfig>,
}

impl ServiceManager {
    /// 创建新的服务管理器
    pub fn new(
        config: Option<NuwaxFileServerConfig>,
        lanproxy_config: Option<NuwaxLanproxyConfig>,
        mcp_proxy_config: Option<McpProxyConfig>,
    ) -> Self {
        Self {
            nuwax_file_server: Arc::new(Mutex::new(None)),
            config: Arc::new(config.unwrap_or_default()),
            lanproxy: Arc::new(Mutex::new(None)),
            lanproxy_config: Arc::new(lanproxy_config.unwrap_or_default()),
            rcoder: Arc::new(Mutex::new(None)),
            mcp_proxy: Arc::new(Mutex::new(None)),
            mcp_proxy_config: Arc::new(mcp_proxy_config.unwrap_or_default()),
        }
    }

    /// 启动 nuwax-file-server（使用内部配置）
    ///
    /// 使用 ServiceManager 初始化时的配置启动文件服务
    pub async fn file_server_start(&self) -> Result<(), String> {
        // 委托给核心方法，使用内部配置（需要解引用 Arc）
        self.file_server_start_with_config((*self.config).clone())
            .await
    }

    /// 停止 nuwax-file-server
    pub async fn file_server_stop(&self) -> Result<(), String> {
        info!("[FileServer] ========== 停止文件服务 ==========");

        // 1. 清理 Rust 持有的启动进程句柄
        {
            let mut guard = self.nuwax_file_server.lock().await;
            if let Some(child) = guard.take() {
                let mut child = child;

                if let Err(e) = child.start_kill() {
                    debug!(
                        "[FileServer] Failed to send kill signal to start process: {}",
                        e
                    );
                }

                use std::time::Duration;
                use tokio::time::timeout;

                match timeout(Duration::from_secs(2), child.wait()).await {
                    Ok(Ok(status)) => {
                        debug!(
                            "[FileServer] Start process exited with status: {:?}",
                            status.code()
                        );
                    }
                    Ok(Err(e)) => {
                        debug!("[FileServer] Error waiting for start process: {}", e);
                    }
                    Err(_) => {
                        debug!("[FileServer] Start process wait timed out");
                    }
                }
            }
        }

        // 2. sidecar 模式：清理历史 PID 文件（兼容旧 daemon 模式）
        info!("[FileServer] 清理残留 PID 进程（如存在）...");
        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
        kill_file_server_by_pid().await;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // 3. 最终验证（仅针对旧 daemon PID 模式）
        if is_file_server_running().await {
            error!("[FileServer] 无法停止 daemon 进程");
            return Err("Failed to stop nuwax-file-server daemon".to_string());
        }

        info!("[FileServer] 文件服务已完全停止");
        Ok(())
    }

    /// 重启 nuwax-file-server
    pub async fn file_server_restart(&self) -> Result<(), String> {
        self.file_server_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.file_server_start().await
    }

    /// 使用指定端口启动 nuwax-file-server
    ///
    /// 该方法允许从外部传入端口参数，用于支持从 Tauri Store 动态读取端口配置
    ///
    /// # Arguments
    /// * `port` - 文件服务端口号
    pub async fn file_server_start_with_port(&self, port: u16) -> Result<(), String> {
        // 基于内部配置创建新配置，仅修改端口
        let config = NuwaxFileServerConfig {
            port,
            ..(*self.config).clone()
        };
        // 委托给核心方法
        self.file_server_start_with_config(config).await
    }

    /// 使用指定配置启动 nuwax-file-server
    ///
    /// 该方法允许从外部传入完整配置，包括 bin_path 和 port
    ///
    /// # Arguments
    /// * `config` - 文件服务配置（包含 bin_path、port 等）
    pub async fn file_server_start_with_config(
        &self,
        config: NuwaxFileServerConfig,
    ) -> Result<(), String> {
        info!("[FileServer] ========== 启动文件服务 ==========");
        // sidecar 生命周期：先清理现有进程句柄和残留 PID 进程，不再依赖 CLI stop 子命令。
        let _ = self.file_server_stop().await;
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

        // 检测并清理残留进程（按 PID 文件等做二次清理）
        kill_stale_file_server_processes(&config.bin_path).await;

        info!("[FileServer] 可执行文件路径: {}", config.bin_path);
        info!("[FileServer] 端口: {}", config.port);

        // 创建必要的目录
        let dirs_to_create = [
            &config.log_base_dir,
            &config.project_source_dir,
            &config.computer_workspace_dir,
            &config.computer_log_dir,
        ];
        for dir in &dirs_to_create {
            if let Err(e) = tokio::fs::create_dir_all(dir).await {
                warn!("[FileServer] 创建目录失败 {}: {}", dir, e);
            } else {
                info!("[FileServer] 确保目录存在: {}", dir);
            }
        }

        let node_path = crate::utils::build_full_path_env();

        let capture_output = config.capture_output_to_log;
        let fallback_args = vec![
            "start".to_string(),
            "--env".to_string(),
            config.env.clone(),
            "--port".to_string(),
            config.port.to_string(),
            format!("--INIT_PROJECT_NAME={}", &config.init_project_name),
            format!("--INIT_PROJECT_DIR={}", &config.init_project_dir),
            format!("--UPLOAD_PROJECT_DIR={}", &config.upload_project_dir),
            format!("--PROJECT_SOURCE_DIR={}", &config.project_source_dir),
            format!("--DIST_TARGET_DIR={}", &config.dist_target_dir),
            format!("--LOG_BASE_DIR={}", &config.log_base_dir),
            format!("--COMPUTER_WORKSPACE_DIR={}", &config.computer_workspace_dir),
            format!("--COMPUTER_LOG_DIR={}", &config.computer_log_dir),
        ];
        let (actual_program, actual_args, sidecar_mode) =
            if let Some((program, args)) = resolve_file_server_sidecar_launch(&config.bin_path) {
                info!("[FileServer] sidecar 直启模式: node + server.js");
                (program, args, true)
            } else {
                let fallback_arg_refs: Vec<&str> = fallback_args.iter().map(String::as_str).collect();
                let (program, args) =
                    resolve_launch_command(config.bin_path.as_str(), &fallback_arg_refs);
                warn!("[FileServer] sidecar 直启解析失败，回退旧 CLI start 模式");
                (program, args, false)
            };
        #[cfg(target_os = "windows")]
        if is_file_server_unsafe_windows_program(&actual_program) {
            let msg = format!(
                "[FileServer] 硬防线触发：Windows 下禁止不安全启动链路。bin_path={} resolved={} args={}",
                config.bin_path,
                actual_program,
                format_launch_args_for_log(&actual_args)
            );
            error!("{}", msg);
            return Err(msg);
        }
        info!(
            "[FileServer] 实际启动命令: program={} args={}",
            actual_program,
            format_launch_args_for_log(&actual_args)
        );

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(actual_program.as_str(), |cmd| {
            use crate::utils::CommandNoWindowExt;
            let cmd = cmd
                .no_window()
                .env_clear()
                .envs(crate::utils::build_base_env())
                .env("PATH", &node_path);
            let cmd = cmd
                .env("NODE_ENV", &config.env)
                .env("PORT", config.port.to_string())
                .env("INIT_PROJECT_NAME", &config.init_project_name)
                .env("INIT_PROJECT_DIR", &config.init_project_dir)
                .env("UPLOAD_PROJECT_DIR", &config.upload_project_dir)
                .env("PROJECT_SOURCE_DIR", &config.project_source_dir)
                .env("DIST_TARGET_DIR", &config.dist_target_dir)
                .env("LOG_BASE_DIR", &config.log_base_dir)
                .env("COMPUTER_WORKSPACE_DIR", &config.computer_workspace_dir)
                .env("COMPUTER_LOG_DIR", &config.computer_log_dir);
            let cmd = if capture_output {
                cmd.stdout(Stdio::piped()).stderr(Stdio::piped())
            } else {
                cmd.stdout(Stdio::null()).stderr(Stdio::null())
            };
            for arg in &actual_args {
                cmd.arg(arg);
            }
        });

        // 注意顺序：先 KillOnDrop，后 ProcessGroup/JobObject
        // KillOnDrop 在外层，确保 drop 时能杀死整个进程组
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let mut child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(ProcessGroup::leader())
            .spawn()
            .map_err(|e| {
                error!("[FileServer] 启动失败: {}", e);
                format!("Failed to start nuwax-file-server: {}", e)
            })?;

        #[cfg(target_os = "windows")]
        let mut child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(CreationFlags(CREATE_NO_WINDOW)) // 禁止弹出控制台窗口
            .wrap(JobObject)
            .spawn()
            .map_err(|e| {
                error!("[FileServer] 启动失败: {}", e);
                format!("Failed to start nuwax-file-server: {}", e)
            })?;

        if capture_output {
            let stdout = child.stdout().take();
            let stderr = child.stderr().take();
            spawn_child_output_loggers("FileServer", stdout, stderr);
        }

        {
            let mut guard = self.nuwax_file_server.lock().await;
            *guard = Some(child);
        }

        // 等待端口就绪
        if let Err(e) = wait_for_port_ready(config.port, 10).await {
            error!("[FileServer] 端口就绪检查失败: {}", e);

            // 端口检查失败，清理已存储的 child
            if let Ok(mut guard) = self.nuwax_file_server.try_lock() {
                let _ = guard.take();
            }

            // sidecar 直启失败时，不再依赖 CLI stop；仅清理 PID 文件残留。
            if sidecar_mode {
                kill_file_server_by_pid().await;
            } else {
                run_command_with_timeout(&config.bin_path, &["stop"], 5).await;
            }

            return Err(e);
        }

        info!("[FileServer] 进程启动成功");
        Ok(())
    }

    /// 启动 nuwax-lanproxy
    ///
    /// 使用 process_wrap 进程组方式启动，确保子进程不会成为僵尸进程
    /// - Unix/Linux/macOS: 使用 ProcessGroup::leader()
    /// - Windows: 使用 JobObject::new()
    /// - 双重保障: kill_on_drop 确保进程被正确终止
    ///
    /// TODO: 从 Tauri store 读取配置
    /// 需要前端定义 store 中的配置字段名，如:
    /// - nuwax-lanproxy.server_ip: 服务器 IP
    /// - nuwax-lanproxy.server_port: 服务器端口
    /// - nuwax-lanproxy.client_key: 客户端密钥
    pub async fn lanproxy_start(&self) -> Result<(), String> {
        info!("Starting nuwax-lanproxy...");

        // 检测并清理残留进程
        kill_stale_lanproxy_processes().await;

        // TODO: 从 store 读取配置
        // let server_ip: String = store.get("nuwax-lanproxy.server_ip").unwrap_or_default();
        // let server_port: u16 = store.get("nuwax-lanproxy.server_port").unwrap_or_default();
        // let client_key: String = store.get("nuwax-lanproxy.client_key").unwrap_or_default();

        // 使用配置中的完整路径
        let lanproxy_bin = &self.lanproxy_config.bin_path;
        info!("[Lanproxy] 使用可执行文件路径: {}", lanproxy_bin);

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(lanproxy_bin.as_str(), |cmd| {
            use crate::utils::CommandNoWindowExt;
            cmd.no_window()
                .arg("-s")
                .arg(&self.lanproxy_config.server_ip);
            cmd.arg("-p")
                .arg(self.lanproxy_config.server_port.to_string());
            cmd.arg("-k").arg(&self.lanproxy_config.client_key);
            cmd.arg("--ssl=true");
        });

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        // 注意顺序：先 KillOnDrop，后 ProcessGroup/JobObject
        // KillOnDrop 在外层，确保 drop 时能杀死整个进程组
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(ProcessGroup::leader())
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-lanproxy: {}", e))?;

        #[cfg(target_os = "windows")]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(CreationFlags(CREATE_NO_WINDOW)) // 禁止弹出控制台窗口
            .wrap(JobObject)
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-lanproxy: {}", e))?;

        let mut guard = self.lanproxy.lock().await;
        *guard = Some(child);

        info!("nuwax-lanproxy started successfully");
        Ok(())
    }

    /// 停止 nuwax-lanproxy
    pub async fn lanproxy_stop(&self) -> Result<(), String> {
        info!("Stopping nuwax-lanproxy...");

        let mut guard = self.lanproxy.lock().await;
        if let Some(child) = guard.take() {
            // 使用 process_wrap 的 kill 方法
            // 使用 start_kill() 发送终止信号，然后用 wait() 等待退出
            let mut child = child;

            // 发送 kill 信号，如果进程已退出可能会失败（ESRCH）
            if let Err(e) = child.start_kill() {
                // 进程可能已经退出，尝试等待获取最终状态
                warn!("Failed to send kill signal, process may have exited: {}", e);
            }

            // 等待进程退出，带超时
            use std::time::Duration;
            use tokio::time::timeout;

            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    if status.success() {
                        info!("nuwax-lanproxy stopped gracefully");
                    } else {
                        info!("nuwax-lanproxy stopped with exit code: {:?}", status.code());
                    }
                }
                Ok(Err(e)) => {
                    warn!("Error waiting for nuwax-lanproxy: {}", e);
                }
                Err(_) => {
                    warn!("nuwax-lanproxy stop timed out, process may still be terminating");
                }
            }
        } else {
            warn!("nuwax-lanproxy is not running");
        }

        Ok(())
    }

    /// 重启 nuwax-lanproxy
    pub async fn lanproxy_restart(&self) -> Result<(), String> {
        self.lanproxy_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.lanproxy_start().await
    }

    /// 使用指定配置启动 nuwax-lanproxy
    pub async fn lanproxy_start_with_config(
        &self,
        config: NuwaxLanproxyConfig,
    ) -> Result<(), String> {
        info!("[Lanproxy] ========== 启动代理服务 ==========");

        // 检测并清理残留进程
        kill_stale_lanproxy_processes().await;

        info!("[Lanproxy] 可执行文件路径: {}", config.bin_path);
        info!(
            "[Lanproxy] 服务器地址: {}:{}",
            config.server_ip, config.server_port
        );
        info!(
            "[Lanproxy] 客户端密钥: {}****{}",
            &config.client_key[..config
                .client_key
                .len()
                .saturating_sub(4)
                .min(config.client_key.len())],
            if config.client_key.len() > 4 {
                &config.client_key[config.client_key.len() - 4..]
            } else {
                "****"
            }
        );

        // 打印完整启动命令
        info!(
            "[Lanproxy] 启动命令: {} -s {} -p {} -k {} --ssl=true",
            config.bin_path, config.server_ip, config.server_port, config.client_key
        );

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(config.bin_path.as_str(), |cmd| {
            use crate::utils::CommandNoWindowExt;
            cmd.no_window().arg("-s").arg(&config.server_ip);
            cmd.arg("-p").arg(config.server_port.to_string());
            cmd.arg("-k").arg(&config.client_key);
            cmd.arg("--ssl=true");
        });

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        // 注意顺序：先 KillOnDrop，后 ProcessGroup/JobObject
        // KillOnDrop 在外层，确保 drop 时能杀死整个进程组
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(ProcessGroup::leader())
            .spawn()
            .map_err(|e| {
                error!("[Lanproxy] 启动失败: {}", e);
                format!("Failed to start nuwax-lanproxy: {}", e)
            })?;

        #[cfg(target_os = "windows")]
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(CreationFlags(CREATE_NO_WINDOW)) // 禁止弹出控制台窗口
            .wrap(JobObject)
            .spawn()
            .map_err(|e| {
                error!("[Lanproxy] 启动失败: {}", e);
                format!("Failed to start nuwax-lanproxy: {}", e)
            })?;

        {
            let mut guard = self.lanproxy.lock().await;
            *guard = Some(child);
        }

        // 等待进程初始化（lanproxy 是客户端，无本地端口可检查）
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // 检查进程是否还在运行（未立即退出）
        {
            let guard = self.lanproxy.lock().await;
            if let Some(ref child) = *guard {
                if child.id().is_none() {
                    drop(guard);
                    // 清理已存储的 child
                    if let Ok(mut guard) = self.lanproxy.try_lock() {
                        let _ = guard.take();
                    }
                    return Err("[Lanproxy] 进程启动后立即退出，请检查配置".to_string());
                }
            }
        }

        info!("[Lanproxy] 进程启动成功");
        Ok(())
    }

    /// 使用指定配置启动 MCP Proxy
    pub async fn mcp_proxy_start_with_config(&self, config: McpProxyConfig) -> Result<(), String> {
        info!("[McpProxy] ========== 启动 MCP Proxy 服务 ==========");
        info!("[McpProxy] 配置: bin_path={}, port={}, host={}, config_json={}, node_bin_path={:?}, log_dir={:?}", 
              config.bin_path, config.port, config.host, config.config_json, config.node_bin_path, config.log_dir);

        // 检测并清理残留进程
        kill_stale_mcp_proxy_processes().await;

        info!("[McpProxy] 可执行文件路径: {}", config.bin_path);
        info!("[McpProxy] 监听地址: {}:{}", config.host, config.port);
        if let Some(log_dir) = config.log_dir.as_deref() {
            info!("[McpProxy] 日志目录: {}", log_dir);
        }

        let port_str = config.port.to_string();

        // 构建 PATH 环境变量
        let node_path = {
            let mut base = crate::utils::build_full_path_env();

            // 如果提供了 node_bin_path，添加到 PATH 最前面（优先）
            if let Some(ref node_bin) = config.node_bin_path {
                if !node_bin.is_empty() {
                    info!("[McpProxy] 添加 Node.js bin 到 PATH 最前面: {}", node_bin);
                    let sep = if cfg!(windows) { ";" } else { ":" };
                    base = format!("{}{}{}", node_bin, sep, base);
                }
            }

            base
        };

        let mcp_args = {
            let mut args = vec![
                "proxy".to_string(),
                "--port".to_string(),
                port_str.clone(),
                "--host".to_string(),
                config.host.clone(),
                "--config".to_string(),
                config.config_json.clone(),
            ];
            if cfg!(debug_assertions) {
                // proxy 子命令在前，-v/--diagnostic 紧接其后：mcp-proxy proxy -v --diagnostic ...
                args.insert(1, "--diagnostic".to_string());
                args.insert(1, "-v".to_string());
            }
            args
        };
        let mut mcp_args = mcp_args;
        if let Some(log_dir) = config.log_dir.as_deref().map(str::trim) {
            if !log_dir.is_empty() {
                // 提前确保目录存在，避免 mcp-proxy 因日志目录不存在而启动失败
                if let Err(e) = tokio::fs::create_dir_all(log_dir).await {
                    warn!("[McpProxy] 创建日志目录失败 {}: {}", log_dir, e);
                }
                mcp_args.push("--log-dir".to_string());
                mcp_args.push(log_dir.to_string());
            }
        }
        let mcp_arg_refs: Vec<&str> = mcp_args.iter().map(String::as_str).collect();
        let (actual_program, actual_args) =
            resolve_launch_command(config.bin_path.as_str(), &mcp_arg_refs);
        info!(
            "[McpProxy] 实际启动命令: program={} args={}",
            actual_program,
            format_launch_args_for_log(&actual_args)
        );

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(actual_program.as_str(), |cmd| {
            use crate::utils::CommandNoWindowExt;
            let cmd = cmd
                .no_window()
                .env_clear()
                .envs(crate::utils::build_base_env())
                .env("PATH", &node_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            for arg in &actual_args {
                cmd.arg(arg);
            }
        });

        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let mut child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(ProcessGroup::leader())
            .spawn()
            .map_err(|e| {
                error!("[McpProxy] 启动失败: {}", e);
                format!("Failed to start mcp-proxy: {}", e)
            })?;

        #[cfg(target_os = "windows")]
        let mut child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .wrap(CreationFlags(CREATE_NO_WINDOW)) // 禁止弹出控制台窗口
            .wrap(JobObject)
            .spawn()
            .map_err(|e| {
                error!("[McpProxy] 启动失败: {}", e);
                format!("Failed to start mcp-proxy: {}", e)
            })?;

        // 捕获 mcp-proxy 的 stdout/stderr 输出到日志
        {
            let stdout = child.stdout().take();
            let stderr = child.stderr().take();
            spawn_child_output_loggers("McpProxy", stdout, stderr);
        }

        {
            let mut guard = self.mcp_proxy.lock().await;
            *guard = Some(child);
        }

        // 等待进程初始化
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // 检查进程是否还在运行（未立即退出）
        {
            let guard = self.mcp_proxy.lock().await;
            if let Some(ref child) = *guard {
                if child.id().is_none() {
                    drop(guard);
                    if let Ok(mut guard) = self.mcp_proxy.try_lock() {
                        let _ = guard.take();
                    }
                    return Err(
                        "[McpProxy] 进程启动后立即退出，请检查配置或 mcp-proxy 可执行文件"
                            .to_string(),
                    );
                }
            }
        }

        // 使用 mcp-proxy health 命令检查服务就绪
        if let Err(e) = wait_for_mcp_proxy_ready(config.port, &config.host, 15).await {
            error!("[McpProxy] 健康检查失败: {}", e);
            if let Ok(mut guard) = self.mcp_proxy.try_lock() {
                let _ = guard.take();
            }
            return Err(e);
        }

        info!("[McpProxy] 进程启动成功");
        Ok(())
    }

    /// 启动 MCP Proxy（使用内部配置）
    pub async fn mcp_proxy_start(&self) -> Result<(), String> {
        self.mcp_proxy_start_with_config((*self.mcp_proxy_config).clone())
            .await
    }

    /// 停止 MCP Proxy
    pub async fn mcp_proxy_stop(&self) -> Result<(), String> {
        info!("[McpProxy] 正在停止 MCP Proxy...");

        let mut guard = self.mcp_proxy.lock().await;
        if let Some(child) = guard.take() {
            let mut child = child;

            if let Err(e) = child.start_kill() {
                warn!(
                    "[McpProxy] Failed to send kill signal, process may have exited: {}",
                    e
                );
            }

            use std::time::Duration;
            use tokio::time::timeout;

            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    if status.success() {
                        info!("[McpProxy] MCP Proxy stopped gracefully");
                    } else {
                        info!(
                            "[McpProxy] MCP Proxy stopped with exit code: {:?}",
                            status.code()
                        );
                    }
                }
                Ok(Err(e)) => {
                    warn!("[McpProxy] Error waiting for mcp-proxy: {}", e);
                }
                Err(_) => {
                    warn!("[McpProxy] MCP Proxy stop timed out");
                }
            }
        } else {
            warn!("[McpProxy] MCP Proxy is not running");
        }

        // 停止后清理可能残留的 Chrome DevTools 进程
        kill_chrome_devtools_processes().await;

        Ok(())
    }

    /// 重启 MCP Proxy
    pub async fn mcp_proxy_restart(&self) -> Result<(), String> {
        self.mcp_proxy_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.mcp_proxy_start().await
    }

    /// 启动 Rcoder Agent Runner
    ///
    /// 接受外部创建的 RcoderAgentRunner 实例
    /// 如果已有运行中的实例，先停止再替换
    pub async fn rcoder_start(
        &self,
        port: u16,
        agent_runner: Arc<RcoderAgentRunner>,
    ) -> Result<(), String> {
        info!("[Rcoder] 正在启动 Agent Runner (port={})...", port);

        let mut guard = self.rcoder.lock().await;

        // 如果已有 runner，确保停止后再替换
        if let Some(ref old_runner) = *guard {
            info!("[Rcoder] 停止旧的 Agent Runner...");
            old_runner.shutdown().await;
        }

        *guard = Some(agent_runner);

        info!("[Rcoder] Agent Runner 已启动");
        Ok(())
    }

    /// 停止 Rcoder Agent Runner
    pub async fn rcoder_stop(&self) -> Result<(), String> {
        info!("[Rcoder] 正在停止 Agent Runner...");

        let mut guard = self.rcoder.lock().await;
        if let Some(ref runner) = *guard {
            runner.shutdown().await;
            info!("[Rcoder] Agent Runner 已停止");
        } else {
            info!("[Rcoder] Agent Runner 未运行");
        }
        *guard = None;

        Ok(())
    }

    /// 重启 Rcoder Agent Runner
    pub async fn rcoder_restart(&self, config: RcoderAgentRunnerConfig) -> Result<(), String> {
        info!("[Rcoder] 正在重启 Agent Runner...");

        let mut guard = self.rcoder.lock().await;

        // 先停止旧的
        if let Some(ref old_runner) = *guard {
            old_runner.shutdown().await;
        }

        // 创建并启动新的
        let mut runner = RcoderAgentRunner::new(config);
        runner.start().await?;
        *guard = Some(Arc::new(runner));

        info!("[Rcoder] Agent Runner 重启完成");
        Ok(())
    }

    /// 停止所有服务
    pub async fn services_stop_all(&self) -> Result<(), String> {
        info!("[Services] ========== 停止所有服务 ==========");

        info!("[Services] 1/4 停止 Agent 服务 (rcoder)...");
        if let Err(e) = self.rcoder_stop().await {
            warn!("[Services]   - Agent 服务停止失败: {}", e);
        } else {
            info!("[Services]   - Agent 服务已停止");
        }

        info!("[Services] 2/4 停止文件服务 (nuwax-file-server)...");
        if let Err(e) = self.file_server_stop().await {
            warn!("[Services]   - 文件服务停止失败: {}", e);
        } else {
            info!("[Services]   - 文件服务已停止");
        }

        info!("[Services] 3/4 停止代理服务 (nuwax-lanproxy)...");
        if let Err(e) = self.lanproxy_stop().await {
            warn!("[Services]   - 代理服务停止失败: {}", e);
        } else {
            info!("[Services]   - 代理服务已停止");
        }

        info!("[Services] 4/4 停止 MCP Proxy 服务...");
        if let Err(e) = self.mcp_proxy_stop().await {
            warn!("[Services]   - MCP Proxy 停止失败: {}", e);
        } else {
            info!("[Services]   - MCP Proxy 已停止");
        }

        info!("[Services] ========== 所有服务停止完成 ==========");
        Ok(())
    }

    /// 重启所有服务
    pub async fn services_restart_all(
        &self,
        rcoder_config: RcoderAgentRunnerConfig,
    ) -> Result<(), String> {
        info!("Restarting all services...");

        self.services_stop_all().await?;

        let mut runner = RcoderAgentRunner::new(rcoder_config);
        runner.start().await?;
        let agent_runner = Arc::new(runner);
        self.rcoder_start(0, agent_runner).await?;
        self.file_server_start().await?;
        self.lanproxy_start().await?;
        self.mcp_proxy_start().await?;

        info!("All services restarted");
        Ok(())
    }

    /// 获取所有服务状态
    pub async fn services_status_all(&self) -> Vec<ServiceInfo> {
        self.get_all_status().await
    }

    /// 获取所有服务状态（别名方法）
    pub async fn get_all_status(&self) -> Vec<ServiceInfo> {
        let mut statuses = Vec::new();

        // nuwax-file-server 状态
        // 注意：nuwax-file-server 是 daemon 模式，start 命令会 fork 出独立进程后退出
        // 所以这里不返回 PID（实际 daemon 的 PID 需要通过 nuwax-file-server status 获取）
        {
            let guard = self.nuwax_file_server.lock().await;
            if guard.is_some() {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxFileServer,
                    state: ServiceState::Running,
                    pid: None, // daemon 模式不返回启动命令的 PID
                });
                debug!("[Services] 文件服务运行中");
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxFileServer,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] 文件服务已停止");
            }
        }

        // nuwax-lanproxy 状态
        {
            let guard = self.lanproxy.lock().await;
            if let Some(child) = &*guard {
                // process_wrap::tokio::ChildWrapper.id() 返回 Option<u32>
                let pid = child.id();
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxLanproxy,
                    state: ServiceState::Running,
                    pid,
                });
                debug!("[Services] 代理服务运行中, PID: {:?}", pid);
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxLanproxy,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] 代理服务已停止");
            }
        }

        // Rcoder Agent Runner 状态
        {
            let guard = self.rcoder.lock().await;
            let state = if let Some(ref runner) = *guard {
                if runner.is_running() {
                    ServiceState::Running
                } else {
                    ServiceState::Stopped
                }
            } else {
                ServiceState::Stopped
            };
            statuses.push(ServiceInfo {
                service_type: ServiceType::Rcoder,
                state,
                pid: None,
            });
            debug!(
                "[Services] Agent 服务状态: {:?}",
                statuses.last().unwrap().state
            );
        }

        // MCP Proxy 状态
        {
            let guard = self.mcp_proxy.lock().await;
            if let Some(child) = &*guard {
                let pid = child.id();
                statuses.push(ServiceInfo {
                    service_type: ServiceType::McpProxy,
                    state: ServiceState::Running,
                    pid,
                });
                debug!("[Services] MCP Proxy 运行中, PID: {:?}", pid);
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::McpProxy,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] MCP Proxy 已停止");
            }
        }

        statuses
    }
}

//! FileServer 服务管理模块
//!
//! 负责 nuwax-file-server 的启动、停止、重启逻辑

use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tracing::{debug, error, info, warn};

use super::config::NuwaxFileServerConfig;
use super::health::wait_for_port_ready;
use super::process::kill_stale_file_server_processes;
use super::utils::{run_command_with_timeout, spawn_wrapped, stop_child_process};

/// 将 file-server 子进程的 stdout/stderr 管道按行读取并写入 tracing 日志，便于排查崩溃原因。
/// 会 spawn 两个独立任务，不阻塞调用方；管道关闭后任务自然退出。
fn spawn_file_server_output_loggers(
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
                            info!("[FileServer stdout] {}", trimmed);
                        }
                    }
                    Err(e) => {
                        debug!("[FileServer stdout] read error: {}", e);
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
                            warn!("[FileServer stderr] {}", trimmed);
                        }
                    }
                    Err(e) => {
                        debug!("[FileServer stderr] read error: {}", e);
                        break;
                    }
                }
            }
        });
    }
}

/// 停止 nuwax-file-server
pub(crate) async fn stop(manager: &super::ServiceManager) -> Result<(), String> {
    info!("Stopping nuwax-file-server...");

    let mut guard = manager.nuwax_file_server.lock().await;
    if let Some(child) = guard.take() {
        drop(guard);
        stop_child_process(child, "FileServer").await
    } else {
        warn!("nuwax-file-server is not running");
        Ok(())
    }
}

/// 使用指定配置启动 nuwax-file-server
pub(crate) async fn start_with_config(
    manager: &super::ServiceManager,
    config: NuwaxFileServerConfig,
) -> Result<(), String> {
    info!("[FileServer] ========== Starting File Service ==========");

    // 启动前先执行一次 stop，清理可能存在的 daemon（避免「服务已在运行中 (PID: xxx)」导致 start 直接退出）
    let stop_ok = run_command_with_timeout(&config.bin_path, &["stop"], 5).await;
    if stop_ok {
        debug!("[FileServer] Pre-start stop succeeded");
    } else {
        // stop 失败或超时不阻塞启动（可能本来就没有在跑）
        debug!("[FileServer] Pre-start stop failed or timed out, continuing startup");
    }
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 检测并清理残留进程（按 PID 文件等做二次清理）
    kill_stale_file_server_processes(&config.bin_path).await;

    info!("[FileServer] Executable path: {}", config.bin_path);
    info!("[FileServer] Port: {}", config.port);

    // 创建必要的目录
    let dirs_to_create = [
        &config.project_source_dir,
        &config.computer_workspace_dir,
        &config.computer_log_dir,
    ];
    for dir in &dirs_to_create {
        if let Err(e) = tokio::fs::create_dir_all(dir).await {
            warn!("[FileServer] Failed to create directory {}: {}", dir, e);
        } else {
            info!("[FileServer] Ensured directory exists: {}", dir);
        }
    }

    let capture_output = config.capture_output_to_log;
    let cmd = process_wrap::tokio::CommandWrap::with_new(config.bin_path.as_str(), |cmd| {
        let cmd = if capture_output {
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped())
        } else {
            cmd.stdout(Stdio::null()).stderr(Stdio::null())
        };
        cmd.arg("start")
            .arg("--env")
            .arg(&config.env)
            .arg("--port")
            .arg(config.port.to_string())
            // 通过命令行参数传递配置 (--KEY=VALUE 格式，loadEnvFromArgv 要求 -- 前缀)
            .arg(format!("--INIT_PROJECT_NAME={}", &config.init_project_name))
            .arg(format!("--INIT_PROJECT_DIR={}", &config.init_project_dir))
            .arg(format!(
                "--UPLOAD_PROJECT_DIR={}",
                &config.upload_project_dir
            ))
            .arg(format!(
                "--PROJECT_SOURCE_DIR={}",
                &config.project_source_dir
            ))
            .arg(format!("--DIST_TARGET_DIR={}", &config.dist_target_dir))
            .arg(format!("--LOG_BASE_DIR={}", &config.log_base_dir))
            .arg(format!(
                "--COMPUTER_WORKSPACE_DIR={}",
                &config.computer_workspace_dir
            ))
            .arg(format!("--COMPUTER_LOG_DIR={}", &config.computer_log_dir));
    });

    // 跨平台 spawn
    let mut child = spawn_wrapped(cmd, "nuwax-file-server")?;

    if capture_output {
        let stdout = child.stdout().take();
        let stderr = child.stderr().take();
        spawn_file_server_output_loggers(stdout, stderr);
    }

    {
        let mut guard = manager.nuwax_file_server.lock().await;
        *guard = Some(child);
    }

    // 等待端口就绪
    if let Err(e) = wait_for_port_ready(config.port, 10).await {
        error!("[FileServer] Port readiness check failed: {}", e);

        // 端口检查失败，清理已存储的 child
        let mut guard = manager.nuwax_file_server.lock().await;
        let _ = guard.take();
        drop(guard);

        // 使用 process_wrap 停止可能已启动的 daemon
        run_command_with_timeout(&config.bin_path, &["stop"], 5).await;

        return Err(e);
    }

    info!("[FileServer] Process started successfully");
    Ok(())
}

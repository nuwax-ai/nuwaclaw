//! 通用工具函数模块
//!
//! 提供命令执行、日志捕获等通用工具

use tracing::{info, warn};

use super::types::ChildWrapperType;

/// 使用 process_wrap 执行命令，带超时机制
///
/// # Arguments
/// * `program` - 可执行文件路径
/// * `args` - 命令参数
/// * `timeout_secs` - 超时时间（秒）
///
/// # Returns
/// * `bool` - 命令是否成功执行（true = 成功，false = 失败或超时）
pub(crate) async fn run_command_with_timeout(program: &str, args: &[&str], timeout_secs: u64) -> bool {
    let mut cmd = process_wrap::tokio::CommandWrap::with_new(program, |cmd| {
        for arg in args {
            cmd.arg(*arg);
        }
    });

    match cmd.wrap(process_wrap::tokio::KillOnDrop).spawn() {
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

/// 通用的子进程停止函数
///
/// # Arguments
/// * `child` - 要停止的子进程
/// * `service_name` - 服务名称（用于日志）
///
/// # Returns
/// * `Ok(())` - 停止成功
/// * `Err(String)` - 停止失败
pub(crate) async fn stop_child_process(
    mut child: ChildWrapperType,
    service_name: &str,
) -> Result<(), String> {
    if let Err(e) = child.start_kill() {
        warn!(
            "[{}] Failed to send kill signal, process may have exited: {}",
            service_name, e
        );
    }

    use std::time::Duration;
    use tokio::time::timeout;

    match timeout(Duration::from_secs(5), child.wait()).await {
        Ok(Ok(status)) => {
            if status.success() {
                info!("[{}] Process stopped gracefully", service_name);
            } else {
                info!(
                    "[{}] Process stopped with exit code: {:?}",
                    service_name,
                    status.code()
                );
            }
            Ok(())
        }
        Ok(Err(e)) => {
            warn!("[{}] Error waiting for process: {}", service_name, e);
            Ok(())
        }
        Err(_) => {
            warn!("[{}] Process stop timed out", service_name);
            Ok(())
        }
    }
}

/// 跨平台的进程 spawn 包装函数
///
/// # Arguments
/// * `cmd` - 要执行的命令
/// * `service_name` - 服务名称（用于错误消息）
///
/// # Returns
/// * `Ok(ChildWrapperType)` - 成功启动的进程
/// * `Err(String)` - 启动失败
pub(crate) fn spawn_wrapped(
    mut cmd: process_wrap::tokio::CommandWrap,
    service_name: &str,
) -> Result<ChildWrapperType, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        cmd.wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::ProcessGroup::leader())
            .spawn()
            .map_err(|e| format!("Failed to start {}: {}", service_name, e))
    }

    #[cfg(target_os = "windows")]
    {
        cmd.wrap(process_wrap::tokio::KillOnDrop)
            .wrap(process_wrap::tokio::JobObject)
            .spawn()
            .map_err(|e| format!("Failed to start {}: {}", service_name, e))
    }
}

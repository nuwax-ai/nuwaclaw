//! Lanproxy 服务管理模块
//!
//! 负责 nuwax-lanproxy 的启动、停止、重启逻辑

use tracing::{info, warn};

use super::config::NuwaxLanproxyConfig;
use super::process::kill_stale_lanproxy_processes;
use super::utils::{spawn_wrapped, stop_child_process};

/// 停止 nuwax-lanproxy
pub(crate) async fn stop(manager: &super::ServiceManager) -> Result<(), String> {
    info!("Stopping nuwax-lanproxy...");

    let mut guard = manager.lanproxy.lock().await;
    if let Some(child) = guard.take() {
        drop(guard);
        stop_child_process(child, "Lanproxy").await
    } else {
        warn!("nuwax-lanproxy is not running");
        Ok(())
    }
}

/// 使用指定配置启动 nuwax-lanproxy
pub(crate) async fn start_with_config(
    manager: &super::ServiceManager,
    config: NuwaxLanproxyConfig,
) -> Result<(), String> {
    info!("[Lanproxy] ========== Starting Proxy Service ==========");

    // 检测并清理残留进程
    kill_stale_lanproxy_processes().await;

    info!("[Lanproxy] Executable path: {}", config.bin_path);
    info!(
        "[Lanproxy] Server address: {}:{}",
        config.server_ip, config.server_port
    );

    // 安全的密钥掩码处理（防止 UTF-8 边界 panic）
    let masked_key = if config.client_key.len() > 8 {
        let chars: Vec<char> = config.client_key.chars().collect();
        let prefix_len = 4.min(chars.len());
        let suffix_len = 4.min(chars.len());
        let prefix: String = chars.iter().take(prefix_len).collect();
        let suffix: String = chars.iter().skip(chars.len().saturating_sub(suffix_len)).collect();
        format!("{}****{}", prefix, suffix)
    } else {
        "****".to_string()
    };
    info!("[Lanproxy] Client key: {}", masked_key);

    let cmd = process_wrap::tokio::CommandWrap::with_new(config.bin_path.as_str(), |cmd| {
        cmd.arg("-s")
            .arg(&config.server_ip)
            .arg("-p")
            .arg(config.server_port.to_string())
            .arg("-k")
            .arg(&config.client_key)
            .arg("--ssl=true");
    });

    // 跨平台 spawn
    let child = spawn_wrapped(cmd, "nuwax-lanproxy")?;

    {
        let mut guard = manager.lanproxy.lock().await;
        *guard = Some(child);
    }

    // 等待进程初始化（lanproxy 是客户端，无本地端口可检查）
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 检查进程是否还在运行（未立即退出）
    {
        let mut guard = manager.lanproxy.lock().await;
        if let Some(ref child) = *guard {
            if child.id().is_none() {
                // 进程已退出，清理
                let _ = guard.take();
                return Err("[Lanproxy] Process exited immediately after start, check configuration".to_string());
            }
        }
    }

    info!("[Lanproxy] Process started successfully");
    Ok(())
}

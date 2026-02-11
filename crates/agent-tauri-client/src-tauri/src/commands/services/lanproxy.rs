use crate::state::*;
use crate::utils::*;
use tauri_plugin_shell::ShellExt;

/// 启动 nuwax-lanproxy 客户端（使用 Tauri sidecar API）
///
/// 从 Tauri store 读取配置后，使用 app.shell().sidecar() 启动进程
#[tauri::command]
pub async fn lanproxy_start(
    app: tauri::AppHandle,
    lanproxy_state: tauri::State<'_, LanproxyState>,
) -> Result<bool, String> {
    info!("[Lanproxy] ========== Starting Proxy Service (via Tauri sidecar) ==========");

    // 1. 从 store 读取配置
    let server_host = match read_store_string(&app, "lanproxy.server_host") {
        Ok(Some(host)) => {
            info!("[Lanproxy] server_host: {}", host);
            host
        }
        Ok(None) => {
            let err = "配置缺失: lanproxy.server_host - 请先登录以获取服务器配置";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 lanproxy.server_host 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };
    let server_ip = strip_host_from_url(&server_host);
    info!("[Lanproxy] server_ip (processed): {}", server_ip);

    let server_port = match read_store_port(&app, "lanproxy.server_port") {
        Ok(Some(port)) => {
            info!("[Lanproxy] server_port: {}", port);
            port
        }
        Ok(None) => {
            let err = "配置缺失: lanproxy.server_port - 请先登录以获取服务器配置";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 lanproxy.server_port 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };

    let client_key = match read_store_string(&app, "auth.saved_key") {
        Ok(Some(key)) => {
            // 安全的密钥掩码处理
            let masked = if key.len() > 8 {
                format!("{}****{}", &key[..4], &key[key.len() - 4..])
            } else {
                "****".to_string()
            };
            info!("[Lanproxy] client_key: {}", masked);
            key
        }
        Ok(None) => {
            let err = "配置缺失: auth.saved_key - 请先登录/注册以获取客户端密钥";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 auth.saved_key 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };

    // 2. 检测并清理残留进程（使用 core 层的公开函数）
    info!("[Lanproxy] 检测残留进程...");
    nuwax_agent_core::kill_stale_lanproxy_processes().await;

    // 3. 使用 Tauri sidecar API 启动
    info!("[Lanproxy] 使用 Tauri sidecar API 启动进程...");
    let sidecar_cmd = app.shell().sidecar("nuwax-lanproxy").map_err(|e| {
        let err = format!("创建 sidecar 命令失败: {}", e);
        error!("[Lanproxy] {}", err);
        err
    })?;

    let (rx, child) = sidecar_cmd
        .args([
            "-s",
            &server_ip,
            "-p",
            &server_port.to_string(),
            "-k",
            &client_key,
            "--ssl=true",
        ])
        .spawn()
        .map_err(|e| {
            let err = format!("启动 lanproxy sidecar 失败: {}", e);
            error!("[Lanproxy] {}", err);
            err
        })?;

    let pid = child.pid();
    info!("[Lanproxy] 进程已启动，PID: {}", pid);

    // 4. 存储进程句柄和事件接收器
    {
        let mut guard = lanproxy_state.child.lock().await;
        *guard = Some(child);
    }
    {
        let mut guard = lanproxy_state.receiver.lock().await;
        *guard = Some(rx);
    }

    // 5. 等待进程初始化（lanproxy 是客户端，无本地端口可检查）
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 6. 简单验证进程是否还在运行
    let still_running = {
        let guard = lanproxy_state.child.lock().await;
        guard.is_some()
    };

    if !still_running {
        let err = "进程启动后立即退出，请检查配置";
        error!("[Lanproxy] {}", err);
        return Err(err.to_string());
    }

    info!("[Lanproxy] 服务启动成功");
    Ok(true)
}

/// 停止 nuwax-lanproxy 客户端
#[tauri::command]
pub async fn lanproxy_stop(lanproxy_state: tauri::State<'_, LanproxyState>) -> Result<bool, String> {
    info!("[Lanproxy] 正在停止服务...");

    let child = lanproxy_state.child.lock().await.take();

    if let Some(child) = child {
        info!("[Lanproxy] 发送 kill 信号到 PID: {}", child.pid());
        child.kill().map_err(|e| {
            let err = format!("停止 lanproxy 失败: {}", e);
            error!("[Lanproxy] {}", err);
            err
        })?;
        info!("[Lanproxy] 进程已停止");
    } else {
        info!("[Lanproxy] 进程未运行，无需停止");
    }

    // 清理事件接收器
    lanproxy_state.receiver.lock().await.take();

    Ok(true)
}

/// 重启 nuwax-lanproxy 客户端
#[tauri::command]
pub async fn lanproxy_restart(
    app: tauri::AppHandle,
    lanproxy_state: tauri::State<'_, LanproxyState>,
) -> Result<bool, String> {
    info!("[Lanproxy] 正在重启服务...");

    // 先停止
    lanproxy_stop(lanproxy_state.clone()).await?;

    // 等待端口释放
    info!("[Lanproxy] 等待端口释放 (500ms)...");
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 重新启动
    info!("[Lanproxy] 正在重新启动...");
    lanproxy_start(app, lanproxy_state).await?;

    info!("[Lanproxy] 重启完成");
    Ok(true)
}

use crate::state::*;
use crate::utils::*;

/// 启动 nuwax-lanproxy 客户端
///
/// 从 Tauri store 读取配置:
/// - lanproxy.server_host: lanproxy 服务器地址 (从 API 返回的 serverHost)
/// - lanproxy.server_port: lanproxy 服务器端口 (从 API 返回的 serverPort)
/// - auth.saved_key: 客户端密钥 (configKey)
///
/// # 错误信息说明
/// 详细的错误信息会帮助定位配置问题，可能的错误包括:
/// - "无法打开 store 文件": store 文件不存在或损坏
/// - "值类型错误": store 中该键的值类型不匹配
/// - "键不存在": 该配置项未设置
#[tauri::command]
pub async fn lanproxy_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    info!("[Lanproxy] 开始读取启动配置...");

    // 从 store 读取 lanproxy server_host (API 返回的 serverHost，如 testagent.xspaceagi.com)
    let server_host = match read_store_string(&app, "lanproxy.server_host") {
        Ok(Some(host)) => {
            info!("[Lanproxy] 找到 server_host: {}", host);
            host
        }
        Ok(None) => {
            let err =
                "配置缺失: lanproxy.server_host (lanproxy服务器地址) - 请先登录以获取服务器配置";
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
    info!("[Lanproxy] 处理后的服务器地址: {}", server_ip);

    // 从 store 读取 lanproxy server_port (API 返回的 serverPort，如 6443)
    let server_port = match read_store_port(&app, "lanproxy.server_port") {
        Ok(Some(port)) => {
            info!("[Lanproxy] 找到 server_port: {}", port);
            port
        }
        Ok(None) => {
            let err =
                "配置缺失: lanproxy.server_port (lanproxy服务器端口) - 请先登录以获取服务器配置";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 lanproxy.server_port 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };

    // 从 store 读取 client_key
    let client_key = match read_store_string(&app, "auth.saved_key") {
        Ok(Some(key)) => {
            let masked = if key.len() > 8 {
                format!("{}****{}", &key[..4], &key[key.len() - 4..])
            } else {
                "****".to_string()
            };
            info!("[Lanproxy] 找到 client_key: {}", masked);
            key
        }
        Ok(None) => {
            let err = "配置缺失: auth.saved_key (客户端密钥) - 请先登录/注册以获取客户端密钥";
            error!("[Lanproxy] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 auth.saved_key 失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };

    // 获取 lanproxy 可执行文件完整路径
    let bin_path = match get_lanproxy_bin_path(&app) {
        Ok(path) => {
            info!("[Lanproxy] 可执行文件路径: {}", path);
            path
        }
        Err(e) => {
            let err = format!("获取 lanproxy 可执行文件路径失败: {}", e);
            error!("[Lanproxy] {}", err);
            return Err(err);
        }
    };

    let lanproxy_config = nuwax_agent_core::NuwaxLanproxyConfig {
        bin_path,
        server_ip,
        server_port,
        client_key,
    };

    let manager = state.manager.lock().await;
    manager.lanproxy_start_with_config(lanproxy_config).await?;
    Ok(true)
}

/// 停止 nuwax-lanproxy 客户端
#[tauri::command]
pub async fn lanproxy_stop(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.lanproxy_stop().await?;
    Ok(true)
}

/// 重启 nuwax-lanproxy 客户端
///
/// 先停止当前服务，等待端口释放，然后重新启动。
/// 配置从 Tauri store 重新读取。
#[tauri::command]
pub async fn lanproxy_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    info!("[Lanproxy] 正在重启服务...");

    // 先停止
    info!("[Lanproxy] 正在停止当前服务...");
    {
        let manager = state.manager.lock().await;
        manager.lanproxy_stop().await?;
    }
    info!("[Lanproxy] 当前服务已停止");

    // 等待端口释放
    info!("[Lanproxy] 等待端口释放 (500ms)...");
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 重新启动（使用相同的 store 配置）
    info!("[Lanproxy] 正在从 store 重新读取配置并启动...");
    lanproxy_start(app, state).await?;

    info!("[Lanproxy] 重启完成");
    Ok(true)
}

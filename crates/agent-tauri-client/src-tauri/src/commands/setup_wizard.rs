//! 初始化向导相关命令
//!
//! 包含应用初始化、预检检查、网络诊断等功能

use crate::utils::store::{read_store_port, read_store_string};
use tauri::Manager;

// ========== 预检检查命令 ==========

/// 执行预检检查
#[tauri::command]
pub async fn preflight_check(
    app: tauri::AppHandle,
) -> Result<nuwax_agent_core::preflight::PreflightResult, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    // 从 store 读取端口配置
    let file_server_port = read_store_port(&app, "setup.file_server_port")
        .ok()
        .flatten()
        .unwrap_or(60000);
    let agent_port = read_store_port(&app, "setup.agent_port")
        .ok()
        .flatten()
        .unwrap_or(60001);
    let mcp_proxy_port = read_store_port(&app, "setup.mcp_proxy_port")
        .ok()
        .flatten()
        .unwrap_or(18099);

    // 从 store 读取工作区目录
    let workspace_dir = read_store_string(&app, "setup.workspace_dir")
        .ok()
        .flatten()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| app_data_dir.join("workspace"));

    let config = nuwax_agent_core::preflight::PreflightConfig {
        ports: vec![
            ("文件服务".to_string(), file_server_port),
            ("Agent 服务".to_string(), agent_port),
            ("MCP Proxy".to_string(), mcp_proxy_port),
        ],
        directories: vec![
            ("工作区".to_string(), workspace_dir),
            ("日志".to_string(), app_data_dir.join("logs")),
            (
                "缓存".to_string(),
                app.path()
                    .app_cache_dir()
                    .unwrap_or_else(|_| app_data_dir.join("cache")),
            ),
        ],
        check_dependencies: true,
    };

    Ok(nuwax_agent_core::preflight::run_preflight(&config).await)
}

/// 修复指定的预检问题
#[tauri::command]
pub async fn preflight_fix(
    check_ids: Vec<String>,
) -> Result<Vec<nuwax_agent_core::preflight::FixResult>, String> {
    Ok(nuwax_agent_core::preflight::run_preflight_fix(&check_ids).await)
}

// ========== 应用目录命令 ==========

/// 获取应用数据目录路径
#[tauri::command]
pub fn app_data_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // 确保目录存在
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| format!("创建应用数据目录失败: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string())
}

/// 获取应用缓存目录路径
#[tauri::command]
pub fn cache_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_cache_dir().map_err(|e| e.to_string())?;

    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| format!("创建缓存目录失败: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string())
}

/// 获取应用配置目录路径
#[tauri::command]
pub fn config_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?;

    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string())
}

// ========== 网络诊断命令 ==========

/// 检查指定端口是否可用
#[tauri::command]
pub fn network_port_check(port: u16) -> bool {
    nuwax_agent_core::platform::check_port_available(port)
}

/// 获取防火墙操作引导文案
#[tauri::command]
pub fn firewall_guide_get() -> String {
    nuwax_agent_core::platform::firewall_guide().to_string()
}

/// 检测中国大陆网络连通性
/// 依次尝试多个国内可用端点，任一成功即返回 true
#[tauri::command]
pub async fn check_network_cn() -> bool {
    let urls = vec![
        "https://223.5.5.5",
        "https://www.baidu.com/favicon.ico",
        "https://cloud.tencent.com",
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    for url in urls {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
    }
    false
}

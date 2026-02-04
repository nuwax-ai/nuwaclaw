// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use system_permissions::{
    create_permission_manager, create_permission_monitor, PermissionMonitor, PermissionState,
    SystemPermission,
};
use tauri::{Emitter, State, Window};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

/// 权限管理状态（使用延迟初始化避免启动时崩溃）
struct PermissionsState {
    manager: Mutex<Option<Arc<dyn system_permissions::PermissionManager + Send + Sync>>>,
}

impl Default for PermissionsState {
    fn default() -> Self {
        Self {
            manager: Mutex::new(None), // 延迟初始化
        }
    }
}

impl PermissionsState {
    async fn get_manager(&self) -> Arc<dyn system_permissions::PermissionManager + Send + Sync> {
        let mut guard = self.manager.lock().await;
        if guard.is_none() {
            *guard = Some(create_permission_manager());
        }
        guard.as_ref().unwrap().clone()
    }
}

/// 权限监控状态（使用延迟初始化）
struct MonitorState {
    monitor: Mutex<Option<Arc<dyn PermissionMonitor>>>,
    task_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Default for MonitorState {
    fn default() -> Self {
        Self {
            monitor: Mutex::new(None),
            task_handle: Mutex::new(None),
        }
    }
}

// 可序列化的权限状态（用于 Tauri IPC）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionStateDto {
    pub permission: String,
    pub status: String,
    pub can_request: bool,
    pub granted_at: Option<String>,
}

// 可序列化的请求结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestResultDto {
    pub permission: String,
    pub granted: bool,
    pub status: String,
    pub error_message: Option<String>,
    pub settings_guide: Option<String>,
}

/// 检查权限状态
#[tauri::command]
async fn check_permission(
    state: State<'_, PermissionsState>,
    permission: String,
) -> Result<PermissionStateDto, String> {
    let perm = parse_permission(&permission)?;
    let manager = state.get_manager().await;
    let result = manager.check(perm).await;
    Ok(PermissionStateDto {
        permission: permission.to_lowercase(),
        status: format!("{:?}", result.status),
        can_request: result.can_request,
        granted_at: result.granted_at.map(|d| d.to_rfc3339()),
    })
}

/// 请求权限
#[tauri::command]
async fn request_permission(
    state: State<'_, PermissionsState>,
    permission: String,
    interactive: bool,
) -> Result<RequestResultDto, String> {
    let perm = parse_permission(&permission)?;
    let manager = state.get_manager().await;
    let options = if interactive {
        system_permissions::RequestOptions::interactive()
    } else {
        system_permissions::RequestOptions::non_interactive()
    };
    let result = manager.request(perm, options).await;
    Ok(RequestResultDto {
        permission: permission.to_lowercase(),
        granted: result.granted,
        status: format!("{:?}", result.status),
        error_message: result.error_message,
        settings_guide: result.settings_guide,
    })
}

/// 打开系统设置
#[tauri::command]
async fn open_settings(
    state: State<'_, PermissionsState>,
    permission: String,
) -> Result<(), String> {
    let perm = parse_permission(&permission)?;
    let manager = state.get_manager().await;
    manager.open_settings(perm).await.map_err(|e| e.to_string())
}

/// 批量获取所有权限状态
#[tauri::command]
async fn get_all_permissions(
    state: State<'_, PermissionsState>,
) -> Result<Vec<PermissionStateDto>, String> {
    let manager = state.get_manager().await;
    let permissions = manager.supported_permissions();
    let mut results = Vec::with_capacity(permissions.len());
    for perm in &permissions {
        let state_result = manager.check(*perm).await;
        results.push(PermissionStateDto {
            permission: perm.name().to_lowercase(),
            status: format!("{:?}", state_result.status),
            can_request: state_result.can_request,
            granted_at: state_result.granted_at.map(|d| d.to_rfc3339()),
        });
    }
    Ok(results)
}

/// 将字符串解析为 SystemPermission 枚举
fn parse_permission(s: &str) -> Result<SystemPermission, String> {
    match s.to_lowercase().as_str() {
        "accessibility" => Ok(SystemPermission::Accessibility),
        "screen_recording" => Ok(SystemPermission::ScreenRecording),
        "microphone" => Ok(SystemPermission::Microphone),
        "camera" => Ok(SystemPermission::Camera),
        "notifications" => Ok(SystemPermission::Notifications),
        "speech" | "speech_recognition" => Ok(SystemPermission::SpeechRecognition),
        "location" => Ok(SystemPermission::Location),
        "apple_script" | "applescript" => Ok(SystemPermission::AppleScript),
        "nuwaxcode" | "nuwax_code" => Ok(SystemPermission::NuwaxCode),
        "claude_code" | "claudecode" => Ok(SystemPermission::ClaudeCode),
        "file_system_read" | "filesystem_read" | "file_access" | "file_access_read" => {
            Ok(SystemPermission::FileSystemRead)
        }
        "file_system_write" | "filesystem_write" | "file_access_write" => {
            Ok(SystemPermission::FileSystemWrite)
        }
        "clipboard" => Ok(SystemPermission::Clipboard),
        "keyboard_monitoring" | "keyboard" => Ok(SystemPermission::KeyboardMonitoring),
        "network" => Ok(SystemPermission::Network),
        _ => Err(format!("Unknown permission: {}", s)),
    }
}

/// 权限变化事件 DTO（用于 Tauri 事件）
#[derive(Debug, Clone, Serialize)]
pub struct PermissionChangeEvent {
    pub permission: String,
    pub status: String,
    pub can_request: bool,
}

impl From<(SystemPermission, PermissionState)> for PermissionChangeEvent {
    fn from((perm, state): (SystemPermission, PermissionState)) -> Self {
        Self {
            permission: perm.name().to_lowercase(),
            status: format!("{:?}", state.status),
            can_request: state.can_request,
        }
    }
}

/// 启动权限监控
#[tauri::command]
async fn start_permission_monitor(
    window: Window,
    monitor_state: State<'_, MonitorState>,
) -> Result<(), String> {
    // 延迟初始化监控器
    let mut monitor_guard = monitor_state.monitor.lock().await;
    if monitor_guard.is_none() {
        *monitor_guard = Some(create_permission_monitor());
    }
    let monitor = monitor_guard.as_ref().unwrap().clone();
    drop(monitor_guard);

    // 启动监控器
    monitor.start().await.map_err(|e| e.to_string())?;

    // 订阅事件并转发到前端
    let mut rx = monitor.subscribe();
    let window_clone = window.clone();

    let handle = tokio::spawn(async move {
        while let Ok((permission, state)) = rx.recv().await {
            let event: PermissionChangeEvent = (permission, state).into();
            let _ = window_clone.emit("permission_change", event);
        }
    });

    *monitor_state.task_handle.lock().await = Some(handle);

    Ok(())
}

/// 停止权限监控
#[tauri::command]
async fn stop_permission_monitor(monitor_state: State<'_, MonitorState>) -> Result<(), String> {
    // 获取监控器（如果存在）
    if let Some(monitor) = monitor_state.monitor.lock().await.as_ref() {
        monitor.stop().await;
    }

    // 取消任务
    if let Some(handle) = monitor_state.task_handle.lock().await.take() {
        handle.abort();
    }

    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ========== 依赖管理命令 ==========

use nuwax_agent_core::dependency::manager::DependencyManager as CoreDependencyManager;

// 依赖项 DTO（用于 Tauri IPC）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyItemDto {
    pub name: String,
    pub display_name: String,
    pub version: Option<String>,
    pub status: String,
    pub required: bool,
    pub description: String,
}

// 依赖统计 DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencySummaryDto {
    pub total: usize,
    pub installed: usize,
    pub missing: usize,
}

impl From<&nuwax_agent_core::dependency::DependencyItem> for DependencyItemDto {
    fn from(item: &nuwax_agent_core::dependency::DependencyItem) -> Self {
        Self {
            name: item.name.clone(),
            display_name: item.display_name.clone(),
            version: item.version.clone(),
            status: format!("{:?}", item.status),
            required: item.required,
            description: item.description.clone(),
        }
    }
}

/// 获取所有依赖列表
#[tauri::command]
async fn get_dependencies() -> Result<Vec<DependencyItemDto>, String> {
    let manager = CoreDependencyManager::new();
    let dependencies = manager.get_all_dependencies().await;
    Ok(dependencies.iter().map(DependencyItemDto::from).collect())
}

/// 获取依赖统计
#[tauri::command]
async fn get_dependency_summary() -> Result<DependencySummaryDto, String> {
    let manager = CoreDependencyManager::new();
    let summary = manager.get_summary().await;
    Ok(DependencySummaryDto {
        total: summary.total,
        installed: summary.installed,
        missing: summary.missing,
    })
}

/// 安装指定依赖
#[tauri::command]
async fn install_dependency(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager.install(&name).await.map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 安装所有缺失依赖
#[tauri::command]
async fn install_all_dependencies() -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager.install_all_missing().await.map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 卸载指定依赖
#[tauri::command]
async fn uninstall_dependency(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager.uninstall(&name).await.map_err(|e| format!("卸载失败: {}", e))?;
    Ok(true)
}

/// 检查单个依赖状态
#[tauri::command]
async fn check_dependency(name: String) -> Result<Option<DependencyItemDto>, String> {
    let manager = CoreDependencyManager::new();
    match manager.check(&name).await {
        Some(item) => Ok(Some(DependencyItemDto::from(&item))),
        None => Ok(None),
    }
}

/// 启动 nuwax-lanproxy 客户端
///
/// TODO: 从 Tauri store 读取配置
/// 需要前端定义 store 中的配置字段名，如:
/// - nuwax-lanproxy.server_ip: 服务器 IP
/// - nuwax-lanproxy.server_port: 服务器端口
/// - nuwax-lanproxy.client_key: 客户端密钥
#[tauri::command]
async fn start_nuwax_lanproxy(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.start_lanproxy().await?;
    Ok(true)
}

/// 停止 nuwax-lanproxy 客户端
#[tauri::command]
async fn stop_nuwax_lanproxy(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.stop_lanproxy().await?;
    Ok(true)
}

/// 重启 nuwax-lanproxy 客户端
#[tauri::command]
async fn restart_nuwax_lanproxy(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.restart_lanproxy().await?;
    Ok(true)
}

// ========== 服务管理命令 ==========

use nuwax_agent_core::service::{ServiceManager, ServiceInfo};

/// 服务状态 DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceInfoDto {
    pub service_type: String,
    pub state: String,
    pub pid: Option<u32>,
}

impl From<ServiceInfo> for ServiceInfoDto {
    fn from(info: ServiceInfo) -> Self {
        Self {
            service_type: format!("{:?}", info.service_type),
            state: format!("{:?}", info.state),
            pid: info.pid,
        }
    }
}

/// 服务管理器状态
struct ServiceManagerState {
    manager: Mutex<ServiceManager>,
}

impl Default for ServiceManagerState {
    fn default() -> Self {
        // TODO: 从 Tauri store 读取配置
        // let server_ip: String = store.get("nuwax-lanproxy.server_ip").unwrap_or_default();
        // let server_port: u16 = store.get("nuwax-lanproxy.server_port").unwrap_or_default();
        // let client_key: String = store.get("nuwax-lanproxy.client_key").unwrap_or_default();
        let lanproxy_config = nuwax_agent_core::NuwaxLanproxyConfig::default();
        Self {
            manager: Mutex::new(ServiceManager::new(None, Some(lanproxy_config))),
        }
    }
}

/// 启动 nuwax-file-server
#[tauri::command]
async fn start_nuwax_file_server(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.start_nuwax_file_server().await?;
    Ok(true)
}

/// 停止 nuwax-file-server
#[tauri::command]
async fn stop_nuwax_file_server(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.stop_nuwax_file_server().await?;
    Ok(true)
}

/// 重启 nuwax-file-server
#[tauri::command]
async fn restart_nuwax_file_server(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.restart_nuwax_file_server().await?;
    Ok(true)
}

/// 启动 HTTP Server (rcoder)
///
/// TODO: 从 Tauri store 读取端口配置
/// 需要前端定义 store 中的配置字段名，如:
/// - rcoder.port: HTTP Server 端口
#[tauri::command]
async fn start_rcoder(
    _state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    // TODO: 从 store 读取端口
    // let port: u16 = store.get("rcoder.port").unwrap_or_default();
    // 临时使用假端口，后续改为从 store 读取
    let port: u16 = 8080;
    let _ = port;
    Err("TODO: 等待前端定义 store 配置字段后实现".to_string())
}

/// 停止 HTTP Server (rcoder)
#[tauri::command]
async fn stop_rcoder(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.stop_rcoder().await?;
    Ok(true)
}

/// 重启 HTTP Server (rcoder)
///
/// TODO: 从 Tauri store 读取端口配置
/// 需要前端定义 store 中的配置字段名，如:
/// - rcoder.port: HTTP Server 端口
#[tauri::command]
async fn restart_rcoder(
    _state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    // TODO: 从 store 读取端口
    // let port: u16 = store.get("rcoder.port").unwrap_or_default();
    // 临时使用假端口，后续改为从 store 读取
    let port: u16 = 8080;
    let _ = port;
    Err("TODO: 等待前端定义 store 配置字段后实现".to_string())
}

/// 停止所有服务
#[tauri::command]
async fn stop_all_services(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.stop_all().await?;
    Ok(true)
}

/// 重启所有服务
///
/// TODO: 从 Tauri store 读取端口配置
/// 需要前端定义 store 中的配置字段名，如:
/// - rcoder.port: HTTP Server 端口
/// - nuwax-file-server.port: 文件服务端口
#[tauri::command]
async fn restart_all_services(
    _state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    // TODO: 从 store 读取端口
    // let rcoder_port: u16 = store.get("rcoder.port").unwrap_or_default();
    // let file_server_port: u16 = store.get("nuwax-file-server.port").unwrap_or_default();
    // 临时使用假端口，后续改为从 store 读取
    let rcoder_port: u16 = 8080;
    let file_server_port: u16 = 8081;
    let _ = (rcoder_port, file_server_port);
    Err("TODO: 等待前端定义 store 配置字段后实现".to_string())
}

/// 获取所有服务状态
#[tauri::command]
async fn get_all_services_status(state: tauri::State<'_, ServiceManagerState>) -> Result<Vec<ServiceInfoDto>, String> {
    let manager = state.manager.lock().await;
    let statuses = manager.get_all_status().await;
    Ok(statuses.into_iter().map(|s| s.into()).collect())
}

// ========== npm 依赖管理命令 ==========

/// 安装 npm 依赖
#[tauri::command]
async fn install_npm_dependency(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager.install(&name).await.map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 查询 npm 依赖版本
#[tauri::command]
async fn query_npm_version(name: String) -> Result<Option<String>, String> {
    let manager = CoreDependencyManager::new();
    match manager.check(&name).await {
        Some(item) => Ok(item.version),
        None => Ok(None),
    }
}

/// 重新安装 npm 依赖
#[tauri::command]
async fn reinstall_npm_dependency(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager.uninstall(&name).await.map_err(|e| format!("卸载失败: {}", e))?;
    manager.install(&name).await.map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(PermissionsState::default())
        .manage(MonitorState::default())
        .manage(ServiceManagerState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            check_permission,
            request_permission,
            open_settings,
            get_all_permissions,
            start_permission_monitor,
            stop_permission_monitor,
            // 依赖管理命令
            get_dependencies,
            get_dependency_summary,
            install_dependency,
            install_all_dependencies,
            uninstall_dependency,
            check_dependency,
            // nuwax-lanproxy 命令
            start_nuwax_lanproxy,
            stop_nuwax_lanproxy,
            restart_nuwax_lanproxy,
            // 服务管理命令
            start_nuwax_file_server,
            stop_nuwax_file_server,
            restart_nuwax_file_server,
            start_rcoder,
            stop_rcoder,
            restart_rcoder,
            stop_all_services,
            restart_all_services,
            get_all_services_status,
            // npm 依赖管理命令
            install_npm_dependency,
            query_npm_version,
            reinstall_npm_dependency,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

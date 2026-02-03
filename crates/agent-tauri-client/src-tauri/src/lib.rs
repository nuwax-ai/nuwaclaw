// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use system_permissions::{
    create_permission_manager, create_permission_monitor, PermissionMonitor, PermissionState,
    SystemPermission,
};
use tauri::{Emitter, State, Window};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PermissionsState::default())
        .manage(MonitorState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            check_permission,
            request_permission,
            open_settings,
            get_all_permissions,
            start_permission_monitor,
            stop_permission_monitor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

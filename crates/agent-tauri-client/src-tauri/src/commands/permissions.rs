use crate::models::*;
use crate::state::*;
use std::env;
use std::fs;
use std::io::ErrorKind;
use system_permissions::{create_permission_monitor, RequestOptions, SystemPermission};
use tauri::{Emitter, State, Window};

/// 检查权限状态
#[tauri::command]
pub async fn permission_check(
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
pub async fn permission_request(
    state: State<'_, PermissionsState>,
    permission: String,
    interactive: bool,
) -> Result<RequestResultDto, String> {
    let perm = parse_permission(&permission)?;
    let manager = state.get_manager().await;
    let options = if interactive {
        RequestOptions::interactive()
    } else {
        RequestOptions::non_interactive()
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
pub async fn permission_open_settings(
    state: State<'_, PermissionsState>,
    permission: String,
) -> Result<(), String> {
    let perm = parse_permission(&permission)?;
    let manager = state.get_manager().await;
    manager.open_settings(perm).await.map_err(|e| e.to_string())
}

/// 批量获取所有权限状态
#[tauri::command]
pub async fn permission_list(
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

/// 检查完全磁盘访问权限
///
/// 该命令用于检测应用是否已获得 macOS 的完全磁盘访问权限。
/// 通过尝试访问用户主目录下的 Library/Application Support 目录来判断。
/// 如果没有完全磁盘访问权限，该目录将被拒绝访问。
///
/// # 返回
/// - `Ok(true)` - 已获得完全磁盘访问权限
/// - `Ok(false)` - 未获得完全磁盘访问权限
/// - `Err(message)` - 检查过程中发生错误
#[tauri::command]
pub async fn check_disk_access() -> Result<bool, String> {
    info!("[Permissions] 开始检查完全磁盘访问权限...");

    // 获取用户主目录
    let home_dir = env::home_dir().ok_or("无法获取用户主目录")?;

    // 尝试访问受保护的目录
    // macOS 上完全磁盘访问权限控制的核心目录之一
    let protected_path = home_dir.join("Library").join("Application Support");

    info!(
        "[Permissions] 尝试访问受保护目录: {}",
        protected_path.display()
    );

    match fs::read_dir(&protected_path) {
        Ok(_) => {
            info!("[Permissions] 完全磁盘访问权限已授予");
            Ok(true)
        }
        Err(e) if e.kind() == ErrorKind::PermissionDenied => {
            warn!("[Permissions] 完全磁盘访问权限被拒绝: {}", e);
            Ok(false)
        }
        Err(e) => {
            error!("[Permissions] 检查完全磁盘访问权限时出错: {}", e);
            Err(format!("检查权限时出错: {}", e))
        }
    }
}

/// 启动权限监控
#[tauri::command]
pub async fn permission_monitor_start(
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
pub async fn permission_monitor_stop(monitor_state: State<'_, MonitorState>) -> Result<(), String> {
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

/// 获取当前平台所需的权限列表及状态
#[tauri::command]
pub async fn permission_requirements(
    state: State<'_, PermissionsState>,
) -> Result<Vec<PermissionStateDto>, String> {
    let manager = state.get_manager().await;

    // 定义各平台需要的权限
    #[cfg(target_os = "macos")]
    let required_perms = vec!["screen_recording", "accessibility", "microphone"];

    #[cfg(target_os = "windows")]
    let required_perms = vec!["microphone", "camera"];

    #[cfg(target_os = "linux")]
    let required_perms = vec!["screen_recording", "accessibility", "microphone"];

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let required_perms: Vec<&str> = vec![];

    let mut results = Vec::new();
    for perm_name in required_perms {
        if let Ok(perm) = parse_permission(perm_name) {
            let result = manager.check(perm).await;
            results.push(PermissionStateDto {
                permission: perm_name.to_string(),
                status: format!("{:?}", result.status),
                can_request: result.can_request,
                granted_at: result.granted_at.map(|d| d.to_rfc3339()),
            });
        }
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

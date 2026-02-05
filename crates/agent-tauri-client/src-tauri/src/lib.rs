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
#[tauri::command]
async fn start_nuwax_client(
    app: tauri::AppHandle,
    server_ip: String,
    server_port: u16,
    client_key: String,
) -> Result<(), String> {
    let sidecar_command = app
        .shell()
        .sidecar("nuwax-lanproxy")
        .map_err(|e| e.to_string())?
        .args([
            "-s", &server_ip,
            "-p", &server_port.to_string(),
            "-k", &client_key,
        ]);

    let output = sidecar_command.output().await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(())
}

// ========== 初始化向导命令 ==========

use std::process::Command;
use tauri::Manager;

/// Node.js 版本检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeVersionResult {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_requirement: bool,
}

/// npm 包检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpmPackageResult {
    pub installed: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
}

/// npm 包安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
    pub error: Option<String>,
}

/// 获取应用数据目录路径
#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    
    // 确保目录存在
    if !path.exists() {
        std::fs::create_dir_all(&path)
            .map_err(|e| format!("创建应用数据目录失败: {}", e))?;
    }
    
    Ok(path.to_string_lossy().to_string())
}

/// 初始化本地 npm 环境（创建 package.json）
#[tauri::command]
async fn init_local_npm_env(app: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = get_app_data_dir(app)?;
    let package_json_path = std::path::Path::new(&app_dir).join("package.json");
    
    // 检查是否已存在
    if package_json_path.exists() {
        return Ok(true);
    }
    
    // 创建 package.json
    let content = r#"{
  "name": "nuwax-agent-deps",
  "version": "1.0.0",
  "private": true,
  "description": "NuWax Agent 本地依赖"
}"#;
    
    std::fs::write(&package_json_path, content)
        .map_err(|e| format!("创建 package.json 失败: {}", e))?;
    
    Ok(true)
}

/// 检测 Node.js 版本
#[tauri::command]
async fn detect_node_version() -> Result<NodeVersionResult, String> {
    let output = Command::new("node")
        .arg("--version")
        .output();
    
    match output {
        Ok(out) if out.status.success() => {
            let version_str = String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_start_matches('v')
                .to_string();
            
            // 检查版本是否 >= 22.0.0
            let meets = check_version_meets_requirement(&version_str, "22.0.0");
            
            Ok(NodeVersionResult {
                installed: true,
                version: Some(version_str),
                meets_requirement: meets,
            })
        }
        _ => Ok(NodeVersionResult {
            installed: false,
            version: None,
            meets_requirement: false,
        })
    }
}

/// uv 版本检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UvVersionResult {
    pub installed: bool,
    pub version: Option<String>,
    pub meets_requirement: bool,
}

/// 检测 uv 版本
/// uv 是高性能的 Python 包管理器
#[tauri::command]
async fn detect_uv_version() -> Result<UvVersionResult, String> {
    let output = Command::new("uv")
        .arg("--version")
        .output();
    
    match output {
        Ok(out) if out.status.success() => {
            // uv 输出格式: "uv 0.5.14 (homebrew)"
            let output_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
            
            // 提取版本号
            let version_str = output_str
                .split_whitespace()
                .nth(1)  // 获取第二个部分（版本号）
                .unwrap_or("")
                .to_string();
            
            // 检查版本是否 >= 0.5.0
            let meets = if version_str.is_empty() {
                false
            } else {
                check_version_meets_requirement(&version_str, "0.5.0")
            };
            
            Ok(UvVersionResult {
                installed: true,
                version: if version_str.is_empty() { None } else { Some(version_str) },
                meets_requirement: meets,
            })
        }
        _ => Ok(UvVersionResult {
            installed: false,
            version: None,
            meets_requirement: false,
        })
    }
}

/// 检测本地 npm 包是否已安装
#[tauri::command]
async fn check_local_npm_package(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<NpmPackageResult, String> {
    let app_dir = get_app_data_dir(app)?;
    let node_modules = std::path::Path::new(&app_dir).join("node_modules");
    let package_dir = node_modules.join(&package_name);
    
    // 检查包目录是否存在
    if !package_dir.exists() {
        return Ok(NpmPackageResult {
            installed: false,
            version: None,
            bin_path: None,
        });
    }
    
    // 读取 package.json 获取版本
    let pkg_json_path = package_dir.join("package.json");
    let version = if pkg_json_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pkg_json_path) {
            serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|v| v["version"].as_str().map(String::from))
        } else {
            None
        }
    } else {
        None
    };
    
    // 获取 bin 路径
    let bin_path = get_package_bin_path(&app_dir, &package_name);
    
    Ok(NpmPackageResult {
        installed: true,
        version,
        bin_path,
    })
}

/// 安装 npm 包到本地目录（使用 npmmirror）
#[tauri::command]
async fn install_local_npm_package(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<InstallResult, String> {
    let app_dir = get_app_data_dir(app.clone())?;
    let registry = "https://registry.npmmirror.com/";
    
    // 确保 npm 环境已初始化
    init_local_npm_env(app.clone()).await?;
    
    // 执行 npm install
    let output = Command::new("npm")
        .args([
            "install",
            &package_name,
            "--prefix", &app_dir,
            "--registry", registry,
        ])
        .output()
        .map_err(|e| format!("执行 npm install 失败: {}", e))?;
    
    if output.status.success() {
        // 获取安装的版本
        let result = check_local_npm_package(app, package_name.clone()).await?;
        
        Ok(InstallResult {
            success: true,
            version: result.version,
            bin_path: result.bin_path,
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(InstallResult {
            success: false,
            version: None,
            bin_path: None,
            error: Some(stderr),
        })
    }
}

/// 重启所有服务
/// TODO: 后续专门实现，当前仅占位
#[tauri::command]
async fn restart_all_services() -> Result<(), String> {
    // TODO: 后续专门实现服务管理功能
    // 计划实现内容:
    // 1. 停止所有正在运行的服务进程
    // 2. 获取各服务的 bin 路径 (nuwax-file-server, nuwaxcode, claude-code-acp)
    // 3. 按顺序启动服务，传入配置参数（端口等）
    // 4. 监控服务状态，处理异常退出
    // 5. 记录服务 PID，支持单独停止/重启
    
    log::info!("[restart_all_services] TODO: 服务启动功能待实现");
    Ok(())
}

// ========== 开机自启动命令 ==========

use auto_launch::AutoLaunchBuilder;

/// 创建 AutoLaunch 实例
/// 根据当前运行的应用信息构建
fn create_auto_launch(app: &tauri::AppHandle) -> Result<auto_launch::AutoLaunch, String> {
    // 获取应用名称
    let app_name = "Nuwax Agent";
    
    // 获取应用可执行文件路径
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("获取应用路径失败: {}", e))?;
    
    // macOS 上需要获取 .app bundle 路径，而不是内部的可执行文件路径
    #[cfg(target_os = "macos")]
    let app_path = {
        // 路径格式: /Applications/xxx.app/Contents/MacOS/xxx
        // 需要回退到 .app 目录
        let path_str = exe_path.to_string_lossy().to_string();
        if path_str.contains(".app/Contents/MacOS") {
            // 找到 .app 的位置并截取
            if let Some(idx) = path_str.find(".app/") {
                path_str[..idx + 4].to_string() // 包含 .app
            } else {
                path_str
            }
        } else {
            path_str
        }
    };
    
    #[cfg(not(target_os = "macos"))]
    let app_path = exe_path.to_string_lossy().to_string();
    
    // 获取 bundle identifier
    let bundle_id = app.config().identifier.clone();
    
    // 构建 AutoLaunch
    let mut builder = AutoLaunchBuilder::new();
    builder
        .set_app_name(app_name)
        .set_app_path(&app_path)
        .set_args(&["--minimized"]); // 启动时最小化
    
    // macOS 特定设置
    #[cfg(target_os = "macos")]
    {
        builder.set_bundle_identifiers(&[&bundle_id]);
        builder.set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent);
    }
    
    // Windows 特定设置：仅当前用户
    #[cfg(target_os = "windows")]
    {
        builder.set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    }
    
    builder.build().map_err(|e| format!("创建 AutoLaunch 失败: {}", e))
}

/// 设置开机自启动
#[tauri::command]
async fn set_auto_launch(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let auto_launch = create_auto_launch(&app)?;
    
    if enabled {
        auto_launch.enable().map_err(|e| format!("启用开机自启动失败: {}", e))?;
        log::info!("[set_auto_launch] 已启用开机自启动");
    } else {
        auto_launch.disable().map_err(|e| format!("禁用开机自启动失败: {}", e))?;
        log::info!("[set_auto_launch] 已禁用开机自启动");
    }
    
    Ok(enabled)
}

/// 获取开机自启动状态
#[tauri::command]
async fn get_auto_launch(app: tauri::AppHandle) -> Result<bool, String> {
    let auto_launch = create_auto_launch(&app)?;
    let enabled = auto_launch.is_enabled().map_err(|e| format!("获取开机自启动状态失败: {}", e))?;
    log::info!("[get_auto_launch] 当前状态: {}", enabled);
    Ok(enabled)
}

/// 选择目录对话框
#[tauri::command]
async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    
    // 使用 oneshot channel 接收回调结果
    let (tx, rx) = oneshot::channel();
    
    app.dialog()
        .file()
        .pick_folder(move |result| {
            // FilePath 实现了 Display trait，使用 to_string() 或 into_path()
            let path = result.map(|p| p.to_string());
            let _ = tx.send(path);
        });
    
    // 等待回调结果
    match rx.await {
        Ok(path) => Ok(path),
        Err(_) => Err("目录选择被取消".to_string()),
    }
}

// ========== 辅助函数 ==========

/// 获取包的可执行文件路径
fn get_package_bin_path(app_dir: &str, package_name: &str) -> Option<String> {
    // 从包名推断 bin 名称
    // 例如: @anthropic-ai/claude-code-acp -> claude-code-acp
    let bin_name = package_name
        .split('/')
        .last()
        .unwrap_or(package_name);
    
    let bin_path = std::path::Path::new(app_dir)
        .join("node_modules")
        .join(".bin")
        .join(bin_name);
    
    if bin_path.exists() {
        Some(bin_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// 检查版本是否满足最低要求
/// 例如: "22.21.1" >= "22.0.0" 应返回 true
fn check_version_meets_requirement(current: &str, required: &str) -> bool {
    let parse_version = |v: &str| -> (u32, u32, u32) {
        let parts: Vec<&str> = v.split('.').collect();
        let major = parts.get(0)
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let minor = parts.get(1)
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let patch = parts.get(2)
            .and_then(|s| {
                // 处理可能带有后缀的版本号，如 "22.0.0-beta"
                let numeric_part: String = s.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                numeric_part.parse().ok()
            })
            .unwrap_or(0);
        (major, minor, patch)
    };
    
    let (cur_major, cur_minor, cur_patch) = parse_version(current);
    let (req_major, req_minor, req_patch) = parse_version(required);
    
    // 比较版本号：先比较 major，再比较 minor，最后比较 patch
    // 使用元组比较，更简洁可靠
    (cur_major, cur_minor, cur_patch) >= (req_major, req_minor, req_patch)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(PermissionsState::default())
        .manage(MonitorState::default())
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
            start_nuwax_client,
            // 初始化向导命令
            get_app_data_dir,
            init_local_npm_env,
            detect_node_version,
            detect_uv_version,
            check_local_npm_package,
            install_local_npm_package,
            restart_all_services,
            select_directory,
            // 开机自启动命令
            set_auto_launch,
            get_auto_launch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

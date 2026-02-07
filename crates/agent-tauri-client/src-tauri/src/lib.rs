// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[macro_use]
extern crate log;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use system_permissions::{
    create_permission_manager, create_permission_monitor, PermissionMonitor, PermissionState,
    SystemPermission,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, Window,
};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

// ========== AgentRunnerApi 导入 ==========
use nuwax_agent_core::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};

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
async fn permission_check(
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
async fn permission_request(
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
async fn permission_open_settings(
    state: State<'_, PermissionsState>,
    permission: String,
) -> Result<(), String> {
    let perm = parse_permission(&permission)?;
    let manager = state.get_manager().await;
    manager.open_settings(perm).await.map_err(|e| e.to_string())
}

/// 批量获取所有权限状态
#[tauri::command]
async fn permission_list(
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
async fn check_disk_access() -> Result<bool, String> {
    info!("[Permissions] 开始检查完全磁盘访问权限...");

    // 获取用户主目录
    let home_dir = std::env::home_dir().ok_or("无法获取用户主目录")?;

    // 尝试访问受保护的目录
    // macOS 上完全磁盘访问权限控制的核心目录之一
    let protected_path = home_dir.join("Library").join("Application Support");

    info!(
        "[Permissions] 尝试访问受保护目录: {}",
        protected_path.display()
    );

    match std::fs::read_dir(&protected_path) {
        Ok(_) => {
            info!("[Permissions] 完全磁盘访问权限已授予");
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            warn!("[Permissions] 完全磁盘访问权限被拒绝: {}", e);
            Ok(false)
        }
        Err(e) => {
            error!("[Permissions] 检查完全磁盘访问权限时出错: {}", e);
            Err(format!("检查权限时出错: {}", e))
        }
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
async fn permission_monitor_start(
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
async fn permission_monitor_stop(monitor_state: State<'_, MonitorState>) -> Result<(), String> {
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
fn system_greet(name: &str) -> String {
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
async fn dependency_list() -> Result<Vec<DependencyItemDto>, String> {
    let manager = CoreDependencyManager::new();
    let dependencies = manager.get_all_dependencies().await;
    Ok(dependencies.iter().map(DependencyItemDto::from).collect())
}

/// 获取依赖统计
#[tauri::command]
async fn dependency_summary() -> Result<DependencySummaryDto, String> {
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
async fn dependency_install(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .install(&name)
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 安装所有缺失依赖
#[tauri::command]
async fn dependency_install_all() -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .install_all_missing()
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 卸载指定依赖
#[tauri::command]
async fn dependency_uninstall(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .uninstall(&name)
        .await
        .map_err(|e| format!("卸载失败: {}", e))?;
    Ok(true)
}

/// 检查单个依赖状态
#[tauri::command]
async fn dependency_check(name: String) -> Result<Option<DependencyItemDto>, String> {
    let manager = CoreDependencyManager::new();
    match manager.check(&name).await {
        Some(item) => Ok(Some(DependencyItemDto::from(&item))),
        None => Ok(None),
    }
}

/// 从 store 读取字符串配置（带详细日志和错误信息）
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取到字符串值
/// - `Ok(None)`: 键不存在
/// - `Err(message)`: 发生错误（store 打开失败或值类型错误）
fn read_store_string(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    // 尝试打开 store 文件
    let store = match app.store("nuwax_store.bin") {
        Ok(store) => {
            debug!("[Store] 成功打开 store 文件");
            store
        }
        Err(e) => {
            warn!("[Store] 打开 store 文件失败: {}", e);
            return Err(format!("无法打开 store 文件: {}", e));
        }
    };

    // 尝试获取键对应的值
    match store.get(key) {
        Some(value) => {
            debug!("[Store] 找到键 '{}'，值类型: {:?}", key, value);
            // 尝试转换为字符串
            match value.as_str() {
                Some(s) => {
                    // 如果是敏感信息（如密钥），只打印前后各 4 个字符
                    if key.contains("key") || key.contains("secret") || key.contains("password") {
                        let masked = if s.len() > 8 {
                            format!("{}****{}", &s[..4], &s[s.len() - 4..])
                        } else {
                            "****".to_string()
                        };
                        debug!("[Store] 成功读取 '{}' = \"{}\"", key, masked);
                    } else {
                        debug!("[Store] 成功读取 '{}' = \"{}\"", key, s);
                    }
                    Ok(Some(s.to_string()))
                }
                None => {
                    warn!(
                        "[Store] 值类型错误: '{}' 不是字符串类型，实际类型: {:?}",
                        key, value
                    );
                    Err(format!(
                        "值类型错误: '{}' 期望字符串类型，实际类型: {:?}",
                        key, value
                    ))
                }
            }
        }
        None => {
            debug!("[Store] 键不存在: '{}'", key);
            Ok(None)
        }
    }
}

/// 从 store 读取 i64 配置（带详细日志和错误信息）
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取到整数值
/// - `Ok(None)`: 键不存在
/// - `Err(message)`: 发生错误（store 打开失败或值类型错误）
fn read_store_i64(app: &tauri::AppHandle, key: &str) -> Result<Option<i64>, String> {
    // 尝试打开 store 文件
    let store = match app.store("nuwax_store.bin") {
        Ok(store) => {
            debug!("[Store] 成功打开 store 文件");
            store
        }
        Err(e) => {
            warn!("[Store] 打开 store 文件失败: {}", e);
            return Err(format!("无法打开 store 文件: {}", e));
        }
    };

    // 尝试获取键对应的值
    match store.get(key) {
        Some(value) => {
            debug!("[Store] 找到键 '{}'，值类型: {:?}", key, value);
            // 尝试转换为 i64
            match value.as_i64() {
                Some(n) => {
                    debug!("[Store] 成功读取 '{}' = {}", key, n);
                    Ok(Some(n))
                }
                None => {
                    warn!(
                        "[Store] 值类型错误: '{}' 不是数字类型，实际类型: {:?}",
                        key, value
                    );
                    Err(format!(
                        "值类型错误: '{}' 期望数字类型，实际类型: {:?}",
                        key, value
                    ))
                }
            }
        }
        None => {
            debug!("[Store] 键不存在: '{}'", key);
            Ok(None)
        }
    }
}

/// 从 store 读取端口配置（i64 转 u16），带详细日志
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取到端口值
/// - `Ok(None)`: 键不存在
/// - `Err(message)`: 发生错误（值类型错误或转换失败）
fn read_store_port(app: &tauri::AppHandle, key: &str) -> Result<Option<u16>, String> {
    match read_store_i64(app, key) {
        Ok(Some(n)) => {
            // 检查端口范围合法性
            if n < 0 || n > 65535 {
                warn!(
                    "[Store] 端口值越界: '{}' = {}，端口范围应为 0-65535",
                    key, n
                );
                return Err(format!(
                    "端口值越界: '{}' = {}，端口范围应为 0-65535",
                    key, n
                ));
            }
            debug!("[Store] 成功读取端口 '{}' = {}", key, n);
            Ok(Some(n as u16))
        }
        Ok(None) => {
            debug!("[Store] 端口键不存在: '{}'", key);
            Ok(None)
        }
        Err(e) => {
            // 已经是错误信息，直接透传
            Err(e)
        }
    }
}

/// 从 server_host 中去除 URL 协议前缀，得到纯主机名/IP，供 nuwax-lanproxy -s 使用
fn strip_host_from_url(server_host: &str) -> String {
    let s = server_host.trim();
    if s.starts_with("https://") {
        s.strip_prefix("https://").unwrap_or(s).trim().to_string()
    } else if s.starts_with("http://") {
        s.strip_prefix("http://").unwrap_or(s).trim().to_string()
    } else {
        s.to_string()
    }
}

/// 获取当前平台的 nuwax-lanproxy 可执行文件完整路径
///
/// 返回 binaries 目录下对应平台的可执行文件路径。
/// 路径格式: {app_dir}/binaries/nuwax-lanproxy-{platform}
///
/// # Arguments
/// * `app` - Tauri AppHandle，用于获取应用资源目录
///
/// # Returns
/// 完整的可执行文件路径，如果出错则返回错误信息

/// 获取 nuwax-file-server 可执行文件完整路径
///
/// nuwax-file-server 是通过 npm 安装到本地目录的，路径为：
/// <app_data_dir>/node_modules/.bin/nuwax-file-server
///
/// # Arguments
/// * `app` - Tauri AppHandle，用于获取应用数据目录
///
/// # Returns
/// 完整的可执行文件路径，如果出错则返回错误信息
fn get_file_server_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    let bin_name = "nuwax-file-server";

    // 获取应用数据目录
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    // 构建 node_modules/.bin 下的路径
    let bin_path = app_data_dir
        .join("node_modules")
        .join(".bin")
        .join(bin_name);

    if bin_path.exists() {
        info!(
            "[FileServer] 找到可执行文件: {}",
            bin_path.to_string_lossy()
        );
        return Ok(bin_path.to_string_lossy().to_string());
    }

    // 如果本地没有安装，尝试使用全局命令（作为 fallback）
    warn!("[FileServer] 本地未安装 nuwax-file-server，尝试使用全局命令");

    // 检查是否在 PATH 中（跨平台）
    #[cfg(unix)]
    let which_cmd = "which";
    #[cfg(windows)]
    let which_cmd = "where";

    if let Ok(output) = std::process::Command::new(which_cmd).arg(bin_name).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                info!("[FileServer] 找到全局命令: {}", path);
                return Ok(path);
            }
        }
    }

    Err(format!(
        "未找到 {} 可执行文件，请在「依赖」页面安装 Nuwax File Server",
        bin_name
    ))
}

#[cfg(target_os = "macos")]
fn get_lanproxy_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    let bin_name = "nuwax-lanproxy-aarch64-apple-darwin";

    // 1. 尝试从资源目录获取 (生产环境)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bin_path = resource_dir.join("binaries").join(bin_name);
        if bin_path.exists() {
            return Ok(bin_path.to_string_lossy().to_string());
        }
    }

    // 2. 尝试从可执行文件所在目录获取
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    {
        let alt_path = exe_dir.join("binaries").join(bin_name);
        if alt_path.exists() {
            return Ok(alt_path.to_string_lossy().to_string());
        }
    }

    // 3. 开发模式: 尝试从 src-tauri/binaries 目录获取
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let dev_path = std::path::Path::new(&manifest_dir)
            .join("binaries")
            .join(bin_name);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
    }

    // 4. 开发模式备选: 从当前工作目录推断
    if let Ok(cwd) = std::env::current_dir() {
        // 检查是否在项目根目录运行
        let dev_path = cwd
            .join("crates/agent-tauri-client/src-tauri/binaries")
            .join(bin_name);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
    }

    Err(format!("未找到 {} 可执行文件", bin_name))
}

/// 获取当前平台的 nuwax-lanproxy 可执行文件完整路径（Linux）
#[cfg(target_os = "linux")]
fn get_lanproxy_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    // 根据架构选择文件名
    #[cfg(target_arch = "aarch64")]
    let bin_name = "nuwax-lanproxy-aarch64-unknown-linux-gnu";
    #[cfg(target_arch = "x86_64")]
    let bin_name = "nuwax-lanproxy-x86_64-unknown-linux-gnu";
    #[cfg(target_arch = "arm")]
    let bin_name = "nuwax-lanproxy-arm-unknown-linux-gnueabi";
    #[cfg(target_arch = "armv7")]
    let bin_name = "nuwax-lanproxy-armv7-unknown-linux-gnueabihf";
    #[cfg(target_arch = "mips")]
    let bin_name = "nuwax-lanproxy-mips-unknown-linux-gnu";
    #[cfg(target_arch = "mipsle")]
    let bin_name = "nuwax-lanproxy-mipsle-unknown-linux-gnu";
    #[cfg(target_arch = "mips64")]
    let bin_name = "nuwax-lanproxy-mips64-unknown-linux-gnu";

    // 1. 尝试从资源目录获取 (生产环境)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bin_path = resource_dir.join("binaries").join(bin_name);
        if bin_path.exists() {
            return Ok(bin_path.to_string_lossy().to_string());
        }
    }

    // 2. 尝试从可执行文件所在目录获取
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    {
        let alt_path = exe_dir.join("binaries").join(bin_name);
        if alt_path.exists() {
            return Ok(alt_path.to_string_lossy().to_string());
        }
    }

    // 3. 开发模式: 尝试从 src-tauri/binaries 目录获取
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let dev_path = std::path::Path::new(&manifest_dir)
            .join("binaries")
            .join(bin_name);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
    }

    // 4. 开发模式备选: 从当前工作目录推断
    if let Ok(cwd) = std::env::current_dir() {
        let dev_path = cwd
            .join("crates/agent-tauri-client/src-tauri/binaries")
            .join(bin_name);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
    }

    Err(format!("未找到 {} 可执行文件", bin_name))
}

/// 获取当前平台的 nuwax-lanproxy 可执行文件完整路径（Windows）
#[cfg(target_os = "windows")]
fn get_lanproxy_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    // 根据架构选择文件名
    #[cfg(target_arch = "x86_64")]
    let bin_name = "nuwax-lanproxy-x86_64-pc-windows-msvc.exe";
    #[cfg(target_arch = "x86")]
    let bin_name = "nuwax-lanproxy-i686-pc-windows-msvc.exe";
    #[cfg(target_arch = "aarch64")]
    let bin_name = "nuwax-lanproxy-aarch64-pc-windows-msvc.exe";

    // 1. 尝试从资源目录获取 (生产环境)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bin_path = resource_dir.join("binaries").join(bin_name);
        if bin_path.exists() {
            return Ok(bin_path.to_string_lossy().to_string());
        }
    }

    // 2. 尝试从可执行文件所在目录获取
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    {
        let alt_path = exe_dir.join("binaries").join(bin_name);
        if alt_path.exists() {
            return Ok(alt_path.to_string_lossy().to_string());
        }
    }

    // 3. 开发模式: 尝试从 src-tauri/binaries 目录获取
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let dev_path = std::path::Path::new(&manifest_dir)
            .join("binaries")
            .join(bin_name);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
    }

    // 4. 开发模式备选: 从当前工作目录推断
    if let Ok(cwd) = std::env::current_dir() {
        let dev_path = cwd
            .join("crates/agent-tauri-client/src-tauri/binaries")
            .join(bin_name);
        if dev_path.exists() {
            return Ok(dev_path.to_string_lossy().to_string());
        }
    }

    Err(format!("未找到 {} 可执行文件", bin_name))
}

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
async fn lanproxy_start(
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
async fn lanproxy_stop(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.lanproxy_stop().await?;
    Ok(true)
}

/// 重启 nuwax-lanproxy 客户端
///
/// 先停止当前服务，等待端口释放，然后重新启动。
/// 配置从 Tauri store 重新读取。
#[tauri::command]
async fn lanproxy_restart(
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

// ========== 服务管理命令 ==========

use nuwax_agent_core::service::{ServiceInfo, ServiceManager};

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
///
/// 注意：服务配置在启动时从 Tauri store 动态读取，
/// 不在此处设置默认配置

struct ServiceManagerState {
    manager: Mutex<ServiceManager>,
    /// 保存当前的 RcoderAgentRunner，用于在重启时正确停止旧实例（包括 Pingora 代理）
    agent_runner: Mutex<Option<Arc<RcoderAgentRunner>>>,
}

impl Default for ServiceManagerState {
    fn default() -> Self {
        // 使用默认配置初始化，运行时通过 start_*_with_config 方法传入实际配置
        let lanproxy_config = nuwax_agent_core::NuwaxLanproxyConfig::default();
        Self {
            manager: Mutex::new(ServiceManager::new(None, Some(lanproxy_config))),
            agent_runner: Mutex::new(None),
        }
    }
}

/// 启动 nuwax-file-server
#[tauri::command]
async fn file_server_start(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.file_server_start().await?;
    Ok(true)
}

/// 停止 nuwax-file-server
#[tauri::command]
async fn file_server_stop(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.file_server_stop().await?;
    Ok(true)
}

/// 重启 nuwax-file-server
#[tauri::command]
async fn file_server_restart(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.file_server_restart().await?;
    Ok(true)
}

/// 启动 HTTP Server (rcoder)
///
/// 启动 HTTP Server (rcoder)
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: HTTP Server 端口 (默认 9086)
/// - setup.workspace_dir: 工作区目录
#[tauri::command]
async fn rcoder_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    info!("[Rcoder] 开始读取启动配置...");

    // 从 store 读取端口
    let port = match read_store_port(&app, "setup.agent_port") {
        Ok(Some(p)) => {
            info!("[Rcoder] 找到 agent_port: {}", p);
            p
        }
        Ok(None) => {
            let err = "配置缺失: setup.agent_port (Agent 服务端口)";
            error!("[Rcoder] {}", err);
            return Err(err.to_string());
        }
        Err(e) => {
            let err = format!("读取 setup.agent_port 失败: {}", e);
            error!("[Rcoder] {}", err);
            return Err(err);
        }
    };

    // 读取工作区目录作为项目目录
    let projects_dir = match read_store_string(&app, "setup.workspace_dir") {
        Ok(Some(dir)) => {
            info!("[Rcoder] 找到 workspace_dir: {}", dir);
            std::path::PathBuf::from(dir)
        }
        Ok(None) => {
            // 如果没有配置，使用应用数据目录下的 workspace
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
            let default_workspace = app_data_dir.join("workspace");
            info!(
                "[Rcoder] 未找到 workspace_dir，使用默认值: {}",
                default_workspace.display()
            );
            default_workspace
        }
        Err(e) => {
            warn!("[Rcoder] 读取 workspace_dir 失败: {}，使用默认值", e);
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
            app_data_dir.join("workspace")
        }
    };

    // 创建 RcoderAgentRunner 配置
    // projects_dir 需要与 file-server 的 computer_workspace_dir 保持一致
    let config = RcoderAgentRunnerConfig {
        projects_dir: projects_dir.join("computer-project-workspace"),
        backend_port: port, // Agent HTTP 服务端口用于 pingora 反向代理
        ..RcoderAgentRunnerConfig::default()
    };
    info!("[Rcoder] 创建 RcoderAgentRunner 配置: {:?}", config);

    // 创建 RcoderAgentRunner 实例
    let agent_runner = Arc::new(RcoderAgentRunner::new(config).await);

    // 停止旧的 runner（如果存在），释放端口
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            info!("[Rcoder] 停止旧的 RcoderAgentRunner...");
            old_runner.stop().await;
            // 等待端口释放
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        }
        *runner_guard = Some(agent_runner.clone());
    }

    let manager = state.manager.lock().await;
    manager.rcoder_start(port, agent_runner).await?;
    Ok(true)
}

/// 停止 HTTP Server (rcoder)
#[tauri::command]
async fn rcoder_stop(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    // 停止 RcoderAgentRunner（包括 Pingora 代理）
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            old_runner.stop().await;
        }
    }
    let manager = state.manager.lock().await;
    manager.rcoder_stop().await?;
    Ok(true)
}

/// 重启 HTTP Server (rcoder)
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: HTTP Server 端口 (默认 9086)
#[tauri::command]
async fn rcoder_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    // 先停止
    {
        let manager = state.manager.lock().await;
        manager.rcoder_stop().await?;
    }
    // 等待端口释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    // 重新启动
    rcoder_start(app, state).await?;
    Ok(true)
}

/// 停止所有服务
#[tauri::command]
async fn services_stop_all(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    // 停止 RcoderAgentRunner（包括 Pingora 代理）
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            old_runner.stop().await;
        }
    }
    let manager = state.manager.lock().await;
    manager.services_stop_all().await?;
    Ok(true)
}

/// 重启所有服务
/// 重启所有服务
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: Agent 服务端口 (默认 9086)
/// - setup.file_server_port: 文件服务端口 (默认 60000)
/// - lanproxy.server_host: lanproxy 服务器地址 (从 API 返回)
/// - lanproxy.server_port: lanproxy 服务器端口 (从 API 返回)
/// - auth.saved_key: 客户端密钥
#[tauri::command]
async fn services_restart_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    info!("[Services] ========== 开始重启所有服务 ==========");

    // 停止所有服务
    info!("[Services] 1/4 停止所有服务...");
    {
        // 停止 RcoderAgentRunner（包括 Pingora 代理）
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            info!("[Services] 停止旧的 RcoderAgentRunner...");
            old_runner.stop().await;
        }
    }
    {
        let manager = state.manager.lock().await;
        manager.services_stop_all().await?;
    }
    info!("[Services] 所有服务已停止");

    // 等待端口释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    info!("[Services] 等待端口释放完成");

    // 重新启动所有服务（依次调用各个启动命令）
    // rcoder
    info!("[Services] 2/4 启动 Agent 服务 (rcoder)...");
    {
        let port = match read_store_port(&app, "setup.agent_port") {
            Ok(Some(p)) => {
                info!("[Services]   - 找到 agent_port: {}", p);
                p
            }
            Ok(None) => {
                let err = "配置缺失: setup.agent_port (Agent 服务端口)";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 setup.agent_port 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 读取工作区目录作为项目目录
        let projects_dir = match read_store_string(&app, "setup.workspace_dir") {
            Ok(Some(dir)) => {
                info!("[Services]   - 找到 workspace_dir: {}", dir);
                std::path::PathBuf::from(dir)
            }
            Ok(None) => {
                // 如果没有配置，使用应用数据目录下的 workspace
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                let default_workspace = app_data_dir.join("workspace");
                info!(
                    "[Services]   - 未找到 workspace_dir，使用默认值: {}",
                    default_workspace.display()
                );
                default_workspace
            }
            Err(e) => {
                warn!("[Services]   - 读取 workspace_dir 失败: {}，使用默认值", e);
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                app_data_dir.join("workspace")
            }
        };

        // 创建 RcoderAgentRunner 配置
        // projects_dir 需要与 file-server 的 computer_workspace_dir 保持一致
        let config = RcoderAgentRunnerConfig {
            projects_dir: projects_dir.join("computer-project-workspace"),
            ..RcoderAgentRunnerConfig::default()
        };
        info!("[Services]   - 创建 RcoderAgentRunner 配置: {:?}", config);

        // 创建 RcoderAgentRunner 实例
        let agent_runner = Arc::new(RcoderAgentRunner::new(config).await);

        // 存储新的 runner
        {
            let mut runner_guard = state.agent_runner.lock().await;
            *runner_guard = Some(agent_runner.clone());
        }

        let manager = state.manager.lock().await;
        manager.rcoder_start(port, agent_runner).await?;
        info!("[Services]   - Agent 服务启动命令已发送");
    }

    // file_server - 读取端口配置和 bin 路径
    info!("[Services] 3/4 启动文件服务 (nuwax-file-server)...");
    {
        // 获取 file_server 可执行文件路径
        let bin_path = match get_file_server_bin_path(&app) {
            Ok(path) => {
                info!("[Services]   - 可执行文件路径: {}", path);
                path
            }
            Err(e) => {
                let err = format!("获取 nuwax-file-server 路径失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 读取文件服务端口，如果没有配置则使用默认值 60000
        let port = match read_store_port(&app, "setup.file_server_port") {
            Ok(Some(p)) => {
                info!("[Services]   - 找到 file_server_port: {}", p);
                p
            }
            Ok(None) => {
                let default_port = 60000u16;
                info!(
                    "[Services]   - 未找到 file_server_port，使用默认值: {}",
                    default_port
                );
                default_port
            }
            Err(e) => {
                warn!(
                    "[Services]   - 读取 file_server_port 失败: {}，使用默认值 60000",
                    e
                );
                60000u16
            }
        };

        // 读取用户配置的工作区目录
        let workspace_dir = match read_store_string(&app, "setup.workspace_dir") {
            Ok(Some(dir)) => {
                info!("[Services]   - 找到 workspace_dir: {}", dir);
                dir
            }
            Ok(None) => {
                // 如果没有配置，使用应用数据目录下的 workspace
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                let default_workspace = app_data_dir.join("workspace");
                let default_workspace_str = default_workspace.to_string_lossy().to_string();
                info!(
                    "[Services]   - 未找到 workspace_dir，使用默认值: {}",
                    default_workspace_str
                );
                default_workspace_str
            }
            Err(e) => {
                warn!("[Services]   - 读取 workspace_dir 失败: {}，使用默认值", e);
                let app_data_dir = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
                app_data_dir.join("workspace").to_string_lossy().to_string()
            }
        };

        // 获取应用数据目录用于日志等
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
        let app_data_str = app_data_dir.to_string_lossy().to_string();

        // 使用完整配置启动，基于用户工作区目录设置各路径
        // workspace_dir 替换容器中的 /app 前缀
        let file_server_config = nuwax_agent_core::NuwaxFileServerConfig {
            bin_path,
            port,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: format!("{}/project_init", workspace_dir),
            upload_project_dir: format!("{}/project_zips", workspace_dir),
            project_source_dir: format!("{}/project_workspace", workspace_dir),
            dist_target_dir: format!("{}/project_nginx", workspace_dir),
            log_base_dir: format!("{}/logs/project_logs", app_data_str),
            computer_workspace_dir: format!("{}/computer-project-workspace", workspace_dir),
            computer_log_dir: format!("{}/logs/computer_logs", app_data_str),
        };

        // 打印完整配置用于调试
        info!("[Services]   - file_server_config:");
        info!("[Services]     env: {}", file_server_config.env);
        info!(
            "[Services]     init_project_dir: {}",
            file_server_config.init_project_dir
        );
        info!(
            "[Services]     upload_project_dir: {}",
            file_server_config.upload_project_dir
        );
        info!(
            "[Services]     project_source_dir: {}",
            file_server_config.project_source_dir
        );
        info!(
            "[Services]     dist_target_dir: {}",
            file_server_config.dist_target_dir
        );
        info!(
            "[Services]     log_base_dir: {}",
            file_server_config.log_base_dir
        );
        info!(
            "[Services]     computer_workspace_dir: {}",
            file_server_config.computer_workspace_dir
        );
        info!(
            "[Services]     computer_log_dir: {}",
            file_server_config.computer_log_dir
        );

        let manager = state.manager.lock().await;
        manager
            .file_server_start_with_config(file_server_config)
            .await?;
        info!("[Services]   - 文件服务启动命令已发送");
    }

    // lanproxy - 需要读取配置并调用 lanproxy_start_with_config
    info!("[Services] 4/4 启动代理服务 (nuwax-lanproxy)...");
    {
        // 读取 lanproxy server_host (从 API 返回)
        let server_host = match read_store_string(&app, "lanproxy.server_host") {
            Ok(Some(host)) => {
                info!("[Services]   - 找到 lanproxy.server_host: {}", host);
                host
            }
            Ok(None) => {
                let err = "配置缺失: lanproxy.server_host (lanproxy服务器地址) - 请先登录以获取服务器配置";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 lanproxy.server_host 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };
        let server_ip = strip_host_from_url(&server_host);
        info!("[Services]   - 处理后的服务器地址: {}", server_ip);

        // 读取 lanproxy server_port (从 API 返回)
        let server_port = match read_store_port(&app, "lanproxy.server_port") {
            Ok(Some(port)) => {
                info!("[Services]   - 找到 lanproxy.server_port: {}", port);
                port
            }
            Ok(None) => {
                let err = "配置缺失: lanproxy.server_port (lanproxy服务器端口) - 请先登录以获取服务器配置";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 lanproxy.server_port 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 读取 client_key
        let client_key = match read_store_string(&app, "auth.saved_key") {
            Ok(Some(key)) => {
                let masked = if key.len() > 8 {
                    format!("{}****{}", &key[..4], &key[key.len() - 4..])
                } else {
                    "****".to_string()
                };
                info!("[Services]   - 找到 client_key: {}", masked);
                key
            }
            Ok(None) => {
                let err = "配置缺失: auth.saved_key (客户端密钥)";
                error!("[Services]   - {}", err);
                return Err(err.to_string());
            }
            Err(e) => {
                let err = format!("读取 auth.saved_key 失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 获取 lanproxy 可执行文件完整路径
        let bin_path = match get_lanproxy_bin_path(&app) {
            Ok(path) => {
                info!("[Services]   - 可执行文件路径: {}", path);
                path
            }
            Err(e) => {
                let err = format!("获取 lanproxy 可执行文件路径失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };

        // 打印关键配置信息（注意脱敏）
        info!("[Services]   - 服务器地址: {}:{}", server_ip, server_port);
        info!(
            "[Services]   - 客户端密钥: {}****{}",
            &client_key[..client_key.len().saturating_sub(4).min(client_key.len())],
            if client_key.len() > 4 {
                &client_key[client_key.len() - 4..]
            } else {
                "****"
            }
        );

        let lanproxy_config = nuwax_agent_core::NuwaxLanproxyConfig {
            bin_path,
            server_ip,
            server_port,
            client_key,
        };

        let manager = state.manager.lock().await;
        manager.lanproxy_start_with_config(lanproxy_config).await?;
        info!("[Services]   - 代理服务启动命令已发送");
    }

    info!("[Services] ========== 所有服务重启命令已发送 ==========");
    Ok(true)
}

/// 获取所有服务状态
#[tauri::command]
async fn services_status_all(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<Vec<ServiceInfoDto>, String> {
    let manager = state.manager.lock().await;
    let statuses = manager.services_status_all().await;
    Ok(statuses.into_iter().map(|s| s.into()).collect())
}

// ========== npm 依赖管理命令 ==========

/// 安装 npm 依赖
#[tauri::command]
async fn dependency_npm_install(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .install(&name)
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

/// 查询 npm 依赖版本
#[tauri::command]
async fn dependency_npm_query_version(name: String) -> Result<Option<String>, String> {
    let manager = CoreDependencyManager::new();
    match manager.check(&name).await {
        Some(item) => Ok(item.version),
        None => Ok(None),
    }
}

/// 重新安装 npm 依赖
#[tauri::command]
async fn dependency_npm_reinstall(name: String) -> Result<bool, String> {
    let manager = CoreDependencyManager::new();
    manager
        .uninstall(&name)
        .await
        .map_err(|e| format!("卸载失败: {}", e))?;
    manager
        .install(&name)
        .await
        .map_err(|e| format!("安装失败: {}", e))?;
    Ok(true)
}

// ========== 初始化向导命令 ==========

use std::process::Command;

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

/// Shell Installer 包检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInstallerResult {
    pub installed: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
}

/// 获取应用数据目录路径
#[tauri::command]
fn app_data_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // 确保目录存在
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| format!("创建应用数据目录失败: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string())
}

/// 初始化本地 npm 环境（创建 package.json）
#[tauri::command]
async fn dependency_local_env_init(app: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = app_data_dir_get(app)?;
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
async fn dependency_node_detect() -> Result<NodeVersionResult, String> {
    let output = Command::new("node").arg("--version").output();

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
        }),
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
async fn dependency_uv_detect() -> Result<UvVersionResult, String> {
    let output = Command::new("uv").arg("--version").output();

    match output {
        Ok(out) if out.status.success() => {
            // uv 输出格式: "uv 0.5.14 (homebrew)"
            let output_str = String::from_utf8_lossy(&out.stdout).trim().to_string();

            // 提取版本号
            let version_str = output_str
                .split_whitespace()
                .nth(1) // 获取第二个部分（版本号）
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
                version: if version_str.is_empty() {
                    None
                } else {
                    Some(version_str)
                },
                meets_requirement: meets,
            })
        }
        _ => Ok(UvVersionResult {
            installed: false,
            version: None,
            meets_requirement: false,
        }),
    }
}

/// 检测本地 npm 包是否已安装
#[tauri::command]
async fn dependency_local_check(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<NpmPackageResult, String> {
    let app_dir = app_data_dir_get(app)?;
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
async fn dependency_local_install(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<InstallResult, String> {
    let app_dir = app_data_dir_get(app.clone())?;
    let registry = "https://registry.npmmirror.com/";

    // 确保 npm 环境已初始化
    dependency_local_env_init(app.clone()).await?;

    // 执行 npm install
    let output = Command::new("npm")
        .args([
            "install",
            &package_name,
            "--prefix",
            &app_dir,
            "--registry",
            registry,
        ])
        .output()
        .map_err(|e| format!("执行 npm install 失败: {}", e))?;

    if output.status.success() {
        // 获取安装的版本
        let result = dependency_local_check(app, package_name.clone()).await?;

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

/// 查询 npm 包的最新版本号
#[tauri::command]
async fn dependency_local_check_latest(package_name: String) -> Result<Option<String>, String> {
    let registry = "https://registry.npmmirror.com/";
    let output = Command::new("npm")
        .args(["view", &package_name, "version", "--registry", registry])
        .output()
        .map_err(|e| format!("执行 npm view 失败: {}", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if version.is_empty() {
            Ok(None)
        } else {
            Ok(Some(version))
        }
    } else {
        Ok(None)
    }
}

/// 检测 Shell Installer 安装的包是否已安装
#[tauri::command]
async fn dependency_shell_installer_check(
    bin_name: String,
) -> Result<ShellInstallerResult, String> {
    // 使用 which 命令检查二进制文件是否存在
    let which_output = Command::new("which").arg(&bin_name).output();

    match which_output {
        Ok(out) if out.status.success() => {
            let bin_path = String::from_utf8_lossy(&out.stdout).trim().to_string();

            // 尝试获取版本信息
            let version = Command::new(&bin_name)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| {
                    let output = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    // 尝试从输出中提取版本号
                    // 常见格式: "mcp-proxy 0.1.27" 或 "v0.1.27"
                    output
                        .split_whitespace()
                        .find(|s| {
                            s.chars()
                                .next()
                                .map(|c| c.is_ascii_digit() || c == 'v')
                                .unwrap_or(false)
                        })
                        .map(|s| s.trim_start_matches('v').to_string())
                        .unwrap_or(output)
                });

            Ok(ShellInstallerResult {
                installed: true,
                version,
                bin_path: Some(bin_path),
            })
        }
        _ => Ok(ShellInstallerResult {
            installed: false,
            version: None,
            bin_path: None,
        }),
    }
}

/// 使用 Shell 脚本安装包
#[tauri::command]
async fn dependency_shell_installer_install(
    installer_url: String,
    bin_name: String,
) -> Result<InstallResult, String> {
    // 先检查 curl 是否可用
    let curl_check = Command::new("curl").arg("--version").output();

    if curl_check.is_err() || !curl_check.unwrap().status.success() {
        return Ok(InstallResult {
            success: false,
            version: None,
            bin_path: None,
            error: Some("curl 未安装。请先安装 curl".to_string()),
        });
    }

    info!("[Dependency] 执行 shell 安装脚本: {}", installer_url);

    // 执行: curl --proto '=https' --tlsv1.2 -LsSf <url> | sh
    let output = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "curl --proto '=https' --tlsv1.2 -LsSf {} | sh",
            installer_url
        ))
        .output()
        .map_err(|e| format!("执行安装脚本失败: {}", e))?;

    if output.status.success() {
        // 验证安装并获取路径
        let check_result = dependency_shell_installer_check(bin_name.clone()).await?;

        if check_result.installed {
            Ok(InstallResult {
                success: true,
                version: check_result.version,
                bin_path: check_result.bin_path,
                error: None,
            })
        } else {
            // 脚本执行成功但二进制未找到，可能需要重新加载 PATH
            Ok(InstallResult {
                success: true,
                version: None,
                bin_path: None,
                error: Some(format!(
                    "安装脚本执行成功，但未找到 {} 二进制文件。可能需要重启终端或重新加载 PATH",
                    bin_name
                )),
            })
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        error!("[Dependency] shell 安装脚本失败: {}", stderr);

        Ok(InstallResult {
            success: false,
            version: None,
            bin_path: None,
            error: Some(format!("{}\n{}", stderr, stdout)),
        })
    }
}

// ========== 全局 npm 包管理命令 ==========

/// 检测全局 npm 包是否已安装
/// 通过检查可执行文件是否存在来判断
#[tauri::command]
async fn dependency_npm_global_check(bin_name: String) -> Result<NpmPackageResult, String> {
    // 使用 which 命令检查二进制文件是否存在
    let which_output = Command::new("which").arg(&bin_name).output();

    match which_output {
        Ok(out) if out.status.success() => {
            let bin_path = String::from_utf8_lossy(&out.stdout).trim().to_string();

            // 尝试获取版本信息 (使用 -V 参数)
            let version = Command::new(&bin_name)
                .arg("-V")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| {
                    let output = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    // 尝试从输出中提取版本号
                    // 常见格式: "mcp-proxy 0.1.27" 或 "v0.1.27" 或 "0.1.27"
                    output
                        .split_whitespace()
                        .find(|s| {
                            s.chars()
                                .next()
                                .map(|c| c.is_ascii_digit() || c == 'v')
                                .unwrap_or(false)
                        })
                        .map(|s| s.trim_start_matches('v').to_string())
                        .unwrap_or(output)
                });

            Ok(NpmPackageResult {
                installed: true,
                version,
                bin_path: Some(bin_path),
            })
        }
        _ => Ok(NpmPackageResult {
            installed: false,
            version: None,
            bin_path: None,
        }),
    }
}

/// 全局安装 npm 包（使用 npmmirror）
#[tauri::command]
async fn dependency_npm_global_install(
    package_name: String,
    bin_name: String,
) -> Result<InstallResult, String> {
    let registry = "https://registry.npmmirror.com/";

    info!(
        "[Dependency] 开始全局安装 npm 包: {} (registry: {})",
        package_name, registry
    );

    // 执行 npm install -g
    let output = Command::new("npm")
        .args([
            "install",
            "-g",
            &format!("{}@latest", package_name),
            "--registry",
            registry,
        ])
        .output()
        .map_err(|e| format!("执行 npm install -g 失败: {}", e))?;

    if output.status.success() {
        // 验证安装并获取路径
        let check_result = dependency_npm_global_check(bin_name.clone()).await?;

        if check_result.installed {
            info!(
                "[Dependency] {} 全局安装成功, 版本: {:?}",
                package_name, check_result.version
            );
            Ok(InstallResult {
                success: true,
                version: check_result.version,
                bin_path: check_result.bin_path,
                error: None,
            })
        } else {
            // 安装成功但二进制未找到，可能需要重新加载 PATH
            Ok(InstallResult {
                success: true,
                version: None,
                bin_path: None,
                error: Some(format!(
                    "npm install 执行成功，但未找到 {} 二进制文件。可能需要重启终端或重新加载 PATH",
                    bin_name
                )),
            })
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        error!("[Dependency] npm install -g 失败: {}", stderr);

        Ok(InstallResult {
            success: false,
            version: None,
            bin_path: None,
            error: Some(format!("{}\n{}", stderr, stdout)),
        })
    }
}

// ========== 开机自启动命令 ==========

use auto_launch::AutoLaunchBuilder;

/// 创建 AutoLaunch 实例
/// 根据当前运行的应用信息构建
fn create_auto_launch(app: &tauri::AppHandle) -> Result<auto_launch::AutoLaunch, String> {
    // 获取应用名称
    let app_name = "Nuwax Agent";

    // 获取应用可执行文件路径
    let exe_path = std::env::current_exe().map_err(|e| format!("获取应用路径失败: {}", e))?;

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

    builder
        .build()
        .map_err(|e| format!("创建 AutoLaunch 失败: {}", e))
}

/// 设置开机自启动
#[tauri::command]
async fn autolaunch_set(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let auto_launch = create_auto_launch(&app)?;

    if enabled {
        auto_launch
            .enable()
            .map_err(|e| format!("启用开机自启动失败: {}", e))?;
        log::info!("[autolaunch_set] 已启用开机自启动");
    } else {
        auto_launch
            .disable()
            .map_err(|e| format!("禁用开机自启动失败: {}", e))?;
        log::info!("[autolaunch_set] 已禁用开机自启动");
    }

    Ok(enabled)
}

/// 获取开机自启动状态
#[tauri::command]
async fn autolaunch_get(app: tauri::AppHandle) -> Result<bool, String> {
    let auto_launch = create_auto_launch(&app)?;
    let enabled = auto_launch
        .is_enabled()
        .map_err(|e| format!("获取开机自启动状态失败: {}", e))?;
    log::info!("[autolaunch_get] 当前状态: {}", enabled);
    Ok(enabled)
}

// ========== 系统托盘支持 ==========

/// 设置系统托盘
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::MenuItemKind;

    // 创建菜单项
    let show_i = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏主窗口", true, None::<&str>)?;
    let separator1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let services_start_i =
        MenuItem::with_id(app, "services_start", "启动服务", true, None::<&str>)?;
    let services_stop_i = MenuItem::with_id(app, "services_stop", "停止服务", true, None::<&str>)?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let autolaunch_i = MenuItem::with_id(app, "autolaunch", "开机自启动", true, None::<&str>)?;
    let separator3 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    // 构建菜单
    let menu = Menu::with_items(
        app,
        &[
            &MenuItemKind::MenuItem(show_i),
            &MenuItemKind::MenuItem(hide_i),
            &MenuItemKind::Predefined(separator1),
            &MenuItemKind::MenuItem(services_start_i),
            &MenuItemKind::MenuItem(services_stop_i),
            &MenuItemKind::Predefined(separator2),
            &MenuItemKind::MenuItem(autolaunch_i),
            &MenuItemKind::Predefined(separator3),
            &MenuItemKind::MenuItem(quit_i),
        ],
    )?;

    // 创建托盘图标
    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false) // 左键点击显示窗口，右键显示菜单
        .on_tray_icon_event(|tray, event| {
            // 左键点击显示主窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "services_start" => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<ServiceManagerState>();
                        // 调用服务重启逻辑
                        info!("[Tray] 启动服务...");
                        let manager = state.manager.lock().await;
                        if let Err(e) = manager.services_stop_all().await {
                            error!("[Tray] 停止服务失败: {}", e);
                        }
                        // 注意：完整启动需要配置，这里只做基础停止/启动
                        info!("[Tray] 服务操作完成，请通过主窗口启动服务");
                    });
                }
                "services_stop" => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<ServiceManagerState>();
                        let manager = state.manager.lock().await;
                        if let Err(e) = manager.services_stop_all().await {
                            error!("[Tray] 停止服务失败: {}", e);
                        } else {
                            info!("[Tray] 所有服务已停止");
                        }
                    });
                }
                "autolaunch" => {
                    // 切换开机自启动状态
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        match create_auto_launch(&app_handle) {
                            Ok(auto_launch) => {
                                let current = auto_launch.is_enabled().unwrap_or(false);
                                let result = if current {
                                    auto_launch.disable()
                                } else {
                                    auto_launch.enable()
                                };
                                match result {
                                    Ok(()) => info!(
                                        "[Tray] 开机自启动已{}",
                                        if current { "禁用" } else { "启用" }
                                    ),
                                    Err(e) => error!("[Tray] 切换开机自启动失败: {}", e),
                                }
                            }
                            Err(e) => error!("[Tray] 创建 AutoLaunch 失败: {}", e),
                        }
                    });
                }
                "quit" => {
                    // 停止服务后退出
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<ServiceManagerState>();
                        let manager = state.manager.lock().await;
                        if let Err(e) = manager.services_stop_all().await {
                            error!("[Tray] 退出前停止服务失败: {}", e);
                        }
                        info!("[Tray] 应用退出");
                        app_handle.exit(0);
                    });
                }
                _ => {}
            }
        })
        .build(app)?;

    info!("[Tray] 系统托盘已创建");
    Ok(())
}

/// 选择目录对话框
#[tauri::command]
async fn dialog_select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;

    // 使用 oneshot channel 接收回调结果
    let (tx, rx) = oneshot::channel();

    app.dialog().file().pick_folder(move |result| {
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

/// 获取日志目录路径
///
/// 返回应用日志目录的绝对路径，便于用户手动查看日志文件
#[tauri::command]
fn log_dir_get() -> String {
    nuwax_agent_core::Logger::get_log_dir()
        .to_string_lossy()
        .to_string()
}

/// 打开日志目录
///
/// 使用系统默认文件管理器打开日志目录，方便用户查看和分析日志
#[tauri::command]
async fn open_log_directory(app: tauri::AppHandle) -> Result<bool, String> {
    let log_dir = nuwax_agent_core::Logger::get_log_dir();
    // 使用 tauri_plugin_opener::open_path 打开目录
    let result = tauri_plugin_opener::open_path(&log_dir, None::<&str>);
    match result {
        Ok(()) => Ok(true),
        Err(e) => Err(format!("Failed to open log directory: {}", e)),
    }
}

/// 从日志文件读取最新日志
///
/// 读取最近的日志行，最新日志在最前面
/// 支持按行数限制返回数量
#[tauri::command]
async fn read_logs(count: Option<u32>) -> Result<Vec<String>, String> {
    let log_dir = nuwax_agent_core::Logger::get_log_dir();
    let count = count.unwrap_or(100) as usize;

    // 查找最新的日志文件（按修改时间排序）
    let mut log_files: Vec<_> = std::fs::read_dir(&log_dir)
        .map_err(|e| format!("Failed to read log directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|ext| ext == "log")
                .unwrap_or(false)
        })
        .collect();

    if log_files.is_empty() {
        return Ok(Vec::new());
    }

    // 按修改时间排序，最新的在前
    log_files.sort_by_key(|e| {
        std::cmp::Reverse(
            e.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
        )
    });

    // 读取最新的日志文件
    let latest_log = &log_files[0].path();

    // 读取文件内容
    let content = std::fs::read_to_string(latest_log)
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    // 按行分割并反转，使最新日志在最前面
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    lines.reverse();

    // 只返回指定数量的日志
    if lines.len() > count {
        lines.truncate(count);
    }

    Ok(lines)
}

// ========== 辅助函数 ==========

/// 获取包的可执行文件路径
fn get_package_bin_path(app_dir: &str, package_name: &str) -> Option<String> {
    // 从包名推断 bin 名称
    // 例如: @anthropic-ai/claude-code-acp-ts -> claude-code-acp-ts
    let bin_name = package_name.split('/').last().unwrap_or(package_name);

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
        let major = parts
            .get(0)
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let minor = parts
            .get(1)
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let patch = parts
            .get(2)
            .and_then(|s| {
                // 处理可能带有后缀的版本号，如 "22.0.0-beta"
                let numeric_part: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
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
    // ✅ 修复 macOS GUI 应用的 PATH 环境变量问题
    // macOS GUI 应用不继承 shell 的 PATH (如 nvm 设置的 PATH)
    // 这导致 claude-code-acp-ts, nuwaxcode 等通过 nvm 安装的命令找不到
    // 我们通过调用用户的默认 shell 来获取正确的 PATH
    #[cfg(target_os = "macos")]
    {
        match fix_macos_path_env() {
            Ok(()) => {
                // 验证 PATH 是否包含 nvm 目录
                if let Ok(path) = std::env::var("PATH") {
                    let has_nvm = path.contains(".nvm");
                    println!(
                        "[PATH Fix] PATH fixed successfully, has_nvm={}, entries={}",
                        has_nvm,
                        path.split(':').count()
                    );
                    if has_nvm {
                        // 打印 nvm 相关的路径
                        for p in path.split(':').filter(|p| p.contains("nvm")) {
                            println!("[PATH Fix]   nvm path: {}", p);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[PATH Fix] Failed to fix PATH environment: {}", e);
            }
        }
    }

    // ✅ 初始化 Rustls CryptoProvider（必须在最前面，在任何可能使用 TLS 的代码之前）
    // 这解决了 rustls 0.23 的 "Could not automatically determine the process-level CryptoProvider" 问题
    // 使用 once_cell 确保只初始化一次，避免多次调用导致 panic
    static INIT: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    let _ = INIT.get_or_init(|| {
        rustls::crypto::ring::default_provider()
            .install_default()
            .expect("Failed to install rustls crypto provider");
    });

    // 在其他代码之前初始化日志系统，使日志写入文件
    // 日志目录：macOS ~/Library/Application Support/nuwax-agent/logs/
    //          Linux ~/.local/share/nuwax-agent/logs/
    //          Windows %APPDATA%\nuwax-agent\logs\
    if let Err(e) = nuwax_agent_core::Logger::init("nuwax-agent") {
        eprintln!("[Logger] Failed to initialize logger: {}", e);
    }

    // 预定义合法的 Tab 名称列表，用于参数验证
    const VALID_TABS: &[&str] = &[
        "client",
        "settings",
        "dependencies",
        "permissions",
        "logs",
        "about",
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(PermissionsState::default())
        .manage(MonitorState::default())
        .manage(ServiceManagerState::default())
        // 设置托盘
        .setup(|app| {
            if let Err(e) = setup_tray(app) {
                error!("[Setup] 创建系统托盘失败: {}", e);
            }

            // ============================================
            // CLI 参数解析与导航事件处理
            // ============================================
            // 支持 --tab/-t 参数指定启动后跳转的 Tab
            // 示例: nuwax-agent --tab permissions
            //       nuwax-agent -t logs
            info!("[Setup] 开始解析 CLI 参数...");

            // 使用 tauri_plugin_cli 获取参数
            // 注意：在 tauri.conf.json 中已配置 cli args
            // 这里通过 ArgMatches 获取参数值

            // 尝试获取 CLI 插件实例（如果可用）
            #[cfg(feature = "cli-plugin")]
            {
                use tauri_plugin_cli::CliExt;
                let matches = app.cli().matches();

                match matches {
                    Ok(matches) => {
                        // 解析 --tab 参数
                        if let Some(tab) = matches.value_of("tab") {
                            // 验证 Tab 名称是否合法
                            if VALID_TABS.contains(&tab) {
                                info!("[Setup] 检测到 CLI 参数 --tab={}", tab);

                                // 发送事件通知前端目标 Tab
                                match app.emit("navigate-to-tab", tab) {
                                    Ok(()) => {
                                        info!("[Setup] 已发送导航事件到前端，目标 Tab: {}", tab);
                                    }
                                    Err(e) => {
                                        warn!("[Setup] 发送导航事件失败: {}", e);
                                    }
                                }
                            } else {
                                warn!("[Setup] 无效的 Tab 参数: {}，有效值: {:?}", tab, VALID_TABS);
                            }
                        }

                        // 检查 --minimized 参数（启动时最小化）
                        if matches.value_of("minimized") == Some("true")
                            || matches.occurrences_of("minimized") > 0
                        {
                            info!("[Setup] 检测到 --minimized 参数，启动时将最小化");
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                                info!("[Setup] 窗口已隐藏到托盘");
                            }
                        }
                    }
                    Err(e) => {
                        warn!("[Setup] CLI 参数解析结果: {}", e);
                    }
                }
            }

            // 没有 cli-plugin 时的日志提示
            #[cfg(not(feature = "cli-plugin"))]
            {
                info!("[Setup] CLI 插件未启用，命令行参数功能受限");
            }

            // ============================================
            // 跨平台信号处理器（Unix/macOS/Windows）
            // ============================================
            // 当使用 Ctrl+C 或 kill 命令终止应用时，主动清理子进程
            // 这是因为子进程使用了独立的进程组（Unix）或 JobObject（Windows），
            // 不会自动收到发送给父进程的终止信号
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // 跨平台：等待 Ctrl+C 或终止信号
                    #[cfg(unix)]
                    {
                        use tokio::signal::unix::{signal, SignalKind};

                        let mut sigint = signal(SignalKind::interrupt())
                            .expect("Failed to register SIGINT handler");
                        let mut sigterm = signal(SignalKind::terminate())
                            .expect("Failed to register SIGTERM handler");

                        tokio::select! {
                            _ = sigint.recv() => {
                                info!("[Signal] 收到 SIGINT 信号，正在清理子进程...");
                            }
                            _ = sigterm.recv() => {
                                info!("[Signal] 收到 SIGTERM 信号，正在清理子进程...");
                            }
                        }
                    }

                    #[cfg(windows)]
                    {
                        // Windows 上使用 ctrl_c() 处理 Ctrl+C
                        if let Err(e) = tokio::signal::ctrl_c().await {
                            error!("[Signal] 等待 Ctrl+C 信号失败: {}", e);
                            return;
                        }
                        info!("[Signal] 收到 Ctrl+C 信号，正在清理子进程...");
                    }

                    // 主动停止所有服务
                    let state = app_handle.state::<ServiceManagerState>();
                    let manager = state.manager.lock().await;
                    if let Err(e) = manager.services_stop_all().await {
                        error!("[Signal] 停止服务失败: {}", e);
                    }
                    info!("[Signal] 子进程已清理，应用即将退出");

                    // 退出应用
                    app_handle.exit(0);
                });
            }

            Ok(())
        })
        // 窗口关闭事件处理：隐藏到托盘而非退出
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 阻止默认关闭行为，改为隐藏窗口
                api.prevent_close();
                let _ = window.hide();
                info!("[Window] 窗口已隐藏到托盘");
            }
        })
        .invoke_handler(tauri::generate_handler![
            system_greet,
            check_disk_access,
            permission_check,
            permission_request,
            permission_open_settings,
            permission_list,
            permission_monitor_start,
            permission_monitor_stop,
            // 依赖管理命令
            dependency_list,
            dependency_summary,
            dependency_install,
            dependency_install_all,
            dependency_uninstall,
            dependency_check,
            // nuwax-lanproxy 命令
            lanproxy_start,
            lanproxy_stop,
            lanproxy_restart,
            // 服务管理命令
            file_server_start,
            file_server_stop,
            file_server_restart,
            rcoder_start,
            rcoder_stop,
            rcoder_restart,
            services_stop_all,
            services_restart_all,
            services_status_all,
            // npm 依赖管理命令
            dependency_npm_install,
            dependency_npm_query_version,
            dependency_npm_reinstall,
            // 初始化向导命令
            app_data_dir_get,
            dependency_local_env_init,
            dependency_node_detect,
            dependency_uv_detect,
            dependency_local_check,
            dependency_local_install,
            dependency_local_check_latest,
            dependency_shell_installer_check,
            dependency_shell_installer_install,
            dependency_npm_global_check,
            dependency_npm_global_install,
            dialog_select_directory,
            // 日志相关命令
            log_dir_get,
            open_log_directory,
            read_logs,
            // 开机自启动命令
            autolaunch_set,
            autolaunch_get,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 应用退出事件处理：在退出前清理所有服务
            if let tauri::RunEvent::Exit = event {
                info!("[Exit] 应用正在退出，停止所有服务...");
                // 同步阻塞等待服务停止
                let state = app_handle.state::<ServiceManagerState>();
                // 使用 tauri::async_runtime 执行异步清理
                tauri::async_runtime::block_on(async {
                    let manager = state.manager.lock().await;
                    if let Err(e) = manager.services_stop_all().await {
                        error!("[Exit] 停止服务失败: {}", e);
                    }
                });
                info!("[Exit] 所有服务已停止");
            }
        });
}

/// 修复 macOS GUI 应用的 PATH 环境变量问题
///
/// macOS GUI 应用（从 Finder、Dock 或 Spotlight 启动）不继承 shell 的环境变量。
/// 这导致通过 nvm、homebrew 等工具安装的命令（如 claude-code-acp-ts）找不到。
///
/// 该函数通过启动用户的默认 shell 并读取其 PATH 环境变量来解决此问题。
#[cfg(target_os = "macos")]
fn fix_macos_path_env() -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Command;

    // 获取用户的默认 shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // 通过 login shell 获取正确的 PATH
    // -l: 作为 login shell 启动，会读取 .zprofile, .zshrc 等配置文件
    // -c: 执行命令
    let output = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            // 获取当前 PATH 并合并
            let current_path = std::env::var("PATH").unwrap_or_default();

            // 合并 PATH，避免重复
            let mut paths: std::collections::HashSet<String> = std::collections::HashSet::new();
            let mut ordered_paths: Vec<String> = Vec::new();

            // 先添加 shell 的 PATH（优先级更高）
            for p in path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            // 再添加当前 PATH 中不重复的部分
            for p in current_path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            let new_path = ordered_paths.join(":");
            std::env::set_var("PATH", &new_path);

            eprintln!("[PATH Fix] Successfully fixed PATH environment");
            eprintln!(
                "[PATH Fix] New PATH includes: {} entries",
                ordered_paths.len()
            );
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Shell command failed: {}", stderr).into());
    }

    Ok(())
}

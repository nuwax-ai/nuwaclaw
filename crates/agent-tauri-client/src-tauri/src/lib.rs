// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#![allow(unexpected_cfgs)]
#[macro_use]
extern crate log;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use system_permissions::{
    create_permission_manager, create_permission_monitor, PermissionMonitor, PermissionState,
    SystemPermission,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State, Window,
};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

// ========== AgentRunnerApi 导入 ==========
use nuwax_agent_core::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};
use nuwax_agent_core::utils::{
    CommandNoWindowExt, DEFAULT_MCP_PROXY_CONFIG,
};

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

// ========== 托盘菜单 ID 常量 ==========
mod tray_ids {
    pub const SHOW: &str = "show";
    pub const SERVICES_RESTART: &str = "services_restart";
    pub const SERVICES_STOP: &str = "services_stop";
    pub const AUTOLAUNCH: &str = "autolaunch";
    pub const QUIT: &str = "quit";
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
/// - **macOS**：通过尝试访问用户主目录下的 Library/Application Support 判断是否已授予完全磁盘访问权限。
/// - **Windows / Linux**：无此系统级权限概念，直接返回 `Ok(true)`，避免路径与语义不兼容。
///
/// # 返回
/// - `Ok(true)` - 已获得权限（或当前平台无需此检查）
/// - `Ok(false)` - 未获得权限（仅 macOS）
/// - `Err(message)` - 检查过程中发生错误
#[tauri::command]
async fn check_disk_access() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        info!("[Permissions] 开始检查完全磁盘访问权限...");
        let home_dir = std::env::home_dir().ok_or("无法获取用户主目录")?;
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

    #[cfg(not(target_os = "macos"))]
    {
        // Windows / Linux 无“完全磁盘访问”同一语义，不检测，直接视为通过
        Ok(true)
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
            if !(0..=65535).contains(&n) {
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

/// 从 store 读取布尔配置（如是否捕获 file-server 日志到 agent）
///
/// # 返回
/// - `Ok(Some(value))`: 成功读取
/// - `Ok(None)`: 键不存在或类型非布尔
/// - `Err(message)`: store 打开失败
fn read_store_bool(app: &tauri::AppHandle, key: &str) -> Result<Option<bool>, String> {
    let store = match app.store("nuwax_store.bin") {
        Ok(store) => store,
        Err(e) => return Err(format!("无法打开 store 文件: {}", e)),
    };
    match store.get(key) {
        Some(value) => {
            if let Some(b) = value.as_bool() {
                debug!("[Store] 成功读取 '{}' = {}", key, b);
                Ok(Some(b))
            } else {
                debug!("[Store] 键 '{}' 类型不是布尔，忽略", key);
                Ok(None)
            }
        }
        None => {
            debug!("[Store] 键不存在: '{}'", key);
            Ok(None)
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

// ========== 可执行文件路径解析（公共方法，供 file-server / mcp-proxy / lanproxy 等复用） ==========

/// 在候选路径中返回第一个存在的路径及其标签，用于统一「按顺序查找可执行文件」逻辑。
///
/// # 参数
/// - `candidates`: 按优先级排列的 `(路径, 标签)` 列表，标签用于日志
/// - `bin_name`: 可执行文件名，用于日志输出
///
/// # 返回
/// 若存在则返回 `Some((路径字符串, 标签))`，并打 info 日志；否则 `None`
fn first_existing_bin_path(
    candidates: &[(std::path::PathBuf, &'static str)],
    bin_name: &str,
) -> Option<(String, &'static str)> {
    for (path, label) in candidates {
        if path.exists() {
            let s = path.to_string_lossy().to_string();
            info!("[BinPath] {} 找到({}): {}", bin_name, label, s);
            return Some((s, label));
        }
    }
    None
}

/// 获取打包资源目录（.app 包内的 resources 目录）
///
/// 返回路径：{resource_dir}/resources
/// 结构：
/// - resources/node/bin/node (Node.js 运行时)
/// - resources/node/lib/node_modules/ (npm 等模块)
/// - resources/uv/bin/uv (uv 包管理器)
fn app_bundled_resources_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("获取资源目录失败: {}", e))?;
    Ok(resource_dir.join("resources"))
}

/// 获取打包的 Node.js 根目录（直接使用 .app 包内资源，不再复制）
///
/// 返回路径：{resource_dir}/resources/node
/// 保持 macOS 代码签名，避免 V8 SIGTRAP 崩溃
fn app_runtime_node_root_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // 优先使用打包资源目录
    let bundled_dir = app_bundled_resources_dir(app)?.join("node");

    // 开发模式回退：尝试从当前目录和 CARGO_MANIFEST_DIR 查找
    if !bundled_dir.exists() {
        let dev_path = std::env::current_dir()
            .unwrap_or_default()
            .join("resources")
            .join("node");
        if dev_path.exists() {
            debug!("[Runtime] 使用开发模式 Node.js 路径: {:?}", dev_path);
            return Ok(dev_path);
        }

        let manifest_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("node");
        if manifest_path.exists() {
            debug!("[Runtime] 使用 CARGO_MANIFEST_DIR Node.js 路径: {:?}", manifest_path);
            return Ok(manifest_path);
        }
    }

    Ok(bundled_dir)
}

/// 获取打包的 uv bin 目录（直接使用 .app 包内资源，不再复制）
///
/// 返回路径：{resource_dir}/resources/uv/bin
fn app_runtime_bin_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // 优先使用打包资源目录
    let bundled_dir = app_bundled_resources_dir(app)?.join("uv").join("bin");

    // 开发模式回退
    if !bundled_dir.exists() {
        let dev_path = std::env::current_dir()
            .unwrap_or_default()
            .join("resources")
            .join("uv")
            .join("bin");
        if dev_path.exists() {
            debug!("[Runtime] 使用开发模式 uv 路径: {:?}", dev_path);
            return Ok(dev_path);
        }

        let manifest_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("uv")
            .join("bin");
        if manifest_path.exists() {
            debug!("[Runtime] 使用 CARGO_MANIFEST_DIR uv 路径: {:?}", manifest_path);
            return Ok(manifest_path);
        }
    }

    Ok(bundled_dir)
}

/// 获取 Node.js bin 目录路径
fn app_runtime_node_bin_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_runtime_node_root_dir(app)?.join("bin"))
}

/// 获取 Node.js 可执行文件路径（直接使用 .app 包内资源）
fn app_runtime_node_bin_path(app: &tauri::AppHandle, bin_name: &str) -> Result<String, String> {
    let node_bin_dir = app_runtime_node_bin_dir(app)?;
    #[cfg(unix)]
    let bin = node_bin_dir.join(bin_name);
    #[cfg(windows)]
    let bin = if bin_name == "node" {
        node_bin_dir.join("node.exe")
    } else {
        node_bin_dir.join(format!("{}.cmd", bin_name))
    };
    Ok(bin.to_string_lossy().to_string())
}

/// 构建 PATH 环境变量（使用 .app 包内资源路径）
///
/// 优先顺序：node/bin > uv/bin > 系统 PATH
fn build_app_runtime_path_env(app: &tauri::AppHandle) -> Result<String, String> {
    let current = std::env::var("PATH").unwrap_or_default();
    let runtime_dirs = build_app_runtime_dirs(app)?;
    #[cfg(windows)]
    let sep = ";";
    #[cfg(not(windows))]
    let sep = ":";
    Ok(format!("{}{}{}", runtime_dirs, sep, current))
}

/// 仅返回我们管理的运行时目录（不包含系统 PATH），供 NUWAX_APP_RUNTIME_PATH 使用。
fn build_app_runtime_dirs(app: &tauri::AppHandle) -> Result<String, String> {
    let node_bin = app_runtime_node_root_dir(app)?.join("bin");
    let uv_bin = app_runtime_bin_dir(app)?;
    #[cfg(windows)]
    let sep = ";";
    #[cfg(not(windows))]
    let sep = ":";
    Ok(format!(
        "{}{}{}",
        node_bin.to_string_lossy(),
        sep,
        uv_bin.to_string_lossy()
    ))
}

fn resolve_npm_registry(app: Option<&tauri::AppHandle>) -> String {
    const DEFAULT_REGISTRY: &str = "https://registry.npmmirror.com/";
    const ENV_KEY: &str = "NUWAX_NPM_REGISTRY";
    const STORE_KEYS: [&str; 2] = ["setup.npm_registry", "dependency.npm_registry"];

    if let Ok(v) = std::env::var(ENV_KEY) {
        let v = v.trim();
        if !v.is_empty() {
            info!("[Dependency] 使用 npm registry(ENV): {}", v);
            return v.to_string();
        }
    }

    if let Some(app) = app {
        for key in STORE_KEYS {
            match read_store_string(app, key) {
                Ok(Some(v)) if !v.trim().is_empty() => {
                    info!("[Dependency] 使用 npm registry(Store:{}): {}", key, v.trim());
                    return v.trim().to_string();
                }
                Ok(_) => {}
                Err(e) => debug!("[Dependency] 读取 npm registry 配置失败 key={}: {}", key, e),
            }
        }
    }

    info!("[Dependency] 使用默认 npm registry: {}", DEFAULT_REGISTRY);
    DEFAULT_REGISTRY.to_string()
}

fn npm_tarball_cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let dir = cache_dir.join("npm-tarballs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 npm 缓存目录失败: {}", e))?;
    Ok(dir)
}

fn npm_runtime_cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let dir = cache_dir.join("npm-cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 npm cache 目录失败: {}", e))?;
    Ok(dir)
}

fn npm_runtime_logs_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let dir = log_dir.join("npm");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 npm 日志目录失败: {}", e))?;
    Ok(dir)
}

fn npm_tarball_prefix(package_name: &str) -> String {
    let normalized = package_name.trim_start_matches('@').replace('/', "-");
    format!("{}-", normalized)
}

fn find_cached_npm_tarball(
    app: &tauri::AppHandle,
    package_name: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let cache_dir = npm_tarball_cache_dir(app)?;
    let prefix = npm_tarball_prefix(package_name);
    let mut candidates: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();

    let entries = std::fs::read_dir(&cache_dir)
        .map_err(|e| format!("读取 npm 缓存目录失败 {}: {}", cache_dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取 npm 缓存目录项失败: {}", e))?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".tgz") || !name.starts_with(&prefix) {
            continue;
        }
        let modified = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        candidates.push((path, modified));
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(candidates.into_iter().next().map(|(p, _)| p))
}

async fn npm_prefetch_tarball(
    app: &tauri::AppHandle,
    package_name: &str,
    registry: &str,
) -> Result<std::path::PathBuf, String> {
    let cache_dir = npm_tarball_cache_dir(app)?;
    let npm_bin = app_runtime_node_bin_path(app, "npm")?;
    let node_path = build_app_runtime_path_env(app)?;

    info!(
        "[Dependency] 预下载 npm 包到本地: {} -> {}",
        package_name,
        cache_dir.display()
    );
    let output = run_npm_command_with_timeout(
        app,
        &npm_bin,
        &node_path,
        vec![
            "pack".to_string(),
            package_name.to_string(),
            "--pack-destination".to_string(),
            cache_dir.to_string_lossy().to_string(),
            "--registry".to_string(),
            registry.to_string(),
        ],
        60,
        "npm pack",
    )
    .await?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "npm pack 失败 (package={}, code={:?}): stdout='{}' stderr='{}'",
            package_name,
            output.status.code(),
            stdout,
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let packed_name = stdout
        .lines()
        .map(str::trim)
        .rev()
        .find(|line| line.ends_with(".tgz"))
        .map(str::to_string);

    if let Some(name) = packed_name {
        let path = cache_dir.join(name);
        if path.exists() {
            return Ok(path);
        }
    }

    find_cached_npm_tarball(app, package_name)?.ok_or_else(|| {
        format!(
            "npm pack 成功但未找到本地 tarball (package={}, cache={})",
            package_name,
            cache_dir.display()
        )
    })
}

async fn run_npm_command_with_timeout(
    app: &tauri::AppHandle,
    npm_bin: &str,
    node_path: &str,
    args: Vec<String>,
    timeout_secs: u64,
    phase: &str,
) -> Result<std::process::Output, String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    info!(
        "[Dependency] 执行 {}: bin={} args={:?} timeout={}s",
        phase, npm_bin, args, timeout_secs
    );
    let started = Instant::now();

    let npm_cache_dir = npm_runtime_cache_dir(app)?;
    let npm_logs_dir = npm_runtime_logs_dir(app)?;
    #[cfg(target_os = "macos")]
    let node_options = match std::env::var("NODE_OPTIONS") {
        Ok(v) if !v.trim().is_empty() => format!("{} --jitless", v),
        _ => "--jitless".to_string(),
    };

    let node_bin = app_runtime_node_bin_path(app, "node")?;
    let npm_cli = app_runtime_node_root_dir(app)?
        .join("lib")
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");

    let mut cmd = if npm_cli.exists() {
        info!(
            "[Dependency] {} 使用 node+npm-cli 执行: node={} npm_cli={}",
            phase,
            node_bin,
            npm_cli.display()
        );
        let mut c = tokio::process::Command::new(&node_bin);
        #[cfg(target_os = "macos")]
        {
            // In macOS sandbox/hardened runtime combinations, V8 JIT init may trap.
            // Force jitless mode for npm-related short-lived commands.
            c.arg("--jitless");
        }
        c.arg(npm_cli);
        c
    } else {
        warn!(
            "[Dependency] {} 未找到 npm-cli.js，回退直接执行 npm: {}",
            phase, npm_bin
        );
        tokio::process::Command::new(npm_bin)
    };

    cmd.no_window();
    cmd.env("PATH", node_path);
    cmd.env("NPM_CONFIG_CACHE", npm_cache_dir.to_string_lossy().to_string());
    cmd.env("NPM_CONFIG_LOGS_DIR", npm_logs_dir.to_string_lossy().to_string());
    cmd.env("SCARF_ANALYTICS", "false");
    cmd.env("npm_config_scarf_analytics", "false");
    cmd.env("SCARF_NO_ANALYTICS", "true");
    cmd.env("npm_config_fund", "false");
    cmd.env("npm_config_audit", "false");
    #[cfg(target_os = "macos")]
    {
        cmd.env("NODE_OPTIONS", node_options);
    }
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);
    let child = cmd
        .spawn()
        .map_err(|e| format!("{} 启动失败: {}", phase, e))?;

    let waited =
        tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait_with_output()).await;

    let output = match waited {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("{} 执行失败: {}", phase, e)),
        Err(_) => {
            return Err(format!(
                "{} 超时({}s)，请检查 npm registry/网络连通性",
                phase, timeout_secs
            ));
        }
    };

    let elapsed = started.elapsed().as_millis();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr_preview = stderr.lines().take(8).collect::<Vec<_>>().join(" | ");
    let stdout_preview = stdout.lines().take(8).collect::<Vec<_>>().join(" | ");
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(&output.status);
    #[cfg(not(unix))]
    let signal: Option<i32> = None;
    info!(
        "[Dependency] {} 完成: success={} code={:?} signal={:?} elapsed={}ms stdout_preview={} stderr_preview={}",
        phase,
        output.status.success(),
        output.status.code(),
        signal,
        elapsed,
        stdout_preview,
        stderr_preview
    );
    Ok(output)
}

/// 解析通过 npm 安装的可执行文件路径（应用内 node_modules/.bin）。
///
/// 查找顺序：
/// 1. 应用数据目录：`<app_data_dir>/node_modules/.bin/{bin_name}`
///
/// # 参数
/// - `app`: Tauri AppHandle
/// - `bin_name`: 可执行文件名（如 `nuwax-file-server`、`mcp-proxy`）
/// - `missing_hint`: 未找到时错误信息中的提示（如「请在「依赖」页面安装 xxx」）
fn resolve_npm_global_bin_path(
    app: &tauri::AppHandle,
    bin_name: &str,
    missing_hint: &str,
) -> Result<String, String> {
    let app_data_dir = app_data_dir_get(app.clone())
        .map(std::path::PathBuf::from)
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    let local_bin = app_data_dir
        .join("node_modules")
        .join(".bin")
        .join(bin_name);

    let candidates: Vec<(std::path::PathBuf, &'static str)> = vec![(local_bin, "本地")];

    if let Some((path, _)) = first_existing_bin_path(&candidates, bin_name) {
        return Ok(path);
    }

    Err(format!("未找到 {} 可执行文件，{}", bin_name, missing_hint))
}

#[cfg(windows)]
fn resolve_local_npm_package_js_entry(
    app: &tauri::AppHandle,
    package_name: &str,
    bin_name: &str,
) -> Result<Option<String>, String> {
    let app_data_dir = app_data_dir_get(app.clone())
        .map(std::path::PathBuf::from)
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let package_dir = app_data_dir.join("node_modules").join(package_name);
    if !package_dir.exists() {
        return Ok(None);
    }

    let package_json_path = package_dir.join("package.json");
    let content = match std::fs::read_to_string(&package_json_path) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "[Dependency] 读取 package.json 失败，回退 .bin 路径: {} ({})",
                package_json_path.display(),
                e
            );
            return Ok(None);
        }
    };
    let package_json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "[Dependency] 解析 package.json 失败，回退 .bin 路径: {} ({})",
                package_json_path.display(),
                e
            );
            return Ok(None);
        }
    };

    let rel_entry = if let Some(bin_str) = package_json.get("bin").and_then(|v| v.as_str()) {
        Some(bin_str.to_string())
    } else if let Some(bin_obj) = package_json.get("bin").and_then(|v| v.as_object()) {
        bin_obj
            .get(bin_name)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| {
                bin_obj
                    .get(package_name)
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .or_else(|| {
                bin_obj
                    .values()
                    .find_map(|v| v.as_str())
                    .map(str::to_string)
            })
    } else {
        None
    };

    let Some(rel_entry) = rel_entry else {
        return Ok(None);
    };
    let entry = package_dir.join(rel_entry);
    if entry.exists() {
        Ok(Some(entry.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// 解析随应用打包的可执行文件路径（binaries / externalBin），兼容 macOS / Windows / Linux。
///
/// Tauri 各平台 resource_dir / exe 位置（参考）：
/// - **macOS**: exe 在 `Contents/MacOS/`，externalBin 同目录；resource_dir = `Contents/Resources/`
/// - **Windows**: resource_dir = 主程序所在目录，externalBin 通常与 exe 同目录
/// - **Linux**: resource_dir = `/usr/lib/${exe_name}` 或 AppImage 内 `usr/lib/...`；exe 可能在 `/usr/bin/`，externalBin 可能在 resource_dir 或与 exe 同目录
///
/// 查找顺序：
/// 1. resource_dir/binaries/{bin_name}
/// 2. resource_dir/{bin_name}（Linux 等可能平铺在 resource_dir）
/// 3. exe 同目录（macOS Contents/MacOS/、Windows 主程序目录）
/// 4. exe 同目录/binaries/
/// 5. CARGO_MANIFEST_DIR/binaries/（开发）
/// 6. cwd/.../src-tauri/binaries/（开发）
fn resolve_bundled_bin_path(app: &tauri::AppHandle, bin_name: &str) -> Result<String, String> {
    let mut candidates: Vec<(std::path::PathBuf, &'static str)> = vec![];

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push((
            resource_dir.join("binaries").join(bin_name),
            "resource/binaries",
        ));
        candidates.push((resource_dir.join(bin_name), "resource 平铺"));
    }

    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    {
        candidates.push((exe_dir.join(bin_name), "exe 同目录"));
        candidates.push((exe_dir.join("binaries").join(bin_name), "exe/binaries"));
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push((
            std::path::Path::new(&manifest_dir)
                .join("binaries")
                .join(bin_name),
            "manifest",
        ));
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push((
            cwd.join("crates/agent-tauri-client/src-tauri/binaries")
                .join(bin_name),
            "cwd",
        ));
    }

    if let Some((path, _)) = first_existing_bin_path(&candidates, bin_name) {
        return Ok(path);
    }

    Err(format!("未找到 {} 可执行文件", bin_name))
}

/// 获取 nuwax-file-server 可执行文件完整路径
///
/// 优先顺序：
/// 1. sidecar / bundled（若后续接入 externalBin）
/// 2. 开发态 triple 命名（src-tauri/binaries）
/// 3. 应用内 npm 本地安装路径（node_modules/.bin/nuwax-file-server）
fn get_file_server_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(windows))]
    const SIDECAR_BASE_NAME: &str = "nuwax-file-server";
    #[cfg(windows)]
    const SIDECAR_BASE_NAME: &str = "nuwax-file-server.exe";

    if let Ok(path) = resolve_bundled_bin_path(app, SIDECAR_BASE_NAME) {
        return Ok(path);
    }

    #[cfg(target_os = "macos")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "nuwax-file-server-aarch64-apple-darwin"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "nuwax-file-server-x86_64-apple-darwin"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            "nuwax-file-server-universal-apple-darwin"
        }
    };

    #[cfg(target_os = "linux")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "nuwax-file-server-aarch64-unknown-linux-gnu"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "nuwax-file-server-x86_64-unknown-linux-gnu"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            "nuwax-file-server-unknown-linux"
        }
    };

    #[cfg(target_os = "windows")]
    let bin_name = {
        #[cfg(target_arch = "x86_64")]
        {
            "nuwax-file-server-x86_64-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "x86")]
        {
            "nuwax-file-server-i686-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "aarch64")]
        {
            "nuwax-file-server-aarch64-pc-windows-msvc.exe"
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "x86", target_arch = "aarch64")))]
        {
            "nuwax-file-server-unknown-windows.exe"
        }
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let bin_name = "nuwax-file-server";

    if let Ok(path) = resolve_bundled_bin_path(app, bin_name) {
        return Ok(path);
    }

    #[cfg(windows)]
    {
        // Windows 优先使用 npm 包内 JS 入口，避免 .bin/.cmd shim 引发的控制台窗口链路。
        if let Some(js_entry) =
            resolve_local_npm_package_js_entry(app, "nuwax-file-server", "nuwax-file-server")?
        {
            return Ok(js_entry);
        }
    }

    resolve_npm_global_bin_path(
        app,
        "nuwax-file-server",
        "未找到内置 nuwax-file-server，请在「依赖」页面安装 Nuwax File Server",
    )
}

/// 获取当前平台的 nuwax-lanproxy 可执行文件完整路径（复用 resolve_bundled_bin_path）
///
/// nuwax-lanproxy 通过 Tauri 的 externalBin（sidecar）随应用包集成，无需用户单独安装。
/// 查找顺序：
/// 1. **打包环境**：先按 sidecar 基名查找（与 app.shell().sidecar("nuwax-lanproxy") 一致），
///    打包后 Tauri 将二进制放在主程序同目录且可能使用基名。
/// 2. **开发环境**：再按带 target triple 的文件名查找（src-tauri/binaries/ 下为 triple 命名）。
fn get_lanproxy_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    /// sidecar 基名：与 tauri.conf.json 中 externalBin "binaries/nuwax-lanproxy" 对应，打包后同目录下的文件名。
    #[cfg(not(windows))]
    const SIDECAR_BASE_NAME: &str = "nuwax-lanproxy";
    #[cfg(windows)]
    const SIDECAR_BASE_NAME: &str = "nuwax-lanproxy.exe";

    // 1. 优先按 sidecar 基名解析（应用包内 Tauri 放置的 sidecar 通常为该名称）
    if let Ok(path) = resolve_bundled_bin_path(app, SIDECAR_BASE_NAME) {
        return Ok(path);
    }

    // 2. 回退到带 target triple 的文件名（开发态 src-tauri/binaries/ 下的命名）
    #[cfg(target_os = "macos")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "nuwax-lanproxy-aarch64-apple-darwin"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "nuwax-lanproxy-x86_64-apple-darwin"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            "nuwax-lanproxy-universal-apple-darwin"
        }
    };

    #[cfg(target_os = "linux")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "nuwax-lanproxy-aarch64-unknown-linux-gnu"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "nuwax-lanproxy-x86_64-unknown-linux-gnu"
        }
        #[cfg(target_arch = "arm")]
        {
            "nuwax-lanproxy-arm-unknown-linux-gnueabi"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64", target_arch = "arm")))]
        {
            "nuwax-lanproxy-unknown-linux"
        }
    };

    #[cfg(target_os = "windows")]
    let bin_name = {
        #[cfg(target_arch = "x86_64")]
        {
            "nuwax-lanproxy-x86_64-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "x86")]
        {
            "nuwax-lanproxy-i686-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "aarch64")]
        {
            "nuwax-lanproxy-aarch64-pc-windows-msvc.exe"
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "x86", target_arch = "aarch64")))]
        {
            "nuwax-lanproxy-unknown-windows.exe"
        }
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let bin_name = "nuwax-lanproxy";

    resolve_bundled_bin_path(app, bin_name)
}

/// 获取当前平台的 mcp-proxy 可执行文件完整路径
///
/// 优先顺序：
/// 1. sidecar（externalBin）打包路径
/// 2. 应用内 npm 本地安装路径（node_modules/.bin/mcp-proxy）
fn get_mcp_proxy_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(windows))]
    const SIDECAR_BASE_NAME: &str = "mcp-proxy";
    #[cfg(windows)]
    const SIDECAR_BASE_NAME: &str = "mcp-proxy.exe";

    // 1) sidecar 基名（打包后常见命名）
    if let Ok(path) = resolve_bundled_bin_path(app, SIDECAR_BASE_NAME) {
        return Ok(path);
    }

    // 2) 开发态/按 target triple 命名的 sidecar 文件
    #[cfg(target_os = "macos")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "mcp-proxy-aarch64-apple-darwin"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "mcp-proxy-x86_64-apple-darwin"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            "mcp-proxy-universal-apple-darwin"
        }
    };

    #[cfg(target_os = "linux")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "mcp-proxy-aarch64-unknown-linux-gnu"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "mcp-proxy-x86_64-unknown-linux-gnu"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            "mcp-proxy-unknown-linux"
        }
    };

    #[cfg(target_os = "windows")]
    let bin_name = {
        #[cfg(target_arch = "x86_64")]
        {
            "mcp-proxy-x86_64-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "x86")]
        {
            "mcp-proxy-i686-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "aarch64")]
        {
            "mcp-proxy-aarch64-pc-windows-msvc.exe"
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "x86", target_arch = "aarch64")))]
        {
            "mcp-proxy-unknown-windows.exe"
        }
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let bin_name = "mcp-proxy";

    if let Ok(path) = resolve_bundled_bin_path(app, bin_name) {
        return Ok(path);
    }

    // 3) 回退 npm 本地安装
    resolve_npm_global_bin_path(app, "mcp-proxy", "请在「依赖」页面安装 MCP Proxy")
}

/// Windows: 查找 Git Bash 路径
#[cfg(windows)]
fn find_git_bash_path_windows() -> Option<String> {
    nuwax_agent_core::utils::find_git_bash_path()
}

/// 获取 node-runtime sidecar 路径（可选）
///
/// 仅用于在运行时优先注入固定 Node 可执行文件路径，避免依赖系统 PATH。
/// 找不到时返回 Err，由调用方决定是否回退。
fn get_node_runtime_sidecar_bin_path(app: &tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(windows))]
    const SIDECAR_BASE_NAME: &str = "node-runtime";
    #[cfg(windows)]
    const SIDECAR_BASE_NAME: &str = "node-runtime.exe";

    // 1) sidecar 基名（打包后常见命名）
    if let Ok(path) = resolve_bundled_bin_path(app, SIDECAR_BASE_NAME) {
        return Ok(path);
    }

    // 2) 开发态/按 target triple 命名
    #[cfg(target_os = "macos")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "node-runtime-aarch64-apple-darwin"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "node-runtime-x86_64-apple-darwin"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            "node-runtime-universal-apple-darwin"
        }
    };

    #[cfg(target_os = "linux")]
    let bin_name = {
        #[cfg(target_arch = "aarch64")]
        {
            "node-runtime-aarch64-unknown-linux-gnu"
        }
        #[cfg(target_arch = "x86_64")]
        {
            "node-runtime-x86_64-unknown-linux-gnu"
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            "node-runtime-unknown-linux"
        }
    };

    #[cfg(target_os = "windows")]
    let bin_name = {
        #[cfg(target_arch = "x86_64")]
        {
            "node-runtime-x86_64-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "x86")]
        {
            "node-runtime-i686-pc-windows-msvc.exe"
        }
        #[cfg(target_arch = "aarch64")]
        {
            "node-runtime-aarch64-pc-windows-msvc.exe"
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "x86", target_arch = "aarch64")))]
        {
            "node-runtime-unknown-windows.exe"
        }
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let bin_name = "node-runtime";

    resolve_bundled_bin_path(app, bin_name)
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
    sync_local_bin_env(&app)?;
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
            debug!("[Lanproxy] 可执行文件路径: {}", path);
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

// ========== MCP Proxy 命令 ==========

fn is_npx_command(command: &str) -> bool {
    let lower = command.trim().to_ascii_lowercase();
    if lower == "npx" || lower.ends_with("/npx") || lower.ends_with("\\npx") {
        return true;
    }
    if lower == "npx.cmd"
        || lower.ends_with("/npx.cmd")
        || lower.ends_with("\\npx.cmd")
        || lower == "npx.exe"
        || lower.ends_with("/npx.exe")
        || lower.ends_with("\\npx.exe")
    {
        return true;
    }
    false
}

fn package_name_from_npx_spec(spec: &str) -> Option<String> {
    let spec = spec.trim();
    if spec.is_empty() {
        return None;
    }
    if spec.starts_with('@') {
        // scoped package: @scope/name@version -> @scope/name
        if let Some(pos) = spec[1..].find('@') {
            return Some(spec[..pos + 1].to_string());
        }
        return Some(spec.to_string());
    }
    Some(spec.split('@').next().unwrap_or(spec).to_string())
}

fn parse_npx_package_and_forward_args(args: &[String]) -> Option<(String, Vec<String>)> {
    let mut idx = 0usize;
    while idx < args.len() {
        let arg = args[idx].trim();
        if arg.is_empty() {
            idx += 1;
            continue;
        }
        if arg == "--" {
            break;
        }
        if matches!(arg, "-y" | "--yes" | "-q" | "--quiet" | "--no")
            || arg.starts_with("--registry=")
            || arg.starts_with("--cache=")
        {
            idx += 1;
            continue;
        }
        if matches!(arg, "-p" | "--package" | "-c" | "--call") {
            idx += 2;
            continue;
        }
        if arg.starts_with('-') {
            idx += 1;
            continue;
        }
        let package_spec = args[idx].clone();
        let forward_args = args[idx + 1..].to_vec();
        return Some((package_spec, forward_args));
    }
    None
}

fn resolve_local_bin_from_package_name(app: &tauri::AppHandle, package_name: &str) -> Option<String> {
    let app_data_dir = app_data_dir_get(app.clone()).ok()?;
    let app_data_dir = std::path::PathBuf::from(app_data_dir);
    let package_dir = app_data_dir.join("node_modules").join(package_name);
    if !package_dir.exists() {
        return None;
    }

    let package_json_path = package_dir.join("package.json");
    let content = std::fs::read_to_string(&package_json_path).ok()?;
    let package_json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let default_bin_name = package_name
        .rsplit('/')
        .next()
        .unwrap_or(package_name)
        .to_string();
    let bin_name = if package_json.get("bin").and_then(|v| v.as_str()).is_some() {
        default_bin_name
    } else if let Some(bin_obj) = package_json.get("bin").and_then(|v| v.as_object()) {
        if bin_obj.contains_key(package_name) {
            package_name.to_string()
        } else if bin_obj.contains_key(&default_bin_name) {
            default_bin_name
        } else if let Some(first_key) = bin_obj.keys().next() {
            first_key.to_string()
        } else {
            return None;
        }
    } else {
        return None;
    };

    let bin_base = app_data_dir.join("node_modules").join(".bin");

    // Windows 上优先使用 .exe 文件（可直接执行），其次 .cmd（通过 cmd.exe 执行）
    // 无扩展名的 shell 脚本在 Windows 上无法直接执行
    // macOS/Linux 上优先使用无扩展名的 shell 脚本
    #[cfg(target_os = "windows")]
    let candidates = [
        bin_base.join(format!("{}.exe", &bin_name)), // Windows: 优先 .exe（可直接执行）
        bin_base.join(format!("{}.cmd", &bin_name)), // 其次 .cmd（通过 cmd.exe 执行）
        bin_base.join(&bin_name),                    // 无扩展名的 POSIX shell 脚本作为兜底
    ];

    #[cfg(not(target_os = "windows"))]
    let candidates = [
        bin_base.join(&bin_name),                    // Unix: 优先无扩展名的 shell 脚本
        bin_base.join(format!("{}.cmd", &bin_name)),
        bin_base.join(format!("{}.exe", &bin_name)),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// 解析 npm 包的 JS 入口文件路径（用于 Windows 上直接用 node 执行）
///
/// 返回 (node_exe_path, js_entry_path)
#[cfg(target_os = "windows")]
fn resolve_node_and_js_entry_for_mcp(
    app: &tauri::AppHandle,
    package_name: &str,
) -> Option<(String, String)> {
    let app_data_dir = app_data_dir_get(app.clone()).ok()?;
    let app_data_dir = std::path::PathBuf::from(app_data_dir);
    let package_dir = app_data_dir.join("node_modules").join(package_name);
    if !package_dir.exists() {
        return None;
    }

    let package_json_path = package_dir.join("package.json");
    let content = std::fs::read_to_string(&package_json_path).ok()?;
    let package_json: serde_json::Value = serde_json::from_str(&content).ok()?;

    // 获取 bin 字段中的 JS 入口路径
    let rel_entry = if let Some(bin_str) = package_json.get("bin").and_then(|v| v.as_str()) {
        bin_str.to_string()
    } else if let Some(bin_obj) = package_json.get("bin").and_then(|v| v.as_object()) {
        let default_bin_name = package_name.rsplit('/').next().unwrap_or(package_name);
        if let Some(entry) = bin_obj.get(package_name).and_then(|v| v.as_str()) {
            entry.to_string()
        } else if let Some(entry) = bin_obj.get(default_bin_name).and_then(|v| v.as_str()) {
            entry.to_string()
        } else if let Some(entry) = bin_obj.values().next().and_then(|v| v.as_str()) {
            entry.to_string()
        } else {
            return None;
        }
    } else {
        return None;
    };

    // 解析 JS 入口文件的绝对路径
    let js_entry = package_dir.join(&rel_entry);
    if !js_entry.exists() {
        warn!(
            "[McpProxy] JS 入口文件不存在: {} (package: {}, rel: {})",
            js_entry.display(),
            package_name,
            rel_entry
        );
        return None;
    }

    // 查找 node.exe 路径
    let node_exe = if let Some(runtime_path) = std::env::var("NUWAX_APP_RUNTIME_PATH")
        .ok()
        .map(std::path::PathBuf::from)
    {
        let node_bin = runtime_path.join("node").join("bin").join("node.exe");
        if node_bin.exists() {
            node_bin.to_string_lossy().to_string()
        } else {
            // 尝试直接在 runtime_path 下查找
            let node_bin = runtime_path.join("node.exe");
            if node_bin.exists() {
                node_bin.to_string_lossy().to_string()
            } else {
                "node".to_string()
            }
        }
    } else if let Ok(node_path) = std::env::var("NUWAX_NODE_EXE") {
        node_path
    } else {
        "node".to_string()
    };

    let js_entry_path = js_entry.to_string_lossy().to_string();
    info!(
        "[McpProxy] Windows MCP 配置解析: package={}, node={}, js_entry={}",
        package_name, node_exe, js_entry_path
    );

    Some((node_exe, js_entry_path))
}

async fn normalize_mcp_proxy_config_for_local_runtime(
    app: &tauri::AppHandle,
    raw_config_json: String,
) -> String {
    let mut root: serde_json::Value = match serde_json::from_str(&raw_config_json) {
        Ok(v) => v,
        Err(e) => {
            warn!("[McpProxy] 配置 JSON 解析失败，保持原配置: {}", e);
            return raw_config_json;
        }
    };

    let Some(mcp_servers) = root
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
    else {
        return raw_config_json;
    };

    let mut changed = false;
    for (server_name, server_value) in mcp_servers.iter_mut() {
        let Some(server_obj) = server_value.as_object_mut() else {
            continue;
        };
        let command = server_obj
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if !is_npx_command(command) {
            continue;
        }

        let args = server_obj
            .get("args")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let Some((package_spec, forward_args)) = parse_npx_package_and_forward_args(&args) else {
            warn!(
                "[McpProxy] 服务 {} 使用 npx，但无法提取 package 信息，保持原配置",
                server_name
            );
            continue;
        };
        let Some(package_name) = package_name_from_npx_spec(&package_spec) else {
            continue;
        };

        match dependency_local_check(app.clone(), package_name.clone()).await {
            Ok(result) if result.installed => {
                debug!(
                    "[McpProxy] 服务 {} 依赖已安装: {}",
                    server_name, package_name
                );
            }
            Ok(_) => {
                info!(
                    "[McpProxy] 服务 {} 依赖未安装，开始应用内安装: {}",
                    server_name, package_name
                );
                match dependency_local_install(app.clone(), package_name.clone()).await {
                    Ok(install_result) if install_result.success => {
                        info!(
                            "[McpProxy] 服务 {} 依赖安装成功: {}",
                            server_name, package_name
                        );
                    }
                    Ok(install_result) => {
                        warn!(
                            "[McpProxy] 服务 {} 依赖安装失败: package={} error={:?}",
                            server_name, package_name, install_result.error
                        );
                        continue;
                    }
                    Err(e) => {
                        warn!(
                            "[McpProxy] 服务 {} 依赖安装异常: package={} error={}",
                            server_name, package_name, e
                        );
                        continue;
                    }
                }
            }
            Err(e) => {
                warn!(
                    "[McpProxy] 服务 {} 依赖检测失败: package={} error={}",
                    server_name, package_name, e
                );
                continue;
            }
        }

        // Windows 上优先使用 node 直接执行 JS 入口文件，避免弹出 CMD 窗口
        #[cfg(target_os = "windows")]
        {
            if let Some((node_exe, js_entry)) = resolve_node_and_js_entry_for_mcp(app, &package_name) {
                info!(
                    "[McpProxy] 服务 {} 配置改写(Windows node 直连): npx {} -> node {}",
                    server_name, package_spec, js_entry
                );
                // 构建新的 args：JS 入口 + 原始 forward_args
                let mut new_args = vec![js_entry];
                new_args.extend(forward_args);
                server_obj.insert("command".to_string(), serde_json::Value::String(node_exe));
                server_obj.insert(
                    "args".to_string(),
                    serde_json::Value::Array(
                        new_args
                            .into_iter()
                            .map(serde_json::Value::String)
                            .collect(),
                    ),
                );
                changed = true;
                continue;
            }
            // 如果 node 直连解析失败，回退到 bin 路径
            warn!(
                "[McpProxy] 服务 {} node 直连解析失败，回退到 bin 路径",
                server_name
            );
        }

        let Some(local_bin) = resolve_local_bin_from_package_name(app, &package_name) else {
            warn!(
                "[McpProxy] 服务 {} 已安装 {}，但未找到应用内 bin，保持 npx 启动",
                server_name, package_name
            );
            continue;
        };

        info!(
            "[McpProxy] 服务 {} 配置改写: npx {} -> {}",
            server_name, package_spec, local_bin
        );
        server_obj.insert("command".to_string(), serde_json::Value::String(local_bin));
        server_obj.insert(
            "args".to_string(),
            serde_json::Value::Array(
                forward_args
                    .into_iter()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
        changed = true;
    }

    if changed {
        match serde_json::to_string(&root) {
            Ok(v) => v,
            Err(e) => {
                warn!("[McpProxy] 配置改写后序列化失败，保持原配置: {}", e);
                raw_config_json
            }
        }
    } else {
        raw_config_json
    }
}

/// 启动 MCP Proxy 服务
///
/// 参数:
/// - config_json: mcpServers JSON 配置 (必需，如 `{"mcpServers":{"name":{...}}}`)
/// - port: 监听端口 (可选，默认 DEFAULT_MCP_PROXY_PORT)
///
/// 如果未传 config_json，则从 store 读取 `setup.mcp_proxy_config`
#[tauri::command]
async fn mcp_proxy_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
    config_json: Option<String>,
    port: Option<u16>,
) -> Result<bool, String> {
    sync_local_bin_env(&app)?;
    info!("[McpProxy] 开始读取启动配置...");

    let port = port.unwrap_or_else(|| match read_store_port(&app, "setup.mcp_proxy_port") {
        Ok(Some(p)) => {
            info!("[McpProxy] 找到 mcp_proxy_port: {}", p);
            p
        }
        Ok(None) => {
            info!(
                "[McpProxy] 未找到 mcp_proxy_port，使用默认值: {}",
                DEFAULT_MCP_PROXY_PORT
            );
            DEFAULT_MCP_PROXY_PORT
        }
        Err(e) => {
            warn!(
                "[McpProxy] 读取 mcp_proxy_port 失败: {}，使用默认值 {}",
                e, DEFAULT_MCP_PROXY_PORT
            );
            DEFAULT_MCP_PROXY_PORT
        }
    });

    let config_json =
        config_json.unwrap_or_else(|| match read_store_string(&app, "setup.mcp_proxy_config") {
            Ok(Some(json)) => {
                info!("[McpProxy] 找到 mcp_proxy_config");
                json
            }
            Ok(None) => {
                info!("[McpProxy] 未找到 mcp_proxy_config，使用默认配置（chrome-devtools）");
                DEFAULT_MCP_PROXY_CONFIG.to_string()
            }
            Err(e) => {
                warn!(
                    "[McpProxy] 读取 mcp_proxy_config 失败: {}，使用默认配置（chrome-devtools）",
                    e
                );
                DEFAULT_MCP_PROXY_CONFIG.to_string()
            }
        });
    let config_json = normalize_mcp_proxy_config_for_local_runtime(&app, config_json).await;

    let bin_path = get_mcp_proxy_bin_path(&app).map_err(|e| {
        error!("[McpProxy] {}", e);
        e
    })?;
    let mcp_log_dir = nuwax_agent_core::Logger::get_log_dir()
        .to_string_lossy()
        .to_string();

    // 获取 Node.js bin 目录路径
    let node_bin_path = nuwax_agent_core::service::get_node_bin_path();

    let mcp_proxy_config = nuwax_agent_core::McpProxyConfig {
        bin_path,
        port,
        host: DEFAULT_MCP_PROXY_HOST.to_string(),
        config_json,
        node_bin_path,
        log_dir: Some(mcp_log_dir),
    };

    let manager = state.manager.lock().await;
    manager
        .mcp_proxy_start_with_config(mcp_proxy_config)
        .await?;
    Ok(true)
}

/// 停止 MCP Proxy 服务
#[tauri::command]
async fn mcp_proxy_stop(state: tauri::State<'_, ServiceManagerState>) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.mcp_proxy_stop().await?;
    Ok(true)
}

/// 重启 MCP Proxy 服务
#[tauri::command]
async fn mcp_proxy_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
    config_json: Option<String>,
    port: Option<u16>,
) -> Result<bool, String> {
    info!("[McpProxy] 正在重启服务...");

    {
        let manager = state.manager.lock().await;
        manager.mcp_proxy_stop().await?;
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    mcp_proxy_start(app, state, config_json, port).await
}

// ========== 服务管理命令 ==========

use nuwax_agent_core::service::{
    ServiceInfo, ServiceManager, DEFAULT_MCP_PROXY_HOST, DEFAULT_MCP_PROXY_PORT,
};

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
            manager: Mutex::new(ServiceManager::new(None, Some(lanproxy_config), None)),
            agent_runner: Mutex::new(None),
        }
    }
}

/// 启动 nuwax-file-server
#[tauri::command]
async fn file_server_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    sync_local_bin_env(&app)?;
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

/// 解析项目工作目录
///
/// 优先从 store 读取 `setup.workspace_dir`，否则使用应用数据目录下的 workspace
fn resolve_projects_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    match read_store_string(app, "setup.workspace_dir") {
        Ok(Some(dir)) => {
            info!("[Rcoder] 找到 workspace_dir: {}", dir);
            Ok(std::path::PathBuf::from(dir))
        }
        Ok(None) => {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
            let default_workspace = app_data_dir.join("workspace");
            info!(
                "[Rcoder] 未找到 workspace_dir，使用默认值: {}",
                default_workspace.display()
            );
            Ok(default_workspace)
        }
        Err(e) => {
            warn!("[Rcoder] 读取 workspace_dir 失败: {}，使用默认值", e);
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
            Ok(app_data_dir.join("workspace"))
        }
    }
}

/// 从 Tauri store 读取配置，构建 RcoderAgentRunnerConfig
fn build_rcoder_config(app: &tauri::AppHandle) -> Result<RcoderAgentRunnerConfig, String> {
    let port = read_store_port(app, "setup.agent_port")?
        .ok_or_else(|| "配置缺失: setup.agent_port (Agent 服务端口)".to_string())?;
    info!("[Rcoder] 找到 agent_port: {}", port);

    let projects_dir = resolve_projects_dir(app)?;
    let computer_workspace_dir = projects_dir.join("computer-project-workspace");

    // 确保 computer-project-workspace 目录存在
    if !computer_workspace_dir.exists() {
        std::fs::create_dir_all(&computer_workspace_dir)
            .map_err(|e| format!("创建 computer-project-workspace 目录失败: {}", e))?;
        info!("[Rcoder] 已创建目录: {}", computer_workspace_dir.display());
    }

    // 获取应用数据目录
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    // 仅在开发模式下启用 MCP 日志
    let mcp_proxy_log_dir = if cfg!(debug_assertions) {
        Some(app_data_dir.join("logs").join("mcp"))
    } else {
        None
    };

    let config = RcoderAgentRunnerConfig {
        projects_dir: computer_workspace_dir,
        app_data_dir: Some(app_data_dir),
        backend_port: port,
        mcp_proxy_log_dir,
        ..RcoderAgentRunnerConfig::default()
    };
    info!("[Rcoder] 创建 RcoderAgentRunner 配置: {:?}", config);
    Ok(config)
}

/// 启动 HTTP Server (rcoder)
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: HTTP Server 端口 (默认 60001)
/// - setup.workspace_dir: 工作区目录
#[tauri::command]
async fn rcoder_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    sync_local_bin_env(&app)?;
    let config = build_rcoder_config(&app)?;
    let port = config.backend_port;

    // 停止旧的 runner（如果存在），释放端口
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            info!("[Rcoder] 停止旧的 RcoderAgentRunner...");
            old_runner.shutdown().await;
            // 等待端口释放
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        }
    }

    // 创建 RcoderAgentRunner 实例并启动
    let mut runner = RcoderAgentRunner::new(config);
    runner
        .start()
        .await
        .map_err(|e| format!("启动 Agent Runner 失败: {}", e))?;
    let agent_runner = Arc::new(runner);

    // 存储新的 runner
    {
        let mut runner_guard = state.agent_runner.lock().await;
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
            old_runner.shutdown().await;
        }
    }
    let manager = state.manager.lock().await;
    manager.rcoder_stop().await?;
    Ok(true)
}

/// 重启 HTTP Server (rcoder)
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: HTTP Server 端口 (默认 60001)
#[tauri::command]
async fn rcoder_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let config = build_rcoder_config(&app)?;
    let manager = state.manager.lock().await;
    manager.rcoder_restart(config).await?;
    Ok(true)
}

/// 停止所有服务
#[tauri::command]
async fn services_stop_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    // 停止 RcoderAgentRunner（包括 Pingora 代理）
    {
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            old_runner.shutdown().await;
        }
    }
    let manager = state.manager.lock().await;
    manager.services_stop_all().await?;

    // 发射服务状态变化事件，通知前端
    let statuses = manager.services_status_all().await;
    let statuses_dto: Vec<ServiceInfoDto> = statuses.into_iter().map(|s| s.into()).collect();
    let _ = app.emit("service_status_change", statuses_dto);

    Ok(true)
}

/// 重启所有服务
///
/// 从 Tauri store 读取配置:
/// - setup.agent_port: Agent 服务端口 (默认 60001)
/// - setup.file_server_port: 文件服务端口 (默认 60000)
/// - lanproxy.server_host: lanproxy 服务器地址 (从 API 返回)
/// - lanproxy.server_port: lanproxy 服务器端口 (从 API 返回)
/// - auth.saved_key: 客户端密钥
#[tauri::command]
async fn services_restart_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
    mcp_proxy_config: Option<String>,
) -> Result<bool, String> {
    info!("[Services] ========== 开始重启所有服务 ==========");
    sync_local_bin_env(&app)?;

    // Windows: 设置 Git Bash 路径环境变量（供 Docker 容器内的 rcoder 使用）
    #[cfg(windows)]
    {
        if std::env::var("CLAUDE_CODE_GIT_BASH_PATH").is_err() {
            if let Some(git_bash_path) = find_git_bash_path_windows() {
                std::env::set_var("CLAUDE_CODE_GIT_BASH_PATH", &git_bash_path);
                info!("[Services] 已设置 CLAUDE_CODE_GIT_BASH_PATH: {}", git_bash_path);
            }
        }
    }

    // 停止所有服务
    info!("[Services] 1/5 停止所有服务...");
    {
        // 停止 RcoderAgentRunner（包括 Pingora 代理）
        let mut runner_guard = state.agent_runner.lock().await;
        if let Some(old_runner) = runner_guard.take() {
            info!("[Services] 停止旧的 RcoderAgentRunner...");
            old_runner.shutdown().await;
        }
    }
    {
        let manager = state.manager.lock().await;
        manager.services_stop_all().await?;
    }
    info!("[Services] 所有服务已停止");

    // 重新启动所有服务（依次调用各个启动命令）
    // rcoder
    info!("[Services] 2/5 启动 Agent 服务 (rcoder)...");
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

        // 获取应用数据目录
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

        // 仅在开发模式下启用 MCP 日志
        let mcp_proxy_log_dir = if cfg!(debug_assertions) {
            Some(app_data_dir.join("logs").join("mcp"))
        } else {
            None
        };

        // 创建 RcoderAgentRunner 配置
        let config = RcoderAgentRunnerConfig {
            projects_dir: projects_dir.join("computer-project-workspace"),
            app_data_dir: Some(app_data_dir),
            backend_port: port,
            mcp_proxy_log_dir,
            ..RcoderAgentRunnerConfig::default()
        };
        info!("[Services]   - 创建 RcoderAgentRunner 配置: {:?}", config);

        // 创建 RcoderAgentRunner 实例并启动
        let mut runner = RcoderAgentRunner::new(config);
        runner
            .start()
            .await
            .map_err(|e| format!("启动 Agent Runner 失败: {}", e))?;
        let agent_runner = Arc::new(runner);

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
    info!("[Services] 3/5 启动文件服务 (nuwax-file-server)...");
    {
        // 获取 file_server 可执行文件路径
        let bin_path = match get_file_server_bin_path(&app) {
            Ok(path) => {
                debug!("[Services]   - file_server 可执行文件路径: {}", path);
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

        // 使用完整配置启动，基于用户工作区目录设置各路径
        // workspace_dir 替换容器中的 /app 前缀
        let _file_server_config = nuwax_agent_core::NuwaxFileServerConfig {
            bin_path: bin_path.clone(),
            port,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_init")
                .to_string_lossy()
                .to_string(),
            upload_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_zips")
                .to_string_lossy()
                .to_string(),
            project_source_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_workspace")
                .to_string_lossy()
                .to_string(),
            dist_target_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_nginx")
                .to_string_lossy()
                .to_string(),
            log_base_dir: app_data_dir
                .join("logs")
                .join("project_logs")
                .to_string_lossy()
                .to_string(),
            computer_workspace_dir: std::path::PathBuf::from(&workspace_dir)
                .join("computer-project-workspace")
                .to_string_lossy()
                .to_string(),
            computer_log_dir: app_data_dir
                .join("logs")
                .join("computer_logs")
                .to_string_lossy()
                .to_string(),
            capture_output_to_log: true,
        };

        // 确保 computer-project-workspace 目录存在
        let computer_workspace_path =
            std::path::PathBuf::from(&workspace_dir).join("computer-project-workspace");
        if !computer_workspace_path.exists() {
            std::fs::create_dir_all(&computer_workspace_path)
                .map_err(|e| format!("创建 computer-project-workspace 目录失败: {}", e))?;
            info!("[Services]   - 已创建 computer-project-workspace 目录");
        }

        let file_server_config = nuwax_agent_core::NuwaxFileServerConfig {
            bin_path,
            port,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_init")
                .to_string_lossy()
                .to_string(),
            upload_project_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_zips")
                .to_string_lossy()
                .to_string(),
            project_source_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_workspace")
                .to_string_lossy()
                .to_string(),
            dist_target_dir: std::path::PathBuf::from(&workspace_dir)
                .join("project_nginx")
                .to_string_lossy()
                .to_string(),
            log_base_dir: app_data_dir
                .join("logs")
                .join("project_logs")
                .to_string_lossy()
                .to_string(),
            computer_workspace_dir: computer_workspace_path.to_string_lossy().to_string(),
            computer_log_dir: app_data_dir
                .join("logs")
                .join("computer_logs")
                .to_string_lossy()
                .to_string(),
            // 是否将 file-server 的 stdout/stderr 捕获到 agent 日志（便于排查崩溃）；对应 subapp-deployer 的 LOG_CONSOLE_ENABLED
            capture_output_to_log: read_store_bool(&app, "setup.file_server_capture_output")
                .ok()
                .flatten()
                .unwrap_or(true),
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
        info!(
            "[Services]     capture_output_to_log: {}",
            file_server_config.capture_output_to_log
        );

        let manager = state.manager.lock().await;
        manager
            .file_server_start_with_config(file_server_config)
            .await?;
        info!("[Services]   - 文件服务启动命令已发送");
    }

    // lanproxy - 需要读取配置并调用 lanproxy_start_with_config
    info!("[Services] 4/5 启动代理服务 (nuwax-lanproxy)...");
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
                debug!("[Services]   - lanproxy 可执行文件路径: {}", path);
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

    // mcp-proxy
    info!("[Services] 5/5 启动 MCP Proxy 服务...");
    {
        let port = match read_store_port(&app, "setup.mcp_proxy_port") {
            Ok(Some(p)) => {
                info!("[Services]   - 找到 mcp_proxy_port: {}", p);
                p
            }
            Ok(None) => {
                info!(
                    "[Services]   - 未找到 mcp_proxy_port，使用默认值: {}",
                    DEFAULT_MCP_PROXY_PORT
                );
                DEFAULT_MCP_PROXY_PORT
            }
            Err(e) => {
                warn!(
                    "[Services]   - 读取 mcp_proxy_port 失败: {}，使用默认值 {}",
                    e, DEFAULT_MCP_PROXY_PORT
                );
                DEFAULT_MCP_PROXY_PORT
            }
        };

        // 使用传入的配置参数（前端已保证传递有效配置）
        // 仅托盘菜单重启时可能传入 None，此时从 Store 读取
        let config_json = if let Some(config) = mcp_proxy_config {
            info!("[Services]   - 使用传入的 MCP Proxy 配置");
            config
        } else {
            // 托盘菜单重启场景：从 Store 读取
            match read_store_string(&app, "setup.mcp_proxy_config") {
                Ok(Some(json)) => {
                    info!("[Services]   - 从 Store 读取 MCP Proxy 配置");
                    json
                }
                Ok(None) => {
                    info!("[Services]   - Store 中无 MCP Proxy 配置，使用默认配置");
                    DEFAULT_MCP_PROXY_CONFIG.to_string()
                }
                Err(e) => {
                    warn!("[Services]   - 读取 MCP Proxy 配置失败: {}，使用默认配置", e);
                    DEFAULT_MCP_PROXY_CONFIG.to_string()
                }
            }
        };
        let config_json = normalize_mcp_proxy_config_for_local_runtime(&app, config_json).await;

        let bin_path = match get_mcp_proxy_bin_path(&app) {
            Ok(p) => {
                debug!("[Services]   - mcp-proxy 可执行文件: {}", p);
                p
            }
            Err(e) => {
                let err = format!("获取 mcp-proxy 路径失败: {}", e);
                error!("[Services]   - {}", err);
                return Err(err);
            }
        };
        let mcp_log_dir = nuwax_agent_core::Logger::get_log_dir()
            .to_string_lossy()
            .to_string();

        // 获取 Node.js bin 目录路径
        let node_bin_path = nuwax_agent_core::service::get_node_bin_path();

        let mcp_proxy_config = nuwax_agent_core::McpProxyConfig {
            bin_path,
            port,
            host: DEFAULT_MCP_PROXY_HOST.to_string(),
            config_json,
            node_bin_path,
            log_dir: Some(mcp_log_dir),
        };

        let manager = state.manager.lock().await;
        manager
            .mcp_proxy_start_with_config(mcp_proxy_config)
            .await?;
        info!("[Services]   - MCP Proxy 启动命令已发送");
    }

    info!("[Services] ========== 所有服务重启命令已发送 ==========");

    // 发射服务状态变化事件，通知前端
    let statuses = state.manager.lock().await.services_status_all().await;
    let statuses_dto: Vec<ServiceInfoDto> = statuses.into_iter().map(|s| s.into()).collect();
    let _ = app.emit("service_status_change", statuses_dto);

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

/// 服务健康检查结果 DTO
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealthDto {
    pub service_type: String,
    pub state: String,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub port_reachable: bool,
}

/// 获取所有服务的健康状态（包含端口可达性检测）
#[tauri::command]
async fn service_health(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<Vec<ServiceHealthDto>, String> {
    let manager = state.manager.lock().await;
    let statuses = manager.services_status_all().await;

    let mut results = Vec::new();
    for info in statuses {
        // 根据服务类型确定对应端口
        let port = match format!("{:?}", info.service_type).as_str() {
            "FileServer" => read_store_port(&app, "setup.file_server_port")
                .ok()
                .flatten(),
            "McpProxy" => read_store_port(&app, "setup.mcp_proxy_port").ok().flatten(),
            "HttpServer" => read_store_port(&app, "setup.agent_port").ok().flatten(),
            _ => None,
        };

        let port_reachable = port
            .map(|p| !nuwax_agent_core::platform::check_port_available(p))
            .unwrap_or(false);

        results.push(ServiceHealthDto {
            service_type: format!("{:?}", info.service_type),
            state: format!("{:?}", info.state),
            pid: info.pid,
            port,
            port_reachable,
        });
    }

    Ok(results)
}

// ========== 预检检查命令 ==========

/// 执行预检检查
#[tauri::command]
async fn preflight_check(
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
async fn preflight_fix(
    check_ids: Vec<String>,
) -> Result<Vec<nuwax_agent_core::preflight::FixResult>, String> {
    Ok(nuwax_agent_core::preflight::run_preflight_fix(&check_ids).await)
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
    /// 是否为应用集成（sidecar），集成包不走动态更新
    #[serde(default)]
    pub bundled: bool,
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

/// 获取应用缓存目录路径
#[tauri::command]
fn cache_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_cache_dir().map_err(|e| e.to_string())?;

    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| format!("创建缓存目录失败: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string())
}

/// 获取应用配置目录路径
#[tauri::command]
fn config_dir_get(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?;

    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    Ok(path.to_string_lossy().to_string())
}

/// 检查指定端口是否可用
#[tauri::command]
fn network_port_check(port: u16) -> bool {
    nuwax_agent_core::platform::check_port_available(port)
}

/// 获取防火墙操作引导文案
#[tauri::command]
fn firewall_guide_get() -> String {
    nuwax_agent_core::platform::firewall_guide().to_string()
}

/// 检测中国大陆网络连通性
/// 依次尝试多个国内可用端点，任一成功即返回 true
#[tauri::command]
async fn check_network_cn() -> bool {
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

/// 将历史上的 bin 名称映射为应用内 npm 包名
fn package_name_from_bin_name(bin_name: &str) -> String {
    match bin_name {
        // npm 包名是 mcp-stdio-proxy，但 bin 名是 mcp-proxy
        "mcp-proxy" => "mcp-stdio-proxy".to_string(),
        other => other.to_string(),
    }
}

/// 将应用内运行时目录同步到当前进程 PATH
///
/// 注意：此函数可能被多次调用，使用 NUWAX_ORIGINAL_PATH 保存原始 PATH，
/// 避免每次调用时 PATH 不断增长。
fn sync_local_bin_env(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    let sep = ";";
    #[cfg(not(windows))]
    let sep = ":";

    // 获取应用内 node_modules/.bin 目录
    let app_dir = app_data_dir_get(app.clone())?;
    let nm_bin = std::path::Path::new(&app_dir)
        .join("node_modules")
        .join(".bin");

    // 获取 sidecar 二进制文件所在目录（跨平台）：
    // - macOS: Contents/MacOS/
    // - Windows: 主程序所在目录
    // - Linux: 与 exe 同目录
    let sidecar_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    // 构建 NUWAX_APP_RUNTIME_PATH：
    // 1. node/bin (Node.js 运行时)
    // 2. uv/bin (uv 包管理器)
    // 3. sidecar 目录 (mcp-proxy, nuwax-lanproxy 等)
    // 4. node_modules/.bin (npm 安装的命令)
    let mut runtime_dirs = build_app_runtime_dirs(app)?;

    // 添加 sidecar 目录到 PATH
    if let Some(ref sidecar) = sidecar_dir {
        if sidecar.exists() {
            runtime_dirs = format!("{}{}{}", runtime_dirs, sep, sidecar.to_string_lossy());
        }
    }

    // 添加 node_modules/.bin
    if nm_bin.exists() {
        runtime_dirs = format!("{}{}{}", runtime_dirs, sep, nm_bin.to_string_lossy());
    }

    debug!("[EnvSync] NUWAX_APP_RUNTIME_PATH: {}", runtime_dirs);
    std::env::set_var("NUWAX_APP_RUNTIME_PATH", &runtime_dirs);

    // 镜像源环境变量（npm_config_registry / UV_INDEX_URL 等）
    nuwax_agent_core::utils::setup_mirror_env();

    // 使用保存的原始 PATH，避免多次调用时 PATH 不断增长
    let original_path = if let Ok(saved) = std::env::var("NUWAX_ORIGINAL_PATH") {
        saved
    } else {
        // 首次调用，保存原始 PATH
        let current = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("NUWAX_ORIGINAL_PATH", &current);
        debug!("[EnvSync] 保存原始 PATH: {}", current);
        current
    };

    // Tauri 进程自身 PATH = NUWAX_APP_RUNTIME_PATH + 原始系统 PATH
    let full_path = format!("{}{}{}", runtime_dirs, sep, original_path);
    debug!("[EnvSync] Tauri 进程 PATH: {}", full_path);
    std::env::set_var("PATH", &full_path);

    // sidecar node（若存在）优先注入到全局环境，供 core 层 Windows 启动解析优先使用。
    match get_node_runtime_sidecar_bin_path(app) {
        Ok(node_exe) => {
            std::env::set_var("NUWAX_NODE_EXE", &node_exe);
            debug!("[EnvSync] 已设置 NUWAX_NODE_EXE={}", node_exe);
        }
        Err(e) => {
            debug!("[EnvSync] 未找到 node-runtime sidecar，继续使用 runtime node/PATH: {}", e);
        }
    }

    debug!("[EnvSync] 已同步 PATH 到应用内运行时目录");
    Ok(())
}

/// 初始化本地 npm 环境（创建 package.json，并确保 ~/.local/bin/env 存在便于终端生效）
#[tauri::command]
async fn dependency_local_env_init(app: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = app_data_dir_get(app.clone())?;
    let package_json_path = std::path::Path::new(&app_dir).join("package.json");

    // 创建 package.json（若不存在）
    if !package_json_path.exists() {
        let content = r#"{
  "name": "nuwax-agent-deps",
  "version": "1.0.0",
  "private": true,
  "description": "Nuwax Agent 本地依赖"
}"#;
        std::fs::write(&package_json_path, content)
            .map_err(|e| format!("创建 package.json 失败: {}", e))?;
    }

    // 同步当前进程 PATH 到应用内运行时目录
    sync_local_bin_env(&app)?;

    Ok(true)
}

/// 检测 Node.js 版本（仅检测应用内运行时路径）
#[tauri::command]
async fn dependency_node_detect(app: tauri::AppHandle) -> Result<NodeVersionResult, String> {
    let node_root = app_runtime_node_root_dir(&app)?;
    #[cfg(unix)]
    let local_node_bin = node_root.join("bin").join("node");
    #[cfg(windows)]
    let local_node_bin = node_root.join("bin").join("node.exe");

    if local_node_bin.exists() {
        let output = Command::new(&local_node_bin).no_window().arg("--version").output();
        if let Ok(out) = output {
            if out.status.success() {
                let version_str = String::from_utf8_lossy(&out.stdout)
                    .trim()
                    .trim_start_matches('v')
                    .to_string();
                let meets = check_version_meets_requirement(&version_str, "22.0.0");
                info!(
                    "[NodeDetect] app runtime node: v{} (满足要求: {})",
                    version_str, meets
                );
                return Ok(NodeVersionResult {
                    installed: true,
                    version: Some(version_str),
                    meets_requirement: meets,
                });
            }
        }
    }

    Ok(NodeVersionResult {
        installed: false,
        version: None,
        meets_requirement: false,
    })
}

/// Node.js 自动安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// 自动安装 Node.js（从打包资源复制到应用数据目录）
#[tauri::command]
async fn node_install_auto(app: tauri::AppHandle) -> Result<NodeInstallResult, String> {
    use tauri::Manager;

    info!("[NodeInstall] 开始自动安装 Node.js...");

    // 1. 解析打包资源目录中的 node 路径
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("获取资源目录失败: {}", e))?;

    // 资源目录结构: $RESOURCE/resources/node/{bin,lib}
    let bundled_node_dir = resource_dir.join("resources").join("node");

    // 开发模式下的回退路径
    let bundled_node_dir = if !bundled_node_dir.exists() {
        // 开发模式: 直接使用 src-tauri/resources/node
        let dev_path = std::env::current_dir()
            .unwrap_or_default()
            .join("resources")
            .join("node");
        if dev_path.exists() {
            debug!("[NodeInstall] 使用开发模式资源路径: {:?}", dev_path);
            dev_path
        } else {
            // 再尝试从 cargo manifest 目录
            let manifest_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("node");
            if manifest_path.exists() {
                info!(
                    "[NodeInstall] 使用 CARGO_MANIFEST_DIR 资源路径: {:?}",
                    manifest_path
                );
                manifest_path
            } else {
                return Ok(NodeInstallResult {
                    success: false,
                    version: None,
                    error: Some(format!(
                        "Node.js 资源文件未找到: {:?} / {:?} / {:?}",
                        bundled_node_dir, dev_path, manifest_path
                    )),
                });
            }
        }
    } else {
        debug!("[NodeInstall] 使用打包资源路径: {:?}", bundled_node_dir);
        bundled_node_dir
    };

    // 2. 使用 NodeInstaller 安装到应用内运行时目录
    let node_runtime_root = app_runtime_node_root_dir(&app)?;
    let installer = nuwax_agent_core::dependency::node::NodeInstaller::with_target_dir(
        node_runtime_root,
    );
    match installer.install_from_bundled(&bundled_node_dir) {
        Ok(info) => {
            info!(
                "[NodeInstall] 安装成功: v{} at {:?}",
                info.version, info.path
            );
            let _ = sync_local_bin_env(&app);
            Ok(NodeInstallResult {
                success: true,
                version: Some(info.version),
                error: None,
            })
        }
        Err(e) => {
            error!("[NodeInstall] 安装失败: {}", e);
            Ok(NodeInstallResult {
                success: false,
                version: None,
                error: Some(format!("安装失败: {}", e)),
            })
        }
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
async fn dependency_uv_detect(app: tauri::AppHandle) -> Result<UvVersionResult, String> {
    // 辅助闭包: 从 uv --version 输出中提取版本号
    fn parse_uv_version(stdout: &[u8]) -> Option<String> {
        let output_str = String::from_utf8_lossy(stdout).trim().to_string();
        output_str
            .split_whitespace()
            .nth(1)
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    }

    let local_uv_dir = app_runtime_bin_dir(&app)?;
    #[cfg(unix)]
    let local_uv_bin = local_uv_dir.join("uv");
    #[cfg(windows)]
    let local_uv_bin = local_uv_dir.join("uv.exe");

    if local_uv_bin.exists() {
        let output = Command::new(&local_uv_bin).no_window().arg("--version").output();
        if let Ok(out) = output {
            if out.status.success() {
                if let Some(version_str) = parse_uv_version(&out.stdout) {
                    let meets = check_version_meets_requirement(&version_str, "0.5.0");
                    info!("[UvDetect] 本地 uv: v{} (满足要求: {})", version_str, meets);
                    return Ok(UvVersionResult {
                        installed: true,
                        version: Some(version_str),
                        meets_requirement: meets,
                    });
                }
            }
        }
    }

    Ok(UvVersionResult {
        installed: false,
        version: None,
        meets_requirement: false,
    })
}

/// uv 自动安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UvInstallResult {
    pub success: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// 自动安装 uv（验证打包资源存在，直接使用 .app 包内资源）
///
/// 新架构：不再复制到 runtime/ 目录，直接使用 .app 包内的 uv
/// 优势：保持 macOS 代码签名
#[tauri::command]
async fn uv_install_auto(app: tauri::AppHandle) -> Result<UvInstallResult, String> {
    info!("[UvInstall] 验证打包的 uv 资源...");

    // 获取打包资源目录中的 uv bin 目录
    let uv_bin_dir = app_runtime_bin_dir(&app)?;

    // 验证 uv 二进制存在
    #[cfg(unix)]
    let uv_bin = uv_bin_dir.join("uv");
    #[cfg(windows)]
    let uv_bin = uv_bin_dir.join("uv.exe");

    if !uv_bin.exists() {
        error!(
            "[UvInstall] uv 资源不存在: {:?}",
            uv_bin
        );
        return Ok(UvInstallResult {
            success: false,
            version: None,
            error: Some(format!(
                "uv 资源不存在: {:?}",
                uv_bin
            )),
        });
    }

    // 获取版本信息
    let output = Command::new(&uv_bin)
        .no_window()
        .arg("--version")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            // 解析版本：uv 0.5.0 (xxx)
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let version = stdout
                .split_whitespace()
                .nth(1)
                .map(|s| s.to_string())
                .unwrap_or_else(|| stdout.clone());

            info!(
                "[UvInstall] uv 已就绪: v{} at {:?}",
                version, uv_bin
            );

            // 同步 PATH 环境变量
            let _ = sync_local_bin_env(&app);

            Ok(UvInstallResult {
                success: true,
                version: Some(version),
                error: None,
            })
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            error!("[UvInstall] 获取 uv 版本失败: {}", stderr);
            Ok(UvInstallResult {
                success: false,
                version: None,
                error: Some(format!("获取版本失败: {}", stderr)),
            })
        }
        Err(e) => {
            error!("[UvInstall] 执行 uv --version 失败: {}", e);
            Ok(UvInstallResult {
                success: false,
                version: None,
                error: Some(format!("执行失败: {}", e)),
            })
        }
    }
}


/// 检测本地 npm 包是否已安装
#[tauri::command]
async fn dependency_local_check(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<NpmPackageResult, String> {
    info!("[Dependency] 开始检测依赖: {}", package_name);
    if let Some(sidecar_bin) = sidecar_like_bin_for_package(&app, &package_name) {
        info!(
            "[Dependency] 检测命中 sidecar: package={} bin={}",
            package_name, sidecar_bin
        );
        let version = detect_bin_version(&sidecar_bin);
        return Ok(NpmPackageResult {
            installed: true,
            version,
            bin_path: Some(sidecar_bin),
            bundled: true,
        });
    }

    let app_dir = app_data_dir_get(app)?;
    let node_modules = std::path::Path::new(&app_dir).join("node_modules");
    let package_dir = node_modules.join(&package_name);

    // 检查包目录是否存在
    if !package_dir.exists() {
        info!(
            "[Dependency] 未安装(应用内): package={} dir={}",
            package_name,
            package_dir.display()
        );
        return Ok(NpmPackageResult {
            installed: false,
            version: None,
            bin_path: None,
            bundled: false,
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
        bundled: false,
    })
}

/// 安装 npm 包到本地目录（使用 npmmirror）
#[tauri::command]
async fn dependency_local_install(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<InstallResult, String> {
    info!("[Dependency] 开始安装依赖: {}", package_name);
    if let Some(sidecar_bin) = sidecar_like_bin_for_package(&app, &package_name) {
        info!(
            "[Dependency] 跳过安装(命中 sidecar): package={} bin={}",
            package_name, sidecar_bin
        );
        return Ok(InstallResult {
            success: true,
            version: detect_bin_version(&sidecar_bin),
            bin_path: Some(sidecar_bin),
            error: None,
        });
    }

    let app_dir = app_data_dir_get(app.clone())?;
    let registry = resolve_npm_registry(Some(&app));
    info!(
        "[Dependency] 安装目标: package={} app_dir={} registry={}",
        package_name, app_dir, registry
    );

    // 确保 npm 环境已初始化
    dependency_local_env_init(app.clone()).await?;

    // 先确保 tarball 已下载到本地，再优先走本地 tarball 安装
    let local_tarball = match find_cached_npm_tarball(&app, &package_name)? {
        Some(path) => {
            info!("[Dependency] 命中本地 npm 缓存: {}", path.display());
            path
        }
        None => {
            info!("[Dependency] 未命中本地缓存，开始预下载: {}", package_name);
            npm_prefetch_tarball(&app, &package_name, &registry).await?
        }
    };

    // 执行 npm install（优先本地 tarball）
    let npm_bin = app_runtime_node_bin_path(&app, "npm")?;
    let node_path = build_app_runtime_path_env(&app)?;
    let output = run_npm_command_with_timeout(
        &app,
        &npm_bin,
        &node_path,
        vec![
            "install".to_string(),
            local_tarball.to_string_lossy().to_string(),
            "--prefix".to_string(),
            app_dir.clone(),
            "--registry".to_string(),
            registry.clone(),
        ],
        120,
        "npm install(local tarball)",
    )
    .await?;
    info!(
        "[Dependency] npm install(本地tarball) 结束: package={} success={}",
        package_name,
        output.status.success()
    );

    let output = if output.status.success() {
        output
    } else {
        // 本地 tarball 失败时回退线上安装，避免缓存损坏导致不可用。
        warn!(
            "[Dependency] 本地 tarball 安装失败，回退线上安装: package={}, tarball={}",
            package_name,
            local_tarball.display()
        );
        run_npm_command_with_timeout(
            &app,
            &npm_bin,
            &node_path,
            vec![
                "install".to_string(),
                package_name.clone(),
                "--prefix".to_string(),
                app_dir.clone(),
                "--registry".to_string(),
                registry.clone(),
            ],
            120,
            "npm install(remote fallback)",
        )
        .await
        .map_err(|e| format!("回退执行 npm install 失败: {}", e))?
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        error!(
            "[Dependency] npm install 失败: package={} stderr={}",
            package_name,
            stderr
        );
    }

    if output.status.success() {
        // 获取安装的版本
        let result = dependency_local_check(app, package_name.clone()).await?;
        info!(
            "[Dependency] 安装成功: package={} version={:?} bin={:?}",
            package_name, result.version, result.bin_path
        );

        Ok(InstallResult {
            success: true,
            version: result.version,
            bin_path: result.bin_path,
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        error!(
            "[Dependency] 安装失败: package={} stderr={}",
            package_name,
            stderr
        );
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
async fn dependency_local_check_latest(
    app: tauri::AppHandle,
    package_name: String,
) -> Result<Option<String>, String> {
    let registry = resolve_npm_registry(Some(&app));
    let npm_bin = app_runtime_node_bin_path(&app, "npm")?;
    let node_path = build_app_runtime_path_env(&app)?;
    let output = Command::new(&npm_bin)
        .no_window()
        .env("PATH", &node_path)
        .args(["view", &package_name, "version", "--registry", &registry])
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
    app: tauri::AppHandle,
    bin_name: String,
) -> Result<ShellInstallerResult, String> {
    let package_name = package_name_from_bin_name(&bin_name);
    info!(
        "[Dependency] shell-check 代理到应用内检测: bin={} package={}",
        bin_name, package_name
    );
    let local = dependency_local_check(app, package_name).await?;
    Ok(ShellInstallerResult {
        installed: local.installed,
        version: local.version,
        bin_path: local.bin_path,
    })
}

/// 使用 Shell 脚本安装包
/// macOS/Linux: curl ... | sh
/// Windows: powershell irm ... | iex
#[tauri::command]
async fn dependency_shell_installer_install(
    app: tauri::AppHandle,
    installer_url: String,
    bin_name: String,
) -> Result<InstallResult, String> {
    let _ = installer_url;
    let package_name = package_name_from_bin_name(&bin_name);
    info!(
        "[Dependency] shell-install 代理到应用内安装: bin={} package={}",
        bin_name, package_name
    );
    dependency_local_install(app, package_name).await
}

// ========== 全局 npm 包管理命令 ==========

/// 检测 npm 包是否已安装（兼容旧接口名）
/// 实际仅检测应用内安装目录，不触达用户全局环境。
#[tauri::command]
async fn dependency_npm_global_check(
    app: tauri::AppHandle,
    bin_name: String,
) -> Result<NpmPackageResult, String> {
    let package_name = package_name_from_bin_name(&bin_name);
    info!(
        "[Dependency] global-check 代理到应用内检测: bin={} package={}",
        bin_name, package_name
    );
    dependency_local_check(app, package_name).await
}

/// 安装 npm 包（兼容旧接口名）
/// 实际仅安装到应用内目录，不触达用户全局环境。
#[tauri::command]
async fn dependency_npm_global_install(
    app: tauri::AppHandle,
    package_name: String,
    bin_name: String,
) -> Result<InstallResult, String> {
    info!(
        "[Dependency] global-install 代理到应用内安装: bin={} package={}",
        bin_name, package_name
    );
    let _ = bin_name;
    dependency_local_install(app, package_name).await
}

// ========== 开机自启动命令 ==========

use auto_launch::AutoLaunchBuilder;

/// 创建 AutoLaunch 实例
/// 根据当前运行的应用信息构建
fn create_auto_launch(app: &tauri::AppHandle) -> Result<auto_launch::AutoLaunch, String> {
    // 从 tauri.conf.json 的 productName 获取应用名称
    let app_name = app
        .config()
        .product_name
        .as_deref()
        .unwrap_or("Nuwax Agent");

    // 获取应用可执行文件路径
    // auto_launch 库在所有平台都需要可执行文件的绝对路径:
    // - macOS: LaunchAgent 的 ProgramArguments[0] 需要可执行文件路径
    // - Windows: 注册表值需要 .exe 文件路径
    // - Linux: .desktop 文件的 Exec 需要可执行文件路径
    let exe_path = std::env::current_exe().map_err(|e| format!("获取应用路径失败: {}", e))?;
    let app_path = exe_path.to_string_lossy().to_string();

    // 获取 bundle identifier（macOS LaunchAgent 需要）
    let _bundle_id = app.config().identifier.clone();

    // 构建 AutoLaunch
    let mut builder = AutoLaunchBuilder::new();
    builder
        .set_app_name(app_name)
        .set_app_path(&app_path)
        .set_args(&["--minimized"]); // 启动时最小化

    // macOS 特定设置
    #[cfg(target_os = "macos")]
    {
        builder.set_bundle_identifiers(&[&_bundle_id]);
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

/// 诊断开机自启动配置
/// 返回自启动的后端类型、配置路径和当前状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutolaunchDiagnoseResult {
    pub enabled: bool,
    pub backend: String,
    pub config_path: String,
    pub config_exists: bool,
}

#[tauri::command]
async fn autolaunch_diagnose(app: tauri::AppHandle) -> Result<AutolaunchDiagnoseResult, String> {
    let auto_launch = create_auto_launch(&app)?;
    let enabled = auto_launch
        .is_enabled()
        .map_err(|e| format!("获取状态失败: {}", e))?;

    #[cfg(target_os = "macos")]
    let (backend, config_path) = {
        let home = std::env::var("HOME").unwrap_or_default();
        let plist = std::path::PathBuf::from(&home)
            .join("Library/LaunchAgents/com.nuwax.agent-tauri-client.plist");
        (
            "LaunchAgent".to_string(),
            plist.to_string_lossy().to_string(),
        )
    };

    #[cfg(target_os = "windows")]
    let (backend, config_path) = {
        (
            "Registry (HKCU\\...\\Run)".to_string(),
            r"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run".to_string(),
        )
    };

    #[cfg(target_os = "linux")]
    let (backend, config_path) = {
        let config_dir = std::env::var("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config")
            });
        let path = config_dir.join("autostart/nuwax-agent.desktop");
        (
            "XDG Autostart".to_string(),
            path.to_string_lossy().to_string(),
        )
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let (backend, config_path) = ("Unknown".to_string(), "N/A".to_string());

    let config_exists = std::path::Path::new(&config_path).exists();

    Ok(AutolaunchDiagnoseResult {
        enabled,
        backend,
        config_path,
        config_exists,
    })
}

/// 获取 MCP Proxy 运行状态
#[tauri::command]
async fn mcp_proxy_status(
    state: tauri::State<'_, ServiceManagerState>,
    app: tauri::AppHandle,
) -> Result<ServiceHealthDto, String> {
    let manager = state.manager.lock().await;
    let statuses = manager.services_status_all().await;

    let mcp_info = statuses
        .iter()
        .find(|s| format!("{:?}", s.service_type) == "McpProxy");

    let port = read_store_port(&app, "setup.mcp_proxy_port")
        .ok()
        .flatten()
        .unwrap_or(nuwax_agent_core::DEFAULT_MCP_PROXY_PORT);

    let port_reachable = !nuwax_agent_core::platform::check_port_available(port);

    match mcp_info {
        Some(info) => Ok(ServiceHealthDto {
            service_type: "McpProxy".to_string(),
            state: format!("{:?}", info.state),
            pid: info.pid,
            port: Some(port),
            port_reachable,
        }),
        None => Ok(ServiceHealthDto {
            service_type: "McpProxy".to_string(),
            state: "Unknown".to_string(),
            pid: None,
            port: Some(port),
            port_reachable,
        }),
    }
}

/// 获取当前平台所需的权限列表及状态
#[tauri::command]
async fn permission_requirements(
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

// ========== 系统托盘支持 ==========

/// 查询系统托盘状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrayStatusResult {
    pub available: bool,
    pub reason: Option<String>,
}

#[tauri::command]
fn tray_status(app: tauri::AppHandle) -> TrayStatusResult {
    // 检查托盘图标是否存在
    let has_tray = app.tray_by_id("main").is_some() || app.default_window_icon().is_some();

    if has_tray {
        TrayStatusResult {
            available: true,
            reason: None,
        }
    } else {
        #[cfg(target_os = "linux")]
        let reason = "系统托盘可能不可用。请确保安装了 AppIndicator 扩展（GNOME 43+ 需要 gnome-shell-extension-appindicator）。".to_string();
        #[cfg(not(target_os = "linux"))]
        let reason = "系统托盘图标未创建".to_string();

        TrayStatusResult {
            available: false,
            reason: Some(reason),
        }
    }
}

/// 更新托盘菜单（自动获取自启动状态和服务状态）
async fn update_tray_menu(app_handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::MenuItemKind;

    // 获取自启动状态
    let autolaunch_enabled = create_auto_launch(app_handle)
        .and_then(|al| Ok(al.is_enabled().unwrap_or(false)))
        .unwrap_or(false);

    // 获取服务状态，用于决定是否禁用菜单项
    // 使用 try_lock 避免死锁，如果获取锁失败则默认禁用停止服务
    let state = app_handle.state::<ServiceManagerState>();
    // 尝试获取锁，如果已被持有则等待一段时间后超时
    let lock_result =
        tokio::time::timeout(std::time::Duration::from_millis(500), state.manager.lock()).await;

    let services_running = match lock_result {
        Ok(manager) => {
            let statuses = manager.services_status_all().await;
            statuses
                .iter()
                .any(|s| matches!(s.state, nuwax_agent_core::service::ServiceState::Running))
        }
        Err(_) => {
            warn!("[Tray] 获取服务状态超时，默认禁用停止服务");
            false
        }
    };

    // 重新创建菜单项
    let show_i = MenuItem::with_id(app_handle, tray_ids::SHOW, "显示主窗口", true, None::<&str>)?;
    let separator1 = tauri::menu::PredefinedMenuItem::separator(app_handle)?;
    let services_restart_i = MenuItem::with_id(
        app_handle,
        tray_ids::SERVICES_RESTART,
        "重启服务",
        true, // 始终启用重启服务
        None::<&str>,
    )?;
    let services_stop_i = MenuItem::with_id(
        app_handle,
        tray_ids::SERVICES_STOP,
        "停止服务",
        services_running, // 只有在服务运行时才启用停止
        None::<&str>,
    )?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app_handle)?;
    let autolaunch_i = CheckMenuItem::with_id(
        app_handle,
        tray_ids::AUTOLAUNCH,
        "开机自启动",
        true,
        autolaunch_enabled,
        None::<&str>,
    )?;
    let separator3 = tauri::menu::PredefinedMenuItem::separator(app_handle)?;
    let quit_i = MenuItem::with_id(app_handle, tray_ids::QUIT, "退出", true, None::<&str>)?;

    // 构建新菜单
    let new_menu = Menu::with_items(
        app_handle,
        &[
            &MenuItemKind::MenuItem(show_i),
            &MenuItemKind::Predefined(separator1),
            &MenuItemKind::MenuItem(services_restart_i),
            &MenuItemKind::MenuItem(services_stop_i),
            &MenuItemKind::Predefined(separator2),
            &MenuItemKind::Check(autolaunch_i),
            &MenuItemKind::Predefined(separator3),
            &MenuItemKind::MenuItem(quit_i),
        ],
    )?;

    // 更新托盘图标的菜单
    if let Some(tray) = app_handle.tray_by_id("main") {
        tray.set_menu(Some(new_menu))?;
    }

    Ok(())
}

/// 设置系统托盘
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::MenuItemKind;

    // 获取当前自启动状态
    let autolaunch_enabled = create_auto_launch(&app.handle())
        .and_then(|al| Ok(al.is_enabled().unwrap_or(false)))
        .unwrap_or(false);

    // 创建菜单项
    let show_i = MenuItem::with_id(app, tray_ids::SHOW, "显示主窗口", true, None::<&str>)?;
    let separator1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let services_restart_i = MenuItem::with_id(
        app,
        tray_ids::SERVICES_RESTART,
        "重启服务",
        true,
        None::<&str>,
    )?;
    let services_stop_i =
        MenuItem::with_id(app, tray_ids::SERVICES_STOP, "停止服务", true, None::<&str>)?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let autolaunch_i = CheckMenuItem::with_id(
        app,
        tray_ids::AUTOLAUNCH,
        "开机自启动",
        true,
        autolaunch_enabled,
        None::<&str>,
    )?;
    let separator3 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, tray_ids::QUIT, "退出", true, None::<&str>)?;

    // 构建菜单
    let menu = Menu::with_items(
        app,
        &[
            &MenuItemKind::MenuItem(show_i),
            &MenuItemKind::Predefined(separator1),
            &MenuItemKind::MenuItem(services_restart_i),
            &MenuItemKind::MenuItem(services_stop_i),
            &MenuItemKind::Predefined(separator2),
            &MenuItemKind::Check(autolaunch_i.clone()),
            &MenuItemKind::Predefined(separator3),
            &MenuItemKind::MenuItem(quit_i),
        ],
    )?;

    // 创建托盘图标
    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true) // 左键点击显示菜单
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                tray_ids::SHOW => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                tray_ids::SERVICES_RESTART => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        info!("[Tray] 重启所有服务...");
                        let state = app_handle.state::<ServiceManagerState>();
                        // 托盘菜单重启时，从 Store 读取配置
                        match services_restart_all(app_handle.clone(), state, None).await {
                            Ok(_) => {
                                info!("[Tray] 所有服务已重启");
                                // 更新托盘菜单（自动获取最新状态）
                                if let Err(e) = update_tray_menu(&app_handle).await {
                                    error!("[Tray] 更新托盘菜单失败: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("[Tray] 重启服务失败: {}", e);
                            }
                        }
                    });
                }
                tray_ids::SERVICES_STOP => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<ServiceManagerState>();
                        let manager = state.manager.lock().await;
                        if let Err(e) = manager.services_stop_all().await {
                            error!("[Tray] 停止服务失败: {}", e);
                        } else {
                            info!("[Tray] 所有服务已停止");
                            // 更新托盘菜单（自动获取最新状态）
                            if let Err(e) = update_tray_menu(&app_handle).await {
                                error!("[Tray] 更新托盘菜单失败: {}", e);
                            }
                        }
                    });
                }
                tray_ids::AUTOLAUNCH => {
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
                                    Ok(()) => {
                                        let new_state = !current;
                                        info!(
                                            "[Tray] 开机自启动已{}",
                                            if new_state { "启用" } else { "禁用" }
                                        );

                                        // 重新创建菜单以更新勾选状态（自动获取最新状态）
                                        if let Err(e) = update_tray_menu(&app_handle).await {
                                            error!("[Tray] 更新托盘菜单失败: {}", e);
                                        }
                                    }
                                    Err(e) => error!("[Tray] 切换开机自启动失败: {}", e),
                                }
                            }
                            Err(e) => error!("[Tray] 创建 AutoLaunch 失败: {}", e),
                        }
                    });
                }
                tray_ids::QUIT => {
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
async fn open_log_directory(_app: tauri::AppHandle) -> Result<bool, String> {
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
    let bin_name = package_name.split('/').next_back().unwrap_or(package_name);

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

fn is_node_modules_bin_path(path: &str) -> bool {
    path.contains("/node_modules/.bin/") || path.contains("\\node_modules\\.bin\\")
}

fn parse_cli_version(output: &str) -> Option<String> {
    let out = output.trim();
    if out.is_empty() {
        return None;
    }
    out.split_whitespace()
        .find(|s| {
            s.chars()
                .next()
                .map(|c| c.is_ascii_digit() || c == 'v')
                .unwrap_or(false)
        })
        .map(|s| s.trim_start_matches('v').to_string())
        .or_else(|| Some(out.to_string()))
}

fn detect_bin_version(bin_path: &str) -> Option<String> {
    for args in [["-V"], ["--version"]] {
        if let Ok(out) = Command::new(bin_path).no_window().args(args).output() {
            if out.status.success() {
                if let Some(v) = parse_cli_version(&String::from_utf8_lossy(&out.stdout)) {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn sidecar_like_bin_for_package(app: &tauri::AppHandle, package_name: &str) -> Option<String> {
    let bin_path = match package_name {
        "mcp-stdio-proxy" => get_mcp_proxy_bin_path(app).ok(),
        "nuwax-file-server" => get_file_server_bin_path(app).ok(),
        _ => None,
    }?;

    if is_node_modules_bin_path(&bin_path) {
        None
    } else {
        Some(bin_path)
    }
}

/// 检查版本是否满足最低要求
/// 例如: "22.21.1" >= "22.0.0" 应返回 true
fn check_version_meets_requirement(current: &str, required: &str) -> bool {
    let parse_version = |v: &str| -> (u32, u32, u32) {
        let parts: Vec<&str> = v.split('.').collect();
        let major = parts
            .first()
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

    // ✅ 修复 Linux GUI 应用的 PATH 环境变量问题（同 macOS）
    #[cfg(target_os = "linux")]
    {
        match fix_linux_path_env() {
            Ok(()) => {
                if let Ok(path) = std::env::var("PATH") {
                    println!(
                        "[PATH Fix] Linux PATH fixed successfully, entries={}",
                        path.split(':').count()
                    );
                }
            }
            Err(e) => {
                eprintln!("[PATH Fix] Failed to fix Linux PATH environment: {}", e);
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
    #[allow(dead_code)]
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
        .plugin(tauri_plugin_process::init())
        .manage(PermissionsState::default())
        .manage(MonitorState::default())
        .manage(ServiceManagerState::default())
        // 设置托盘 + 初始化 updater 插件
        .setup(|app| {
            // 注册 updater 插件（仅桌面端）
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

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
            #[allow(unexpected_cfgs)]
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
            #[allow(unexpected_cfgs)]
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
        // 注意：必须使用 block_on 同步等待服务停止，否则窗口隐藏后服务可能仍在运行
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                info!("[Window] 收到 CloseRequested 事件，停止所有服务并隐藏到托盘");
                // 阻止默认关闭行为，改为隐藏窗口
                api.prevent_close();

                // 同步等待服务停止，确保窗口隐藏前所有服务已停止
                let app_handle = window.app_handle().clone();
                let state = app_handle.state::<ServiceManagerState>();
                tauri::async_runtime::block_on(async {
                    let manager = state.manager.lock().await;
                    if let Err(e) = manager.services_stop_all().await {
                        error!("[Window] 停止服务失败: {}", e);
                    }
                    drop(manager);
                    let _ = window.hide();
                    info!("[Window] 窗口已隐藏到托盘");
                });
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
            mcp_proxy_start,
            mcp_proxy_stop,
            mcp_proxy_restart,
            services_stop_all,
            services_restart_all,
            services_status_all,
            service_health,
            // 预检检查命令
            preflight_check,
            preflight_fix,
            // npm 依赖管理命令
            dependency_npm_install,
            dependency_npm_query_version,
            dependency_npm_reinstall,
            // 初始化向导命令
            app_data_dir_get,
            cache_dir_get,
            config_dir_get,
            network_port_check,
            firewall_guide_get,
            check_network_cn,
            dependency_local_env_init,
            dependency_node_detect,
            node_install_auto,
            dependency_uv_detect,
            uv_install_auto,
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
            autolaunch_diagnose,
            // 诊断与状态命令
            mcp_proxy_status,
            permission_requirements,
            tray_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                // macOS Dock 图标点击事件：显示主窗口（Reopen 仅在 macOS 上存在，需 cfg 避免 Linux/Windows CI 编译报错）
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen {
                    has_visible_windows: _,
                    ..
                } => {
                    info!("[Dock] Dock 图标被点击，显示主窗口");
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                // 应用退出事件处理：在退出前清理所有服务
                tauri::RunEvent::Exit => {
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
                _ => {}
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
        .no_window()
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

/// Linux GUI 应用（从桌面启动器启动）不继承用户 shell 的 PATH
/// 这导致通过 nvm/pyenv 安装的命令找不到
/// 逻辑与 fix_macos_path_env 相同
#[cfg(target_os = "linux")]
fn fix_linux_path_env() -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Command;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

    let output = Command::new(&shell)
        .no_window()
        .args(["-l", "-c", "echo $PATH"])
        .output()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            let current_path = std::env::var("PATH").unwrap_or_default();

            let mut paths: std::collections::HashSet<String> = std::collections::HashSet::new();
            let mut ordered_paths: Vec<String> = Vec::new();

            for p in path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            for p in current_path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            let new_path = ordered_paths.join(":");
            std::env::set_var("PATH", &new_path);

            eprintln!("[PATH Fix] Successfully fixed Linux PATH environment");
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

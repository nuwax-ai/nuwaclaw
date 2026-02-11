// System-related commands for Tauri IPC
use std::cmp::Reverse;
use std::fs;
use std::time::SystemTime;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener;
use tokio::sync::oneshot;

/// 系统问候命令
///
/// 返回一个问候消息
#[tauri::command]
pub fn system_greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 打开目录选择对话框
///
/// 使用系统文件对话框让用户选择目录
/// 返回选中的目录路径，如果取消则返回 None
#[tauri::command]
pub async fn dialog_select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
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
pub fn log_dir_get() -> String {
    nuwax_agent_core::Logger::get_log_dir()
        .to_string_lossy()
        .to_string()
}

/// 打开日志目录
///
/// 使用系统默认文件管理器打开日志目录，方便用户查看和分析日志
#[tauri::command]
pub async fn open_log_directory(_app: tauri::AppHandle) -> Result<bool, String> {
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
pub async fn read_logs(count: Option<u32>) -> Result<Vec<String>, String> {
    let log_dir = nuwax_agent_core::Logger::get_log_dir();
    let count = count.unwrap_or(100) as usize;

    // 查找最新的日志文件（按修改时间排序）
    let mut log_files: Vec<_> = fs::read_dir(&log_dir)
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
        Reverse(
            e.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(SystemTime::UNIX_EPOCH),
        )
    });

    // 读取最新的日志文件
    let latest_log = &log_files[0].path();

    // 读取文件内容
    let content =
        fs::read_to_string(latest_log).map_err(|e| format!("Failed to read log file: {}", e))?;

    // 按行分割并反转，使最新日志在最前面
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    lines.reverse();

    // 只返回指定数量的日志
    if lines.len() > count {
        lines.truncate(count);
    }

    Ok(lines)
}

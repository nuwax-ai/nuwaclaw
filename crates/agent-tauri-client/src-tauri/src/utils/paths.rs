// 路径工具函数模块
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::store::read_store_string;

/// 去除 URL 中的协议前缀 (http:// 或 https://)
///
/// 将 "https://example.com" 或 "http://example.com" 转换为 "example.com"
///
/// # Arguments
/// * `server_host` - 服务器地址，可能包含协议前缀
///
/// # Returns
/// 去除协议前缀后的地址
pub fn strip_host_from_url(server_host: &str) -> String {
    let s = server_host.trim();
    if s.starts_with("https://") {
        s.strip_prefix("https://").unwrap_or(s).trim().to_string()
    } else if s.starts_with("http://") {
        s.strip_prefix("http://").unwrap_or(s).trim().to_string()
    } else {
        s.to_string()
    }
}

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
pub fn get_file_server_bin_path(app: &AppHandle) -> Result<String, String> {
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
pub fn get_lanproxy_bin_path(app: &AppHandle) -> Result<String, String> {
    // 根据平台和架构选择二进制文件名
    #[cfg(target_os = "macos")]
    let bin_name = "nuwax-lanproxy-aarch64-apple-darwin";

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

/// 解析项目工作目录
///
/// 优先从 store 读取 `setup.workspace_dir`，否则使用应用数据目录下的 workspace
///
/// # Arguments
/// * `app` - Tauri AppHandle，用于获取应用数据目录和 store 配置
///
/// # Returns
/// 项目工作目录路径
pub fn resolve_projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match read_store_string(app, "setup.workspace_dir") {
        Ok(Some(dir)) => {
            info!("[Rcoder] 找到 workspace_dir: {}", dir);
            Ok(PathBuf::from(dir))
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

/// 获取 npm package 的可执行文件路径
///
/// 从包名推断 bin 名称并返回 node_modules/.bin 下的路径
/// 例如: @anthropic-ai/claude-code-acp-ts -> claude-code-acp-ts
///
/// # Arguments
/// * `app_dir` - 应用数据目录路径
/// * `package_name` - npm 包名
///
/// # Returns
/// 可执行文件的完整路径，如果文件不存在则返回 None
pub fn get_package_bin_path(app_dir: &str, package_name: &str) -> Option<String> {
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

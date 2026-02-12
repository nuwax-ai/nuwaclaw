// 路径工具函数模块
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

use super::store::read_store_string;

// ========== 可执行文件路径解析（公共方法，供 file-server / mcp-proxy 等复用） ==========

/// 在候选路径中返回第一个存在的路径及其标签，用于统一「按顺序查找可执行文件」逻辑。
///
/// # 参数
/// - `candidates`: 按优先级排列的 `(路径, 标签)` 列表，标签用于日志
/// - `bin_name`: 可执行文件名，用于日志输出
///
/// # 返回
/// 若存在则返回 `Some((路径字符串, 标签))`，并打 info 日志；否则 `None`
fn first_existing_bin_path(
    candidates: &[(PathBuf, &'static str)],
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

/// 解析通过 npm 安装的可执行文件路径（本地 node_modules/.bin 或全局安装）。
///
/// 查找顺序（与「依赖均安装在全局」方案一致）：
/// 1. 应用数据目录：`<app_data_dir>/node_modules/.bin/{bin_name}`
/// 2. npm 全局 prefix：`npm config get prefix` → `<prefix>/bin/{bin_name}`（Unix）或 `<prefix>/{bin_name}.cmd`（Windows）
/// 3. 常见目录：`~/.local/bin/{bin_name}`、Windows `%APPDATA%\npm\{bin_name}.cmd`
/// 4. 系统 PATH：which crate 查找
///
/// # 参数
/// - `app`: Tauri AppHandle
/// - `bin_name`: 可执行文件名（如 `nuwax-file-server`、`mcp-proxy`）
/// - `missing_hint`: 未找到时错误信息中的提示（如「请在「依赖」页面安装 xxx」）
pub fn resolve_npm_global_bin_path(
    app: &AppHandle,
    bin_name: &str,
    missing_hint: &str,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;

    let local_bin = app_data_dir
        .join("node_modules")
        .join(".bin")
        .join(bin_name);

    let home_local_bin = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin");

    #[cfg(unix)]
    let common_global = home_local_bin.join(bin_name);
    #[cfg(windows)]
    let common_global = home_local_bin.join(format!("{}.cmd", bin_name));

    // 按优先级组装路径候选，复用公共查找逻辑
    let mut candidates: Vec<(PathBuf, &'static str)> = vec![
        (local_bin, "本地"),
        (common_global, "~/.local/bin"),
    ];

    // npm 全局 prefix 需执行命令得到路径，插入到本地之后
    if let Ok(output) = std::process::Command::new("npm")
        .args(["config", "get", "prefix"])
        .output()
    {
        if output.status.success() {
            let prefix: String = String::from_utf8_lossy(&output.stdout)
                .trim()
                .trim_matches(|c| c == '"' || c == '\'')
                .trim()
                .to_string();
            if !prefix.is_empty() {
                #[cfg(unix)]
                {
                    candidates.insert(1, (std::path::Path::new(&prefix).join("bin").join(bin_name), "npm 全局"));
                }
                #[cfg(windows)]
                {
                    let p = std::path::Path::new(&prefix);
                    let in_root = p.join(format!("{}.cmd", bin_name));
                    candidates.insert(
                        1,
                        if in_root.exists() {
                            (in_root, "npm 全局")
                        } else {
                            (p.join("bin").join(format!("{}.cmd", bin_name)), "npm 全局")
                        },
                    );
                }
            }
        }
    }

    #[cfg(windows)]
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push((
            std::path::Path::new(&appdata)
                .join("npm")
                .join(format!("{}.cmd", bin_name)),
            "%%APPDATA%%\\npm",
        ));
    }

    if let Some((path, _)) = first_existing_bin_path(&candidates, bin_name) {
        return Ok(path);
    }

    // 最后回退：仅使用 which crate 在 PATH 中查找（跨平台，不依赖系统 which/where）
    warn!("[BinPath] {} 未在常见路径找到，尝试 PATH", bin_name);

    if let Ok(path) = which::which(bin_name) {
        let path = path.to_string_lossy().to_string();
        if !path.is_empty() {
            info!("[BinPath] {} 找到(PATH): {}", bin_name, path);
            return Ok(path);
        }
    }

    Err(format!("未找到 {} 可执行文件，{}", bin_name, missing_hint))
}

/// 解析 node/npm/npx 等二进制的实际路径
/// 直接使用系统 PATH
fn resolve_node_bin(bin_name: &str) -> String {
    // 直接返回命令名，依赖系统 PATH
    info!("[resolve_node_bin] {} -> using PATH", bin_name);
    bin_name.to_string()
}

// ========== 专用路径解析函数（复用上面的公共方法） ==========

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
fn resolve_bundled_bin_path(app: &AppHandle, bin_name: &str) -> Result<String, String> {
    let mut candidates: Vec<(PathBuf, &'static str)> = vec![];

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push((resource_dir.join("binaries").join(bin_name), "resource/binaries"));
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
            std::path::Path::new(&manifest_dir).join("binaries").join(bin_name),
            "manifest",
        ));
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push((
            cwd.join("crates/agent-tauri-client/src-tauri/binaries").join(bin_name),
            "cwd",
        ));
    }

    if let Some((path, _)) = first_existing_bin_path(&candidates, bin_name) {
        return Ok(path);
    }

    Err(format!("未找到 {} 可执行文件", bin_name))
}

/// 获取 nuwax-file-server 可执行文件完整路径（复用 resolve_npm_global_bin_path）
pub fn get_file_server_bin_path(app: &AppHandle) -> Result<String, String> {
    resolve_npm_global_bin_path(app, "nuwax-file-server", "请在「依赖」页面安装 Nuwax File Server")
}

/// 获取 mcp-proxy 可执行文件完整路径（复用 resolve_npm_global_bin_path）
pub fn get_mcp_proxy_bin_path(app: &AppHandle) -> Result<String, String> {
    resolve_npm_global_bin_path(app, "mcp-proxy", "请在「依赖」页面安装 MCP Proxy")
}

/// 获取当前平台的 nuwax-lanproxy 可执行文件完整路径（复用 resolve_bundled_bin_path）
///
/// nuwax-lanproxy 通过 Tauri 的 externalBin（sidecar）随应用包集成，无需用户单独安装。
pub fn get_lanproxy_bin_path(app: &AppHandle) -> Result<String, String> {
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

// ========== 其他路径工具函数 ==========

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

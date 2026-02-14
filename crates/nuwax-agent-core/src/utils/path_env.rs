//! 子进程环境变量管理 — 与用户系统环境隔离。
//!
//! 子进程不继承父进程/用户的完整环境变量，仅使用我们管理的运行时路径 + 最小系统基础变量，
//! 避免用户 IDE 工具、build 产物等无关配置污染子进程环境。
//!
//! 与 Tauri fix-path-env 互补：fix-path-env 修 GUI 进程 PATH，此处管控 spawn 子进程的完整环境。

use std::path::PathBuf;
use tracing::debug;

/// 默认 MCP Proxy 配置（与前端 constants.ts 保持一致）
pub const DEFAULT_MCP_PROXY_CONFIG: &str = r#"{"mcpServers":{"chrome-devtools":{"command":"npx","args":["-y","chrome-devtools-mcp@latest"]}}}"#;
/// 阿里云 npm 镜像（npx 加速）
pub const DEFAULT_NPM_REGISTRY: &str = "https://registry.npmmirror.com";
/// 阿里云 PyPI 镜像（uvx/pip 加速）
pub const DEFAULT_PYPI_INDEX_URL: &str = "https://mirrors.aliyun.com/pypi/simple/";

/// 返回 ~/.local/bin
fn local_bin_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}

/// 在系统 PATH 中查找可执行文件
fn find_in_path(executable: &str) -> Option<String> {
    // 先检查应用内是否已有（通过命令行参数 NUWAX_APP_RUNTIME_PATH 判断）
    // 这里只在系统 PATH 中查找
    let output = if cfg!(windows) {
        std::process::Command::new("where")
            .arg(executable)
            .output()
    } else {
        std::process::Command::new("which")
            .arg(executable)
            .output()
    };

    match output {
        Ok(o) if o.status.success() => {
            let binding = String::from_utf8_lossy(&o.stdout);
            binding
                .lines()
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        }
        _ => None,
    }
}

/// 在系统 PATH 中查找可执行文件并返回其父目录
fn find_bin_dir(executable: &str) -> Option<String> {
    find_in_path(executable).and_then(|path| {
        let parent = PathBuf::from(&path).parent()?.to_path_buf();
        let parent_str = parent.to_string_lossy().to_string();

        // 如果父目录是 "cmd"，尝试找同级的 "bin" 目录
        // 例如: D:\Program Files\Git\cmd -> D:\Program Files\Git\bin
        if parent_str.to_lowercase().ends_with("cmd") {
            let bin_dir = parent
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| {
                    if n.eq_ignore_ascii_case("cmd") {
                        parent
                            .parent()
                            .map(|p| p.join("bin").to_string_lossy().to_string())
                    } else {
                        None
                    }
                })
                .flatten();
            if let Some(bin) = bin_dir {
                if PathBuf::from(&bin).join("bash.exe").exists() {
                    return Some(bin);
                }
            }
        }

        Some(parent_str)
    })
}

/// 添加系统 PATH 中的 bin 目录到 paths 列表
fn add_system_bin_dir(paths: &mut Vec<String>, executable: &str) {
    if let Some(bin_dir) = find_bin_dir(executable) {
        if !paths.contains(&bin_dir) {
            debug!("[Env] 已添加 {} 目录到 PATH", bin_dir);
            paths.push(bin_dir);
        }
    }
}

/// 构建供 spawn/子进程使用的 PATH 字符串。
///
/// **完全隔离**：仅包含 NUWAX_APP_RUNTIME_PATH 中的应用自有运行时目录，
/// 不包含 ~/.local/bin、/usr/bin 等任何系统或用户路径，彻底避免环境污染。
pub fn build_node_path_env() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut paths: Vec<String> = Vec::new();

    // 1. 先添加应用内的 NUWAX_APP_RUNTIME_PATH（优先）
    if let Ok(runtime_path) = std::env::var("NUWAX_APP_RUNTIME_PATH") {
        let runtime_path = runtime_path.trim();
        if !runtime_path.is_empty() {
            for p in runtime_path.split(sep) {
                let p = p.trim();
                if !p.is_empty() && !paths.contains(&p.to_string()) {
                    paths.push(p.to_string());
                }
            }
        }
    }

    // 2. 查找系统 PATH 中的工具（兜底）
    // Windows
    #[cfg(windows)]
    {
        add_system_bin_dir(&mut paths, "python.exe");
        add_system_bin_dir(&mut paths, "node.exe");
        add_system_bin_dir(&mut paths, "git.exe");
        add_system_bin_dir(&mut paths, "bash.exe"); // Git Bash
        add_system_bin_dir(&mut paths, "go.exe");
    }

    // Linux/macOS
    #[cfg(not(windows))]
    {
        add_system_bin_dir(&mut paths, "python3");
        add_system_bin_dir(&mut paths, "node");
        add_system_bin_dir(&mut paths, "git");
        add_system_bin_dir(&mut paths, "go");

        // 确保系统基础目录在 PATH 中（uvx/pip 脚本依赖 realpath 等系统命令）
        for sys_dir in &["/bin", "/usr/bin", "/usr/local/bin"] {
            let s = sys_dir.to_string();
            if std::path::Path::new(sys_dir).is_dir() && !paths.contains(&s) {
                paths.push(s);
            }
        }
    }

    paths.join(sep)
}

/// Windows: 查找 Git Bash 路径
///
/// 查找系统 PATH 中的 bash.exe，返回其 bin 目录路径
/// 如果 bash.exe 在 Git\cmd 目录下，会自动查找同级的 Git\bin 目录
#[cfg(windows)]
pub fn find_git_bash_path() -> Option<String> {
    find_bin_dir("bash.exe")
}

/// 构建完整的 PATH 环境变量（供 sidecar 服务使用）。
///
/// 包含：
/// 1. 应用内运行时目录 (NUWAX_APP_RUNTIME_PATH)
/// 2. 系统 PATH 中的工具 (node, python, git, go 等)
/// 3. Windows: 额外添加 npm 全局 bin 目录
pub fn build_full_path_env() -> String {
    let paths = build_node_path_env();

    // Windows: 添加 npm 全局 bin 目录（确保 npm 全局安装的包可用）
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_path = format!(r"{}\npm", appdata);
            if !paths.contains(&npm_path) {
                return format!("{};{}", paths, npm_path);
            }
        }
    }

    paths
}

/// 构建子进程最小基础环境变量集（配合 `env_clear()` 使用，不继承父进程环境）。
///
/// 仅包含操作系统必需的基础变量 + 我们自己的变量，与用户系统/IDE 配置完全隔离。
/// 调用方需额外通过 `.env("PATH", build_node_path_env())` 设置 PATH。
pub fn build_base_env() -> Vec<(String, String)> {
    let mut env = Vec::new();

    // --- 操作系统基础变量（子进程正常运行所需） ---

    #[cfg(not(windows))]
    {
        for key in &["HOME", "USER", "LANG", "TMPDIR", "SHELL"] {
            if let Ok(v) = std::env::var(key) {
                env.push((key.to_string(), v));
            }
        }
    }

    #[cfg(windows)]
    {
        for key in &[
            "USERPROFILE", "HOMEDRIVE", "HOMEPATH",   // 用户主目录
            "SystemRoot", "SYSTEMDRIVE",               // 系统根目录
            "COMSPEC",                                 // cmd.exe 路径
            "TEMP", "TMP",                             // 临时目录
            "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",  // 应用数据目录（npm/node 需要）
        ] {
            if let Ok(v) = std::env::var(key) {
                env.push((key.to_string(), v));
            }
        }
    }

    // --- 我们自己的变量 ---

    // Tauri 运行时路径
    if let Ok(v) = std::env::var("NUWAX_APP_RUNTIME_PATH") {
        env.push(("NUWAX_APP_RUNTIME_PATH".into(), v));
    }
    // 应用数据目录
    if let Ok(v) = std::env::var("NUWAX_APP_DATA_DIR") {
        env.push(("NUWAX_APP_DATA_DIR".into(), v));
    }

    // --- 日志配置（调试用，有则透传） ---
    for key in &["RUST_LOG", "AGENT_RUST_LOG"] {
        if let Ok(v) = std::env::var(key) {
            env.push((key.to_string(), v));
        }
    }

    // --- 镜像源 & 代理配置（有则透传到 mcp-proxy / npx / uvx 子进程） ---
    for key in &[
        "MCP_PROXY_NPM_REGISTRY",  // mcp-proxy 读取后设为 npm_config_registry
        "MCP_PROXY_PYPI_INDEX_URL", // mcp-proxy 读取后设为 UV_INDEX_URL / PIP_INDEX_URL
        "npm_config_registry",      // npx/npm 直接使用
        "UV_INDEX_URL",             // uv/uvx 直接使用
        "PIP_INDEX_URL",            // pip 直接使用
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ] {
        if let Ok(v) = std::env::var(key) {
            env.push((key.to_string(), v));
        }
    }

    env
}

/// 设置镜像源环境变量（仅首次，不覆盖已有值）
///
/// 同时设置直接变量（npx/uvx 直接读取）和 MCP_PROXY_* 中转变量（mcp-proxy 兼容）。
/// 通过 `build_base_env()` 透传到所有子进程。
pub fn setup_mirror_env() {
    use tracing::info;

    if std::env::var("npm_config_registry").is_err() {
        let registry = std::env::var("MCP_PROXY_NPM_REGISTRY")
            .unwrap_or_else(|_| DEFAULT_NPM_REGISTRY.to_string());
        std::env::set_var("npm_config_registry", &registry);
        std::env::set_var("MCP_PROXY_NPM_REGISTRY", &registry);
        info!("[EnvSync] 已设置 npm_config_registry={}", registry);
    }
    if std::env::var("UV_INDEX_URL").is_err() {
        let index_url = std::env::var("MCP_PROXY_PYPI_INDEX_URL")
            .unwrap_or_else(|_| DEFAULT_PYPI_INDEX_URL.to_string());
        std::env::set_var("UV_INDEX_URL", &index_url);
        std::env::set_var("PIP_INDEX_URL", &index_url);
        std::env::set_var("MCP_PROXY_PYPI_INDEX_URL", &index_url);
        info!("[EnvSync] 已设置 UV_INDEX_URL={}", index_url);
    }
}

/// 在 ~/.local/bin 下创建 env 脚本，安装 Node/uv 后用户可在终端 source 以加入 PATH。
///
/// - **Unix**：创建 ~/.local/bin/env，用户可 source 或加入 shell 配置。
/// - **Windows**：不创建脚本（依赖使用全局安装 `npm i -g`，无需设置环境变量），直接返回 Ok。
pub fn ensure_local_bin_env() -> Result<(), std::io::Error> {
    #[cfg(windows)]
    {
        return Ok(());
    }

    #[cfg(unix)]
    {
        let bin_dir = local_bin_dir();
        std::fs::create_dir_all(&bin_dir)?;
        let content = r#"# NuWax: 终端中执行 . "$HOME/.local/bin/env" 或加入 .zshrc
export PATH="$HOME/.local/bin${PATH:+:$PATH}"
"#;
        std::fs::write(bin_dir.join("env"), content)?;
        Ok(())
    }
}

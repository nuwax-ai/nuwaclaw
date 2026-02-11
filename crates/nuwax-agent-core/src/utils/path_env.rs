//! PATH 与 ~/.local/bin 环境脚本（与 Tauri fix-path-env 互补：fix-path-env 修 GUI 进程 PATH，此处写终端用 env 脚本并在 spawn 时兜底注入）。
//!
//! - **所有平台**：在 PATH 前追加 ~/.local/bin，便于使用本地安装的 node/uv 等。
//! - **Windows 特殊处理**：移除可能的 `\\?\` 扩展长度路径前缀，使用分号分隔 PATH。

use std::path::{Path, PathBuf};

/// 移除 Windows 扩展长度路径前缀 `\\?\`
///
/// Windows 上 Tauri 的 `resource_dir()` 等方法可能返回带 `\\?\` 前缀的路径。
/// 这个前缀允许超过 260 字符的路径，但某些外部工具（如 msiexec、npm 等）不支持。
///
/// # 参数
/// - `path`: 输入路径
///
/// # 返回
/// 移除 `\\?\` 前缀后的路径字符串
///
/// # 示例
/// ```ignore
/// use nuwax_agent_core::utils::clean_extended_path;
///
/// // Windows
/// assert_eq!(clean_extended_path(r"\\?\C:\Program Files\test"), r"C:\Program Files\test");
/// assert_eq!(clean_extended_path(r"C:\normal\path"), r"C:\normal\path");
///
/// // Unix
/// assert_eq!(clean_extended_path("/usr/local/bin"), "/usr/local/bin");
/// ```
pub fn clean_extended_path<P: AsRef<Path>>(path: P) -> String {
    #[cfg(windows)]
    {
        let path_str = path.as_ref().to_string_lossy();
        // 移除 Windows 扩展长度路径前缀 `\\?\`
        if path_str.starts_with(r"\\?\") {
            path_str[4..].to_string()
        } else {
            path_str.to_string()
        }
    }
    #[cfg(not(windows))]
    {
        path.as_ref().to_string_lossy().to_string()
    }
}

/// 返回 ~/.local/bin（所有平台都使用此目录）。
fn local_bin_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}

/// 构建供 spawn/子进程使用的 PATH 字符串。
///
/// - **Unix**：在现有 PATH 前追加 ~/.local/bin（安装 node/uv 到本地后即生效）。
/// - **Windows**：在现有 PATH 前追加 ~/.local/bin，并移除可能的扩展长度路径前缀。
pub fn build_node_path_env() -> String {
    let bin = local_bin_dir();
    let bin_str = clean_extended_path(&bin);
    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(windows)]
    {
        // Windows 使用分号分隔 PATH
        if current.is_empty() {
            bin_str
        } else {
            format!("{};{}", bin_str, current)
        }
    }

    #[cfg(not(windows))]
    {
        // Unix 使用冒号分隔 PATH
        if current.is_empty() {
            bin_str
        } else {
            format!("{}:{}", bin_str, current)
        }
    }
}

/// 安全地设置 PATH 环境变量（封装 unsafe 调用）
///
/// 此函数确保传入的值不包含空字节，避免了 Rust 2024 edition 中 set_var 的 undefined behavior
pub fn set_path_env(path: String) {
    // SAFETY: set_var 在 Rust 2024 edition 中是 unsafe 的，
    // 但这里我们确保 path 不包含空字节，所以是安全的
    assert!(!path.contains('\0'), "PATH value cannot contain null bytes");
    unsafe {
        std::env::set_var("PATH", path);
    }
}

/// 在 ~/.local/bin 下创建 env 脚本，安装 Node/uv 后用户可在终端 source 以加入 PATH。
///
/// - **Unix**：创建 ~/.local/bin/env，用户可 source 或加入 shell 配置。
/// - **Windows**：创建 ~/.local/bin/env.bat，用户可在 cmd 中执行或加入系统环境变量。
pub fn ensure_local_bin_env() -> Result<(), std::io::Error> {
    let bin_dir = local_bin_dir();
    std::fs::create_dir_all(&bin_dir)?;

    #[cfg(windows)]
    {
        let content = format!(r"@echo off
REM NuWax: 添加 ~/.local/bin 到 PATH
set PATH={};%PATH%
", bin_dir.display());
        std::fs::write(bin_dir.join("env.bat"), content)?;
        Ok(())
    }

    #[cfg(unix)]
    {
        let content = r#"# NuWax: 终端中执行 . "$HOME/.local/bin/env" 或加入 .zshrc
export PATH="$HOME/.local/bin${PATH:+:$PATH}"
"#;
        std::fs::write(bin_dir.join("env"), content)?;
        Ok(())
    }
}


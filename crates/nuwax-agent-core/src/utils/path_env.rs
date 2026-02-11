//! PATH 与 ~/.local/bin 环境脚本（与 Tauri fix-path-env 互补：fix-path-env 修 GUI 进程 PATH，此处写终端用 env 脚本并在 spawn 时兜底注入）。
//!
//! - **Unix (macOS/Linux)**：在 PATH 前追加 ~/.local/bin，便于使用本地安装的 node/uv 等。
//! - **Windows**：直接使用系统 PATH，不追加用户目录；依赖通过全局安装（如 `npm i -g`）即可，无需单独设置环境变量。

use std::path::PathBuf;

/// 返回 ~/.local/bin（仅 Unix；Windows 不使用此目录）。
fn local_bin_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}

/// 构建供 spawn/子进程使用的 PATH 字符串。
///
/// - **Unix**：在现有 PATH 前追加 ~/.local/bin（安装 node/uv 到本地后即生效）。
/// - **Windows**：直接返回当前系统 PATH，不修改；依赖请使用全局安装（如 `npm i -g`），无需设置额外环境变量。
pub fn build_node_path_env() -> String {
    #[cfg(windows)]
    {
        return std::env::var("PATH").unwrap_or_default();
    }

    #[cfg(not(windows))]
    {
        let bin = local_bin_dir();
        let current = std::env::var("PATH").unwrap_or_default();
        format!("{}:{}", bin.to_string_lossy(), current)
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

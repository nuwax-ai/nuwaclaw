//! PATH 与运行时环境管理
//!
//! 提供子进程启动时的 PATH 环境变量构建，支持以下路径来源：
//!
//! 1. **NUWAX_APP_RUNTIME_PATH**: 由 Tauri 层设置，指向 .app 包内的 node/bin 和 uv/bin 目录
//!    - 新架构：直接使用 .app 包内资源，保持 macOS 代码签名
//! 2. **NUWAX_APP_BUNDLED_NODE_PATH**: 指向打包的 Node.js bin 目录（可选，用于额外灵活性）
//! 3. **~/.local/bin**: 用户本地安装的工具目录（回退）
//!
//! 环境变量优先级：NUWAX_APP_RUNTIME_PATH > NUWAX_APP_BUNDLED_NODE_PATH > ~/.local/bin > 系统 PATH

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
/// 优先顺序：
/// 1. NUWAX_APP_RUNTIME_PATH - 由 Tauri 层设置，包含 .app 包内资源路径
/// 2. NUWAX_APP_BUNDLED_NODE_PATH - 打包的 Node.js bin 目录
/// 3. ~/.local/bin - 用户本地安装目录
/// 4. 系统 PATH
pub fn build_node_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(windows)]
    let sep = ";";
    #[cfg(not(windows))]
    let sep = ":";

    // 1. 优先使用 NUWAX_APP_RUNTIME_PATH（由 Tauri 层设置）
    if let Ok(runtime_path) = std::env::var("NUWAX_APP_RUNTIME_PATH") {
        let runtime_path = runtime_path.trim();
        if !runtime_path.is_empty() {
            return format!("{}{}{}", runtime_path, sep, current);
        }
    }

    // 2. 回退到 NUWAX_APP_BUNDLED_NODE_PATH（单独指定的 Node.js 路径）
    if let Ok(bundled_path) = std::env::var("NUWAX_APP_BUNDLED_NODE_PATH") {
        let bundled_path = bundled_path.trim();
        if !bundled_path.is_empty() {
            return format!("{}{}{}", bundled_path, sep, current);
        }
    }

    // 3. 回退到 ~/.local/bin
    let bin = local_bin_dir();
    format!("{}{}{}", bin.to_string_lossy(), sep, current)
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

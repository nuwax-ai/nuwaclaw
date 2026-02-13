//! 子进程环境变量管理 — 与用户系统环境隔离。
//!
//! 子进程不继承父进程/用户的完整环境变量，仅使用我们管理的运行时路径 + 最小系统基础变量，
//! 避免用户 IDE 工具、build 产物等无关配置污染子进程环境。
//!
//! 与 Tauri fix-path-env 互补：fix-path-env 修 GUI 进程 PATH，此处管控 spawn 子进程的完整环境。

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
/// **完全隔离**：仅包含 NUWAX_APP_RUNTIME_PATH 中的应用自有运行时目录，
/// 不包含 ~/.local/bin、/usr/bin 等任何系统或用户路径，彻底避免环境污染。
pub fn build_node_path_env() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut paths: Vec<String> = Vec::new();

    // 仅使用 NUWAX_APP_RUNTIME_PATH（Tauri 打包后的运行时路径）
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

    paths.join(sep)
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

    env
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

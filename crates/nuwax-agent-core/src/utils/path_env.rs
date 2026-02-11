//! PATH 与 ~/.local/bin 环境脚本（与 Tauri fix-path-env 互补：fix-path-env 修 GUI 进程 PATH，此处写终端用 env 脚本并在 spawn 时兜底注入）。

use std::path::PathBuf;

/// 返回 ~/.local/bin（Unix）或 %USERPROFILE%\.local\bin（Windows）。
fn local_bin_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}

/// 构建带 ~/.local/bin 前缀的 PATH，供 spawn/进程环境使用。
/// 始终 prepend，即使目录尚未存在（安装 node/uv 后即会生效）。
pub fn build_node_path_env() -> String {
    let bin = local_bin_dir();
    let current = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(windows) { ";" } else { ":" };
    format!("{}{}{}", bin.to_string_lossy(), sep, current)
}

/// 在 ~/.local/bin 下创建 env 脚本，安装 Node/uv 后用户可在终端 source 以加入 PATH。
/// Unix: ~/.local/bin/env；Windows: env.bat + env.ps1。目录不存在会先创建。
pub fn ensure_local_bin_env() -> Result<(), std::io::Error> {
    let bin_dir = local_bin_dir();
    std::fs::create_dir_all(&bin_dir)?;

    #[cfg(unix)]
    {
        let content = r#"# NuWax: 终端中执行 . "$HOME/.local/bin/env" 或加入 .zshrc
export PATH="$HOME/.local/bin${PATH:+:$PATH}"
"#;
        std::fs::write(bin_dir.join("env"), content)?;
    }

    #[cfg(windows)]
    {
        let bat = r#"@echo off
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
"#;
        let ps1 = r#"$env:PATH = "$env:USERPROFILE\.local\bin;$env:PATH"
"#;
        std::fs::write(bin_dir.join("env.bat"), bat)?;
        std::fs::write(bin_dir.join("env.ps1"), ps1)?;
    }

    Ok(())
}

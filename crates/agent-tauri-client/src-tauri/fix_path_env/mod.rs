//! PATH 环境修复模块
//!
//! 通过在 ~/.local/bin/ 下创建 env 脚本，使终端（shell）用户可以
//! 通过 source 命令加入应用提供 node/uv 等工具。
//!
//! 与 Tauri fix-path-env 互补：Tauri 侧负责修复 GUI 进程的 PATH，
//! 此模块负责创建终端可用的 env 脚本。

use std::path::PathBuf;

/// 返回 ~/.local/bin（Unix）或 %USERPROFILE%\.local\bin（Windows）
fn local_bin_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}

/// 在 ~/.local/bin 下创建 env 脚本，安装 Node/uv 后用户可在终端 source 以加入 PATH。
///
/// Unix: ~/.local/bin/env；Windows: env.bat + env.ps1。目录不存在会先创建。
pub fn fix() -> Result<(), Box<dyn std::error::Error>> {
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
        // Windows 使用批处理 + PowerShell 双方案
        let bat = r#"@echo off
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
"#;
        std::fs::write(bin_dir.join("env.bat"), bat)?;

        let ps1 = r#"$env:PATH = "$env:USERPROFILE\.local\bin;$env:PATH"
"#;
        std::fs::write(bin_dir.join("env.ps1"), ps1)?;
    }

    Ok(())
}

//! PATH 环境变量构建工具
//!
//! npm 全局安装的脚本通过 `#!/usr/bin/env node` 查找 node，
//! macOS GUI 应用的 PATH 通常不包含我们安装的 node 目录，
//! 需要手动注入到 PATH 中。

use std::path::PathBuf;

/// 构建包含 node bin 目录的 PATH 环境变量
///
/// 将以下目录注入到 PATH 前面：
/// 1. `~/.local/share/nuwax-agent/tools/node/bin/` (本地安装路径)
/// 2. `~/.local/bin/` (全局符号链接)
pub fn build_node_path_env() -> String {
    let mut extra_dirs: Vec<String> = Vec::new();

    // 1. 本地安装路径
    let local_bin_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nuwax-agent")
        .join("tools")
        .join("node")
        .join("bin");
    if local_bin_dir.exists() {
        extra_dirs.push(local_bin_dir.to_string_lossy().to_string());
    }

    // 2. ~/.local/bin/
    let global_bin_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin");
    if global_bin_dir.exists() {
        extra_dirs.push(global_bin_dir.to_string_lossy().to_string());
    }

    let current_path = std::env::var("PATH").unwrap_or_default();
    if extra_dirs.is_empty() {
        current_path
    } else {
        let separator = if cfg!(windows) { ";" } else { ":" };
        format!(
            "{}{}{}",
            extra_dirs.join(separator),
            separator,
            current_path
        )
    }
}

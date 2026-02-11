//! PATH 环境变量构建工具
//!
//! npm 全局安装的脚本通过 `#!/usr/bin/env node` 查找 node，
//! macOS GUI 应用的 PATH 通常不包含 ~/.local/bin/，
//! 需要手动注入到 PATH 中。

use std::path::PathBuf;

/// 构建包含 ~/.local/bin/ 的 PATH 环境变量
///
/// Node.js 安装在 ~/.local/bin/node，npm/npx 也在 ~/.local/bin/，
/// 将 ~/.local/bin/ 注入到 PATH 前面以确保 GUI 进程能找到 node。
pub fn build_node_path_env() -> String {
    let global_bin_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin");

    let current_path = std::env::var("PATH").unwrap_or_default();
    if global_bin_dir.exists() {
        let separator = if cfg!(windows) { ";" } else { ":" };
        format!(
            "{}{}{}",
            global_bin_dir.to_string_lossy(),
            separator,
            current_path
        )
    } else {
        current_path
    }
}

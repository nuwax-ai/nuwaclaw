//! PATH 环境变量工具函数

use std::path::Path;

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

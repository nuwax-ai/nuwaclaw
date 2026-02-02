//! 平台适配模块

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "linux")]
pub mod linux;

/// 获取平台名称
pub fn platform_name() -> &'static str {
    #[cfg(target_os = "macos")]
    return "macOS";

    #[cfg(target_os = "windows")]
    return "Windows";

    #[cfg(target_os = "linux")]
    return "Linux";

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "Unknown";
}

/// 获取机器 ID
pub fn get_machine_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    return macos::get_machine_id();

    #[cfg(target_os = "windows")]
    return windows::get_machine_id();

    #[cfg(target_os = "linux")]
    return linux::get_machine_id();

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return None;
}

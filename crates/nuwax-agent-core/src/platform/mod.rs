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

/// 检查指定端口是否可用（未被占用）
pub fn check_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 获取平台特定的防火墙操作引导文案
pub fn firewall_guide() -> &'static str {
    #[cfg(target_os = "macos")]
    return "macOS: 打开 系统设置 > 网络 > 防火墙 > 选项，将本应用添加到允许列表。";

    #[cfg(target_os = "windows")]
    return "Windows: 打开 Windows Defender 防火墙 > 允许应用通过防火墙，将本应用添加到列表中。";

    #[cfg(target_os = "linux")]
    return "Linux: 如果使用 ufw，执行 sudo ufw allow <端口>/tcp；如果使用 firewalld，执行 sudo firewall-cmd --add-port=<端口>/tcp --permanent && sudo firewall-cmd --reload。";

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return "请在系统防火墙中允许本应用的网络访问。";
}

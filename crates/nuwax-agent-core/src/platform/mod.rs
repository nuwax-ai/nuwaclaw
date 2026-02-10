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
///
/// 使用 TcpListener 尝试绑定端口。
/// 注意：由于 TcpListener 不支持在绑定前设置 SO_REUSEADDR，
/// 测试中调用方应在释放端口后等待短暂时间再检查。
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_name_returns_known_value() {
        let name = platform_name();
        assert!(
            ["macOS", "Windows", "Linux", "Unknown"].contains(&name),
            "unexpected platform: {}",
            name
        );
    }

    #[test]
    fn test_check_port_available_on_unused_port() {
        // 获取一个临时端口（由 OS 分配）
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        // 释放端口
        drop(listener);

        // 短暂延迟让操作系统完成端口状态转换
        std::thread::sleep(std::time::Duration::from_millis(1));

        // 检查端口是否可用
        assert!(check_port_available(port), "端口 {} 应该可用", port);
    }

    #[test]
    fn test_check_port_available_on_occupied_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // 绑定中端口应该不可用
        assert!(!check_port_available(port));
        drop(listener);
    }

    #[test]
    fn test_firewall_guide_returns_non_empty() {
        let guide = firewall_guide();
        assert!(!guide.is_empty());
    }

    #[test]
    fn test_firewall_guide_platform_specific_content() {
        let guide = firewall_guide();
        #[cfg(target_os = "macos")]
        assert!(guide.contains("macOS"));
        #[cfg(target_os = "windows")]
        assert!(guide.contains("Windows"));
        #[cfg(target_os = "linux")]
        assert!(guide.contains("Linux"));
    }

    #[test]
    fn test_get_machine_id_returns_option() {
        let id = get_machine_id();
        // 在 CI 或桌面环境中应该返回 Some
        // 不断言具体值，只确保不 panic
        if let Some(ref machine_id) = id {
            assert!(!machine_id.is_empty());
        }
    }
}

//! Linux 平台实现

use std::fs;

/// 获取机器 ID
pub fn get_machine_id() -> Option<String> {
    // 尝试读取 /etc/machine-id
    if let Ok(id) = fs::read_to_string("/etc/machine-id") {
        return Some(id.trim().to_string());
    }

    // 尝试读取 /var/lib/dbus/machine-id
    if let Ok(id) = fs::read_to_string("/var/lib/dbus/machine-id") {
        return Some(id.trim().to_string());
    }

    None
}

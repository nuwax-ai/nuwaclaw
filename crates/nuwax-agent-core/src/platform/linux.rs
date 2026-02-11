//! 平台适配模块 - Linux

use crate::utils::CommandNoWindowExt;
use std::process::Command;

/// 获取 Linux 机器 ID
pub fn get_machine_id() -> Option<String> {
    // 方式 1: 读取 /etc/machine-id
    if let Ok(content) = std::fs::read_to_string("/etc/machine-id") {
        let id = content.trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }

    // 方式 2: 读取 /var/lib/dbus/machine-id
    if let Ok(content) = std::fs::read_to_string("/var/lib/dbus/machine-id") {
        let id = content.trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }

    // 方式 3: 使用 hostid 命令
    let output = Command::new("hostid").no_window().output().ok()?;
    if output.status.success() {
        let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !id.is_empty() {
            return Some(id);
        }
    }

    None
}

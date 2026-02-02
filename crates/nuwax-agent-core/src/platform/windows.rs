//! 平台适配模块 - Windows

use std::process::Command;

/// 获取 Windows 机器 ID
pub fn get_machine_id() -> Option<String> {
    // 使用 wmic 获取产品 ID 和机器 GUID
    let output = Command::new("wmic")
        .args(&["csproduct", "get", "UUID"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // 解析 UUID（通常在第二行）
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() >= 2 {
            let uuid = lines[1].trim();
            if !uuid.is_empty() && uuid != "UUID" {
                return Some(uuid.to_string());
            }
        }
    }

    // 备选：使用 powershell 获取
    let output = Command::new("powershell")
        .args(&["-Command", "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID"])
        .output()
        .ok()?;

    if output.status.success() {
        let uuid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !uuid.is_empty() {
            return Some(uuid);
        }
    }

    None
}

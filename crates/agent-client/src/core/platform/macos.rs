//! macOS 平台实现

use std::process::Command;

/// 获取机器 ID
pub fn get_machine_id() -> Option<String> {
    let output = Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        if line.contains("IOPlatformUUID") {
            if let Some(uuid) = line.split('"').nth(3) {
                return Some(uuid.to_string());
            }
        }
    }

    None
}

//! 平台适配模块 - macOS

use crate::utils::CommandNoWindowExt;
use std::process::Command;

/// 获取 macOS 机器 ID
pub fn get_machine_id() -> Option<String> {
    // 使用 macOS 独有的设备序列号
    // 尝试多个方式获取唯一标识

    // 方式 1: 使用 ioreg 获取设备序列号
    let output = Command::new("ioreg")
        .no_window()
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // 解析 IOPlatformSerialNumber
        if let Some(serial_start) = stdout.find("IOPlatformSerialNumber") {
            let slice = &stdout[serial_start..];
            if let Some(equals) = slice.find('=') {
                if let Some(quote_end) = slice[equals + 1..].find('"') {
                    let serial = &slice[equals + 2..equals + 1 + quote_end];
                    if !serial.is_empty() {
                        return Some(serial.to_string());
                    }
                }
            }
        }
    }

    // 方式 2: 使用 system_profiler 获取
    let output = Command::new("system_profiler")
        .no_window()
        .args(["SPHardwareDataType", "-json"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // 尝试解析 JSON 获取序列号
        if let Some(serial_start) = stdout.find("serial_number") {
            let slice = &stdout[serial_start..];
            if let Some(colon) = slice.find(':') {
                let value_start = slice[colon + 1..].find('"')? + colon + 1;
                let value_end = slice[value_start + 1..].find('"')? + value_start + 1;
                let serial = &slice[value_start + 1..value_end];
                if !serial.is_empty() {
                    return Some(serial.to_string());
                }
            }
        }
    }

    None
}

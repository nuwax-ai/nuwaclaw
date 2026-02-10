//! 权限轮询示例
//!
//! 演示如何通过轮询检查权限状态变化（不依赖 PermissionMonitor）
//!
//! 运行方式: cargo run --example monitoring

use std::collections::HashMap;

use system_permissions::{create_permission_manager, PermissionStatus, SystemPermission};

#[tokio::main]
async fn main() {
    println!("=== 权限轮询示例 ===\n");

    let manager = create_permission_manager();
    let permissions = manager.supported_permissions();

    // 记录上一轮状态，用于检测变化
    let mut prev: HashMap<SystemPermission, PermissionStatus> = HashMap::new();

    println!("每 2 秒轮询一次权限状态 (共 3 轮)...\n");

    for round in 1..=3 {
        println!("--- 第 {} 轮 ---", round);
        for permission in &permissions {
            let state = manager.check(*permission).await;
            let changed = prev
                .get(permission)
                .map(|s| *s != state.status)
                .unwrap_or(true);
            prev.insert(*permission, state.status);
            let marker = if changed { " (变化)" } else { "" };
            println!("  {}: {:?}{}", permission.name(), state.status, marker);
        }
        if round < 3 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }

    println!("\n=== 示例完成 ===");
}

//! 基础使用示例
//!
//! 演示如何检查和请求系统权限
//!
//! 运行方式: cargo run --example basic

use system_permissions::{create_permission_manager, RequestOptions, SystemPermission};

#[tokio::main]
async fn main() {
    println!("=== 系统权限管理示例 ===\n");

    // 创建权限管理器 (自动根据当前平台)
    let manager = create_permission_manager();

    // 显示支持的权限
    let permissions = manager.supported_permissions();
    println!("支持的权限 ({} 种):", permissions.len());
    for permission in &permissions {
        println!("  - {}: {}", permission.name(), permission.description());
    }
    println!();

    // 检查麦克风权限
    println!("检查麦克风权限...");
    let mic_state = manager.check(SystemPermission::Microphone).await;
    println!("  状态: {:?}", mic_state.status);
    println!();

    // 检查相机权限
    println!("检查相机权限...");
    let camera_state = manager.check(SystemPermission::Camera).await;
    println!("  状态: {:?}", camera_state.status);
    println!();

    // 批量检查所有权限
    println!("批量检查所有权限...");
    let states = manager.check_all(&permissions).await;
    for state in &states {
        let status_str = state.status.to_string();
        println!("  {:?}: {}", state.permission, status_str);
    }
    println!();

    // 如果麦克风未授权，尝试请求
    if !mic_state.is_authorized() {
        println!("请求麦克风权限 (交互式)...");
        let result = manager
            .request(
                SystemPermission::Microphone,
                RequestOptions::interactive().with_reason("需要麦克风权限进行语音输入"),
            )
            .await;

        if result.granted {
            println!("  ✓ 麦克风权限已授予!");
        } else {
            println!("  ✗ 麦克风权限请求失败");
            if let Some(guide) = result.settings_guide {
                println!("  请手动启用: {}", guide);
            }
        }
    } else {
        println!("✓ 麦克风权限已授权");
    }

    println!("\n=== 示例完成 ===");
}

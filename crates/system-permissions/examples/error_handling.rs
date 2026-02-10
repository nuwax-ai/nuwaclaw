//! 错误处理示例
//!
//! 演示如何处理权限操作中的错误
//!
//! 运行方式: cargo run --example error_handling

use system_permissions::{
    create_permission_manager, PermissionError, RequestOptions, SystemPermission,
};

#[tokio::main]
async fn main() {
    println!("=== 错误处理示例 ===\n");

    let manager = create_permission_manager();

    // 示例 1: 处理不支持的权限
    println!("1. 测试不支持的权限 (如果适用)...");
    #[cfg(not(target_os = "macos"))]
    {
        let result = manager
            .request(
                SystemPermission::AppleScript,
                RequestOptions::non_interactive(),
            )
            .await;
        handle_result(&result);
    }
    #[cfg(target_os = "macos")]
    {
        println!("   AppleScript 在 macOS 上支持，跳过此测试");
    }
    println!();

    // 示例 2: 尝试请求被拒绝的权限
    println!("2. 请求被拒绝的权限 (非交互式)...");
    let result = manager
        .request(
            SystemPermission::Microphone,
            RequestOptions::non_interactive(),
        )
        .await;
    handle_result(&result);
    println!();

    // 示例 3: 批量检查权限并收集错误
    println!("3. 批量检查权限...");
    let permissions = vec![
        SystemPermission::Microphone,
        SystemPermission::Camera,
        SystemPermission::Accessibility,
    ];

    let mut missing_permissions = Vec::new();
    let mut unsupported_permissions = Vec::new();

    for permission in permissions {
        let state = manager.check(permission).await;
        if state.status.requires_manual_action() {
            missing_permissions.push(permission);
        }
        if !permission.is_supported() {
            unsupported_permissions.push(permission);
        }
    }

    if !missing_permissions.is_empty() {
        println!("   需要手动启用的权限:");
        for permission in &missing_permissions {
            println!("     - {:?}", permission);
            // 尝试打开设置
            let _ = manager.open_settings(*permission).await;
        }
    }

    if !unsupported_permissions.is_empty() {
        println!("   不支持的权限:");
        for permission in &unsupported_permissions {
            println!("     - {:?}", permission);
        }
    }

    if missing_permissions.is_empty() && unsupported_permissions.is_empty() {
        println!("   所有权限已授权或可请求");
    }
    println!();

    // 示例 4: 使用 PermissionResult 类型
    println!("4. 使用 Result 类型处理错误...");

    // 模拟一个权限操作
    let permission_result: Result<(), PermissionError> =
        manager.open_settings(SystemPermission::Microphone).await;

    match permission_result {
        Ok(()) => println!("   成功打开设置页面"),
        Err(e) => {
            println!("   打开设置失败: {}", e);
            println!("   用户友好消息: {}", e.user_message());
            if e.requires_manual_action() {
                println!("   需要用户手动操作");
            }
        }
    }

    println!("\n=== 示例完成 ===");
}

fn handle_result(result: &system_permissions::RequestResult) {
    if result.is_success() {
        println!("   ✓ 权限请求成功");
    } else {
        println!("   ✗ 权限请求失败");
        if let Some(msg) = &result.error_message {
            println!("     错误: {}", msg);
        }
        if let Some(guide) = &result.settings_guide {
            println!("     指引: {}", guide);
        }
    }
}

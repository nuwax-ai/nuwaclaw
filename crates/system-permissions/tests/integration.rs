//! 集成测试
//!
//! 仅测试权限管理器；PermissionMonitor 已简化，不在此测试

use system_permissions::{
    create_permission_manager, PermissionChangeCallback, PermissionState, PermissionStatus,
    SystemPermission,
};

/// 测试权限管理器创建
#[tokio::test]
async fn test_create_permission_manager() {
    let manager = create_permission_manager();
    let permissions = manager.supported_permissions();

    // 验证至少返回了一些权限
    assert!(!permissions.is_empty());
}

/// 测试权限检查
#[tokio::test]
async fn test_permission_check() {
    let manager = create_permission_manager();

    // 测试检查单个权限
    for permission in manager.supported_permissions() {
        let state = manager.check(permission).await;
        assert_eq!(state.permission, permission);
        // 状态应该是有效的枚举值之一
        assert!(matches!(
            state.status,
            system_permissions::PermissionStatus::NotDetermined
                | system_permissions::PermissionStatus::Authorized
                | system_permissions::PermissionStatus::Denied
                | system_permissions::PermissionStatus::Restricted
                | system_permissions::PermissionStatus::Unavailable
        ));
    }
}

/// 测试批量权限检查
#[tokio::test]
async fn test_permission_check_all() {
    let manager = create_permission_manager();
    let permissions = manager.supported_permissions();
    let states = manager.check_all(&permissions).await;

    assert_eq!(states.len(), permissions.len());

    for (permission, state) in permissions.iter().zip(states.iter()) {
        assert_eq!(permission, &state.permission);
    }
}

/// 测试权限状态结构
#[tokio::test]
async fn test_permission_state_constructors() {
    let state = PermissionState::new(SystemPermission::Microphone, PermissionStatus::Authorized);
    assert_eq!(state.permission, SystemPermission::Microphone);
    assert_eq!(state.status, PermissionStatus::Authorized);
    assert!(state.is_authorized());

    let state = PermissionState::denied(SystemPermission::Camera);
    assert_eq!(state.status, PermissionStatus::Denied);
    assert!(!state.is_authorized());

    let state = PermissionState::unavailable(SystemPermission::AppleScript);
    assert_eq!(state.status, PermissionStatus::Unavailable);
}

/// 测试 PermissionChangeCallback trait 可被实现 (回调接口存在)
#[tokio::test]
async fn test_permission_change_callback_trait() {
    struct TestCallback {
        called: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    impl PermissionChangeCallback for TestCallback {
        fn on_change(&self, _permission: SystemPermission, _state: PermissionState) {
            self.called
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    let called = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let callback = TestCallback {
        called: called.clone(),
    };
    // 手动调用一次，验证 trait 实现可用
    let state = PermissionState::denied(SystemPermission::Microphone);
    callback.on_change(SystemPermission::Microphone, state);
    assert_eq!(called.load(std::sync::atomic::Ordering::SeqCst), 1);
}

/// 测试特定权限是否在平台支持列表中
#[tokio::test]
async fn test_platform_supported_permissions() {
    let manager = create_permission_manager();
    let permissions = manager.supported_permissions();

    // 验证返回的权限是有效的
    for permission in &permissions {
        assert!(permission.is_supported());
    }
}

//! 单元测试
//!
//! 测试在 tests/ 目录下，作为独立 crate 链接 system_permissions，故使用 system_permissions:: 导入

mod types_tests {
    use system_permissions::{LocationMode, PermissionStatus, RequestOptions, SystemPermission};

    #[test]
    fn test_permission_names() {
        assert_eq!(SystemPermission::Accessibility.name(), "Accessibility");
        assert_eq!(SystemPermission::ScreenRecording.name(), "Screen Recording");
        assert_eq!(SystemPermission::Microphone.name(), "Microphone");
        assert_eq!(SystemPermission::Camera.name(), "Camera");
        assert_eq!(SystemPermission::Notifications.name(), "Notifications");
        assert_eq!(SystemPermission::Location.name(), "Location");
        assert_eq!(SystemPermission::NuwaxCode.name(), "NuwaxCode");
        assert_eq!(SystemPermission::ClaudeCode.name(), "Claude Code");
        assert_eq!(
            SystemPermission::FileSystemRead.name(),
            "File System (Read)"
        );
        assert_eq!(
            SystemPermission::FileSystemWrite.name(),
            "File System (Write)"
        );
        assert_eq!(SystemPermission::Clipboard.name(), "Clipboard");
        assert_eq!(
            SystemPermission::KeyboardMonitoring.name(),
            "Keyboard Monitoring"
        );
        assert_eq!(SystemPermission::Network.name(), "Network");
    }

    #[test]
    fn test_permission_descriptions() {
        assert!(!SystemPermission::Microphone.description().is_empty());
        assert!(SystemPermission::Camera.description().contains("video"));
        assert!(SystemPermission::FileSystemRead
            .description()
            .contains("read"));
        assert!(SystemPermission::Clipboard
            .description()
            .contains("clipboard"));
        assert!(SystemPermission::Network.description().contains("network"));
    }

    #[test]
    fn test_permission_status_is_authorized() {
        assert!(PermissionStatus::Authorized.is_authorized());
        assert!(!PermissionStatus::Denied.is_authorized());
        assert!(!PermissionStatus::NotDetermined.is_authorized());
    }

    #[test]
    fn test_permission_status_can_request() {
        assert!(PermissionStatus::NotDetermined.can_request());
        assert!(!PermissionStatus::Authorized.can_request());
        assert!(!PermissionStatus::Denied.can_request());
    }

    #[test]
    fn test_permission_status_requires_manual_action() {
        assert!(PermissionStatus::Denied.requires_manual_action());
        assert!(PermissionStatus::Restricted.requires_manual_action());
        assert!(!PermissionStatus::Authorized.requires_manual_action());
        assert!(!PermissionStatus::NotDetermined.requires_manual_action());
    }

    #[test]
    fn test_permission_status_to_string() {
        assert_eq!(PermissionStatus::Authorized.to_string(), "Authorized");
        assert_eq!(PermissionStatus::Denied.to_string(), "Denied");
        assert_eq!(
            PermissionStatus::NotDetermined.to_string(),
            "Not Determined"
        );
    }

    #[test]
    fn test_location_mode_name() {
        assert_eq!(LocationMode::Off.name(), "Off");
        assert_eq!(LocationMode::WhileUsing.name(), "While Using");
        assert_eq!(LocationMode::Always.name(), "Always");
    }

    #[test]
    fn test_request_options_default() {
        let options = RequestOptions::default();
        assert!(options.interactive);
        assert_eq!(options.timeout_ms, 30_000);
        assert!(options.reason.is_none());
    }

    #[test]
    fn test_request_options_builder() {
        let options = RequestOptions::interactive()
            .with_timeout(60_000)
            .with_reason("Test reason");

        assert!(options.interactive);
        assert_eq!(options.timeout_ms, 60_000);
        assert_eq!(options.reason, Some("Test reason".to_string()));
    }

    #[test]
    fn test_request_options_non_interactive() {
        let options = RequestOptions::non_interactive();
        assert!(!options.interactive);
    }
}

mod error_tests {
    use system_permissions::PermissionError;

    #[test]
    fn test_error_messages() {
        let error = PermissionError::unsupported("Microphone");
        assert!(error.to_string().contains("Microphone"));
        assert!(error.to_string().contains("not supported"));

        let error = PermissionError::timeout(30000);
        assert!(error.to_string().contains("30000ms"));
    }

    #[test]
    fn test_user_message() {
        let error = PermissionError::PermanentlyDenied;
        let message = error.user_message();
        assert!(message.contains("manually"));
        assert!(message.contains("settings"));

        let error = PermissionError::settings_open_failed("test reason");
        let message = error.user_message();
        assert!(message.contains("Failed to open settings"));
    }

    #[test]
    fn test_requires_manual_action() {
        assert!(PermissionError::PermanentlyDenied.requires_manual_action());
        assert!(PermissionError::SettingsOpenFailed {
            reason: "test".to_string()
        }
        .requires_manual_action());

        assert!(!PermissionError::DeniedByUser.requires_manual_action());
        assert!(!PermissionError::timeout(1000).requires_manual_action());
    }
}

//! Phase 5 单元测试 - 增强功能
//!
//! 测试权限管理、日志系统、主题管理

#[cfg(test)]
mod permission_tests {
    use nuwax_agent::core::permissions::{PermissionManager, PermissionStatus, PermissionType};

    #[test]
    fn test_permission_type_description() {
        assert_eq!(PermissionType::Accessibility.description(), "辅助功能");
        assert_eq!(PermissionType::ScreenRecording.description(), "屏幕录制");
        assert_eq!(PermissionType::FullDiskAccess.description(), "完整磁盘访问");
        assert_eq!(PermissionType::FileAccess.description(), "文件系统访问");
        assert_eq!(PermissionType::NetworkAccess.description(), "网络访问");
    }

    #[test]
    fn test_permission_type_required() {
        assert!(PermissionType::Accessibility.is_required());
        assert!(PermissionType::FileAccess.is_required());
        assert!(PermissionType::NetworkAccess.is_required());
        assert!(!PermissionType::ScreenRecording.is_required());
        assert!(!PermissionType::FullDiskAccess.is_required());
    }

    #[test]
    fn test_permission_status_granted() {
        assert!(PermissionStatus::Granted.is_granted());
        assert!(!PermissionStatus::Denied.is_granted());
        assert!(!PermissionStatus::NotDetermined.is_granted());
        assert!(!PermissionStatus::Unavailable.is_granted());
    }

    #[test]
    fn test_manager_creation() {
        let manager = PermissionManager::new();
        assert!(manager.permissions().is_empty());
    }

    #[test]
    fn test_check_all_permissions() {
        let mut manager = PermissionManager::new();
        let perms = manager.check_all();
        assert_eq!(perms.len(), 5);

        // 每种权限类型应该都有
        let types: Vec<_> = perms.iter().map(|p| p.permission_type).collect();
        assert!(types.contains(&PermissionType::Accessibility));
        assert!(types.contains(&PermissionType::ScreenRecording));
        assert!(types.contains(&PermissionType::FullDiskAccess));
        assert!(types.contains(&PermissionType::FileAccess));
        assert!(types.contains(&PermissionType::NetworkAccess));
    }

    #[test]
    fn test_check_single_permission() {
        let manager = PermissionManager::new();
        let info = manager.check(PermissionType::NetworkAccess);
        assert_eq!(info.permission_type, PermissionType::NetworkAccess);
        assert!(!info.description.is_empty());
    }
}

#[cfg(test)]
mod logger_tests {
    use nuwax_agent::core::logger::{LogConfig, LogLevel, Logger};

    #[test]
    fn test_log_level_default() {
        assert_eq!(LogLevel::default(), LogLevel::Info);
    }

    #[test]
    fn test_log_level_as_str() {
        assert_eq!(LogLevel::Trace.as_str(), "trace");
        assert_eq!(LogLevel::Debug.as_str(), "debug");
        assert_eq!(LogLevel::Info.as_str(), "info");
        assert_eq!(LogLevel::Warn.as_str(), "warn");
        assert_eq!(LogLevel::Error.as_str(), "error");
    }

    #[test]
    fn test_log_config_default() {
        let config = LogConfig::default();
        assert_eq!(config.app_name, "nuwax-agent");
        assert_eq!(config.level, LogLevel::Info);
        assert!(config.file_output);
        assert!(config.console_output);
        assert!(config.log_dir.is_none());
        assert_eq!(config.max_files, 7);
    }

    #[test]
    fn test_default_log_dir() {
        let dir = Logger::default_log_dir();
        assert!(dir.to_string_lossy().contains("nuwax-agent"));
        assert!(dir.to_string_lossy().contains("logs"));
    }

    #[test]
    fn test_list_log_files() {
        let result = Logger::list_log_files();
        assert!(result.is_ok());
    }
}

#[cfg(test)]
mod theme_tests {
    use nuwax_agent::core::theme::{ThemeManager, ThemeMode};

    #[test]
    fn test_theme_mode_default() {
        assert_eq!(ThemeMode::default(), ThemeMode::System);
    }

    #[test]
    fn test_theme_mode_from_str() {
        assert_eq!(ThemeMode::from_str("light"), ThemeMode::Light);
        assert_eq!(ThemeMode::from_str("Light"), ThemeMode::Light);
        assert_eq!(ThemeMode::from_str("dark"), ThemeMode::Dark);
        assert_eq!(ThemeMode::from_str("DARK"), ThemeMode::Dark);
        assert_eq!(ThemeMode::from_str("system"), ThemeMode::System);
        assert_eq!(ThemeMode::from_str("auto"), ThemeMode::System);
    }

    #[test]
    fn test_theme_mode_display_name() {
        assert_eq!(ThemeMode::Light.display_name(), "浅色");
        assert_eq!(ThemeMode::Dark.display_name(), "深色");
        assert_eq!(ThemeMode::System.display_name(), "跟随系统");
    }

    #[test]
    fn test_theme_mode_display_name_en() {
        assert_eq!(ThemeMode::Light.display_name_en(), "Light");
        assert_eq!(ThemeMode::Dark.display_name_en(), "Dark");
        assert_eq!(ThemeMode::System.display_name_en(), "System");
    }

    #[test]
    fn test_theme_manager_creation() {
        let manager = ThemeManager::new();
        assert_eq!(manager.mode(), ThemeMode::System);
    }

    #[test]
    fn test_theme_manager_set_mode() {
        let mut manager = ThemeManager::new();

        manager.set_mode(ThemeMode::Dark);
        assert_eq!(manager.mode(), ThemeMode::Dark);
        assert!(manager.is_dark());

        manager.set_mode(ThemeMode::Light);
        assert_eq!(manager.mode(), ThemeMode::Light);
        assert!(!manager.is_dark());
    }

    #[test]
    fn test_all_theme_modes() {
        let modes = ThemeMode::all();
        assert_eq!(modes.len(), 3);
        assert!(modes.contains(&ThemeMode::Light));
        assert!(modes.contains(&ThemeMode::Dark));
        assert!(modes.contains(&ThemeMode::System));
    }
}

#[cfg(test)]
mod upgrade_tests {
    use nuwax_agent::core::upgrade::{UpdateStatus, UpgradeManager};

    #[test]
    fn test_manager_creation() {
        let manager = UpgradeManager::new();
        assert_eq!(manager.status(), &UpdateStatus::Unknown);
        assert!(!manager.has_update());
        assert!(!manager.current_version().is_empty());
    }

    #[test]
    fn test_current_version() {
        let manager = UpgradeManager::new();
        let version = manager.current_version();
        assert!(version.contains('.'));
    }

    #[tokio::test]
    async fn test_check_update() {
        let mut manager = UpgradeManager::new();
        // 当前实现返回错误（功能开发中）
        let result = manager.check_update().await;
        assert!(result.is_err());
    }
}

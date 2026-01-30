//! Phase 3 单元测试 - 依赖管理
//!
//! 测试 Node.js 检测、npm 工具安装、依赖管理器

#[cfg(test)]
mod node_detector_tests {
    use nuwax_agent::core::dependency::NodeDetector;

    #[test]
    fn test_detector_creation() {
        let detector = NodeDetector::new();
        // 只验证创建成功，不依赖实际的 Node.js 安装
        assert!(std::mem::size_of_val(&detector) > 0);
    }

    #[test]
    fn test_local_node_path_contains_app_name() {
        let path = NodeDetector::get_local_node_path();
        let path_str = path.to_string_lossy();
        assert!(path_str.contains("nuwax-agent"));
    }

    #[test]
    fn test_local_node_path_platform_specific() {
        let path = NodeDetector::get_local_node_path();
        let path_str = path.to_string_lossy();

        #[cfg(unix)]
        assert!(path_str.ends_with("bin/node"));

        #[cfg(windows)]
        assert!(path_str.ends_with("node.exe"));
    }

    #[test]
    fn test_detect_may_succeed_or_fail() {
        let detector = NodeDetector::new();
        // 检测可能成功也可能失败，取决于系统是否安装了 Node.js
        let _result = detector.detect();
    }
}

#[cfg(test)]
mod npm_tool_tests {
    use nuwax_agent::core::dependency::NpmToolInstaller;

    #[test]
    fn test_installer_creation() {
        let installer = NpmToolInstaller::new(None);
        assert!(std::mem::size_of_val(&installer) > 0);
    }

    #[test]
    fn test_installer_with_custom_path() {
        use std::path::PathBuf;
        let installer = NpmToolInstaller::new(Some(PathBuf::from("/usr/local/bin/node")));
        assert!(std::mem::size_of_val(&installer) > 0);
    }
}

#[cfg(test)]
mod dependency_manager_tests {
    use nuwax_agent::core::dependency::DependencyManager;

    #[tokio::test]
    async fn test_manager_creation() {
        let manager = DependencyManager::new();
        let deps = manager.get_all().await;

        // 应该包含默认的依赖项
        assert!(deps.len() >= 4); // nodejs, npm, opencode, claude-code
    }

    #[tokio::test]
    async fn test_get_specific_dependency() {
        let manager = DependencyManager::new();

        let nodejs = manager.get("nodejs").await;
        assert!(nodejs.is_some());
        assert_eq!(nodejs.unwrap().display_name, "Node.js");

        let npm = manager.get("npm").await;
        assert!(npm.is_some());

        let nonexistent = manager.get("nonexistent-tool").await;
        assert!(nonexistent.is_none());
    }

    #[tokio::test]
    async fn test_initial_status_is_checking() {
        use nuwax_agent::core::dependency::manager::DependencyStatus;

        let manager = DependencyManager::new();
        let deps = manager.get_all().await;

        // 初始状态应该都是 Checking
        for dep in &deps {
            assert!(matches!(dep.status, DependencyStatus::Checking));
        }
    }

    #[tokio::test]
    async fn test_required_dependencies() {
        let manager = DependencyManager::new();
        let deps = manager.get_all().await;

        // nodejs 和 npm 应该是必需的
        let nodejs = deps.iter().find(|d| d.name == "nodejs").unwrap();
        assert!(nodejs.required);

        let npm = deps.iter().find(|d| d.name == "npm").unwrap();
        assert!(npm.required);

        // opencode 和 claude-code 应该是可选的
        let opencode = deps.iter().find(|d| d.name == "opencode").unwrap();
        assert!(!opencode.required);
    }

    #[tokio::test]
    async fn test_check_all_does_not_panic() {
        let manager = DependencyManager::new();
        // 应该不会 panic，即使依赖未安装
        manager.check_all().await;
    }
}

#[cfg(test)]
mod version_comparison_tests {
    use semver::Version;

    #[test]
    fn test_version_comparison() {
        let min = Version::parse("18.0.0").unwrap();
        let v18 = Version::parse("18.0.0").unwrap();
        let v20 = Version::parse("20.11.0").unwrap();
        let v16 = Version::parse("16.14.0").unwrap();

        assert!(v18 >= min);
        assert!(v20 >= min);
        assert!(v16 < min);
    }

    #[test]
    fn test_version_parsing() {
        // 正确的版本号
        assert!(Version::parse("18.0.0").is_ok());
        assert!(Version::parse("20.11.0").is_ok());

        // 错误的版本号
        assert!(Version::parse("not-a-version").is_err());
    }

    #[test]
    fn test_version_with_v_prefix() {
        // 模拟 node --version 输出
        let version_str = "v20.11.0";
        let cleaned = version_str.trim_start_matches('v');
        let version = Version::parse(cleaned).unwrap();

        assert_eq!(version.major, 20);
        assert_eq!(version.minor, 11);
        assert_eq!(version.patch, 0);
    }
}

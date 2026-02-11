//!
//! 独立单元测试文件
//!
//! 测试不依赖 remote-desktop/file-transfer 特性时可直接运行的核心功能

#[cfg(test)]
mod standalone_tests {

    // ========================================================================
    // BusinessMessageType Tests
    // ========================================================================

    mod business_message_type_tests {
        use crate::business_channel::BusinessMessageType;

        #[test]
        fn test_message_type_from_i32() {
            assert_eq!(
                BusinessMessageType::from(1),
                BusinessMessageType::AgentTaskRequest
            );
            assert_eq!(
                BusinessMessageType::from(2),
                BusinessMessageType::AgentTaskResponse
            );
            assert_eq!(
                BusinessMessageType::from(3),
                BusinessMessageType::TaskProgress
            );
            assert_eq!(
                BusinessMessageType::from(4),
                BusinessMessageType::TaskCancel
            );
            assert_eq!(
                BusinessMessageType::from(10),
                BusinessMessageType::Heartbeat
            );
            assert_eq!(
                BusinessMessageType::from(20),
                BusinessMessageType::SystemNotify
            );
            assert_eq!(
                BusinessMessageType::from(99),
                BusinessMessageType::BusinessCustom
            );
            assert_eq!(
                BusinessMessageType::from(100),
                BusinessMessageType::FileTransferRequest
            );
            assert_eq!(
                BusinessMessageType::from(101),
                BusinessMessageType::FileTransferResponse
            );
            assert_eq!(
                BusinessMessageType::from(102),
                BusinessMessageType::FileBlock
            );
            assert_eq!(
                BusinessMessageType::from(103),
                BusinessMessageType::FileTransferCancel
            );
            assert_eq!(
                BusinessMessageType::from(104),
                BusinessMessageType::FileTransferDone
            );
            assert_eq!(
                BusinessMessageType::from(105),
                BusinessMessageType::FileTransferError
            );
            assert_eq!(
                BusinessMessageType::from(999),
                BusinessMessageType::BusinessUnknown
            );
        }

        #[test]
        fn test_message_type_into_i32() {
            assert_eq!(i32::from(BusinessMessageType::AgentTaskRequest), 1);
            assert_eq!(i32::from(BusinessMessageType::AgentTaskResponse), 2);
            assert_eq!(i32::from(BusinessMessageType::Heartbeat), 10);
            assert_eq!(i32::from(BusinessMessageType::FileTransferRequest), 100);
            assert_eq!(i32::from(BusinessMessageType::FileTransferDone), 104);
        }

        #[test]
        fn test_message_type_default() {
            let default: BusinessMessageType = Default::default();
            assert_eq!(default, BusinessMessageType::BusinessUnknown);
        }
    }

    // ========================================================================
    // BusinessEnvelope Tests
    // ========================================================================

    mod business_envelope_tests {
        use crate::business_channel::{BusinessEnvelope, BusinessMessageType};

        #[test]
        fn test_envelope_new() {
            let envelope = BusinessEnvelope::new();
            assert!(envelope.message_id.is_empty());
            assert_eq!(envelope.type_, BusinessMessageType::BusinessUnknown);
            assert!(envelope.payload.is_empty());
            assert_eq!(envelope.timestamp, 0);
            assert!(envelope.source_id.is_empty());
            assert!(envelope.target_id.is_empty());
        }

        #[test]
        fn test_envelope_builder_pattern() {
            let envelope = BusinessEnvelope::new()
                .with_message_id("msg-123".to_string())
                .with_type(BusinessMessageType::AgentTaskRequest)
                .with_payload(vec![1, 2, 3])
                .with_source_id("admin-1".to_string())
                .with_target_id("agent-1".to_string());

            assert_eq!(envelope.message_id, "msg-123");
            assert_eq!(envelope.type_, BusinessMessageType::AgentTaskRequest);
            assert_eq!(envelope.payload, vec![1, 2, 3]);
            assert_eq!(envelope.source_id, "admin-1");
            assert_eq!(envelope.target_id, "agent-1");
        }

        #[test]
        fn test_envelope_serialization() {
            let envelope = BusinessEnvelope::new()
                .with_message_id("msg-456".to_string())
                .with_type(BusinessMessageType::FileTransferRequest)
                .with_payload(vec![0x01, 0x02, 0x03])
                .with_source_id("server".to_string())
                .with_target_id("client".to_string());

            let bytes = envelope.to_bytes().unwrap();
            let decoded = BusinessEnvelope::from_bytes(&bytes).unwrap();

            assert_eq!(envelope.message_id, decoded.message_id);
            assert_eq!(envelope.type_, decoded.type_);
            assert_eq!(envelope.payload, decoded.payload);
            assert_eq!(envelope.source_id, decoded.source_id);
            assert_eq!(envelope.target_id, decoded.target_id);
        }

        #[test]
        fn test_envelope_default() {
            let default: BusinessEnvelope = Default::default();
            assert!(default.message_id.is_empty());
            assert_eq!(default.type_, BusinessMessageType::BusinessUnknown);
        }
    }

    // ========================================================================
    // BusinessMessage Tests
    // ========================================================================

    mod business_message_tests {
        use crate::business_channel::{BusinessMessage, MessageType};

        #[test]
        fn test_message_new() {
            let message = BusinessMessage::new(MessageType::AgentTaskRequest, vec![1, 2, 3]);

            assert!(!message.id.is_empty());
            assert_eq!(message.message_type, MessageType::AgentTaskRequest);
            assert_eq!(message.payload, vec![1, 2, 3]);
            assert!(message.timestamp > 0);
            assert!(message.source_id.is_none());
            assert!(message.target_id.is_none());
        }

        #[test]
        fn test_message_with_source_target() {
            let message = BusinessMessage::new(MessageType::SystemNotify, vec![])
                .with_source("client-1".to_string())
                .with_target("client-2".to_string());

            assert_eq!(message.source_id, Some("client-1".to_string()));
            assert_eq!(message.target_id, Some("client-2".to_string()));
        }

        #[test]
        fn test_message_serialization() {
            let message =
                BusinessMessage::new(MessageType::FileTransferRequest, vec![1, 2, 3, 4, 5])
                    .with_source("sender".to_string())
                    .with_target("receiver".to_string());

            let bytes = message.to_bytes().unwrap();
            let decoded = BusinessMessage::from_bytes(&bytes).unwrap();

            assert_eq!(message.id, decoded.id);
            assert_eq!(message.message_type, decoded.message_type);
            assert_eq!(message.payload, decoded.payload);
            assert_eq!(message.source_id, decoded.source_id);
            assert_eq!(message.target_id, decoded.target_id);
        }
    }

    // ========================================================================
    // ChannelError Tests
    // ========================================================================

    mod channel_error_tests {
        use crate::business_channel::ChannelError;

        #[test]
        fn test_channel_error_messages() {
            let error = ChannelError::NotConnected;
            assert!(error.to_string().contains("未连接"));

            let error = ChannelError::SendFailed("test".to_string());
            assert!(error.to_string().contains("发送失败"));

            let error = ChannelError::ReceiveFailed("test".to_string());
            assert!(error.to_string().contains("接收失败"));

            let error = ChannelError::Timeout;
            assert!(error.to_string().contains("超时"));

            let error = ChannelError::ChannelClosed;
            assert!(error.to_string().contains("已关闭"));
        }
    }

    // ========================================================================
    // DashMap Concurrent Map Tests
    // ========================================================================

    mod dashmap_tests {
        use dashmap::DashMap;
        use std::sync::Arc;

        #[test]
        fn test_dashmap_basic_operations() {
            let map = DashMap::new();

            // Insert
            map.insert(1, "one".to_string());
            map.insert(2, "two".to_string());

            // Read
            let val = map.get(&1);
            assert_eq!(val.as_deref(), Some(&"one".to_string()));

            // Update
            let old = map.insert(1, "ONE".to_string());
            assert_eq!(old.unwrap(), "one");

            // Remove
            let removed = map.remove(&2);
            assert_eq!(removed.unwrap().1, "two");
        }

        #[test]
        fn test_dashmap_concurrent_insert() {
            let map = Arc::new(DashMap::new());
            let handles: Vec<_> = (0..4)
                .map(|i| {
                    let map = map.clone();
                    std::thread::spawn(move || {
                        for j in 0..100 {
                            map.insert(i * 100 + j, format!("value-{}", j));
                        }
                    })
                })
                .collect();

            for handle in handles {
                handle.join().unwrap();
            }

            assert_eq!(map.len(), 400);
        }

        #[test]
        fn test_dashmap_entry_api() {
            let map = DashMap::new();

            // Using entry API
            map.entry(1).or_insert_with(|| "one".to_string());

            map.entry(1).and_modify(|s| s.push_str("-modified"));

            let val = map.get(&1).unwrap();
            assert_eq!(val.as_str(), "one-modified");
        }
    }

    // ========================================================================
    // LogLevel Tests
    // ========================================================================

    mod log_level_tests {
        use crate::logger::LogLevel;

        #[test]
        fn test_log_level_as_str() {
            assert_eq!(LogLevel::Trace.as_str(), "trace");
            assert_eq!(LogLevel::Debug.as_str(), "debug");
            assert_eq!(LogLevel::Info.as_str(), "info");
            assert_eq!(LogLevel::Warn.as_str(), "warn");
            assert_eq!(LogLevel::Error.as_str(), "error");
        }

        #[test]
        fn test_log_level_default() {
            assert_eq!(LogLevel::default(), LogLevel::Info);
        }
    }

    // ========================================================================
    // LogConfig Tests
    // ========================================================================

    mod log_config_tests {
        use crate::logger::LogConfig;

        #[test]
        fn test_log_config_default() {
            let config = LogConfig::default();
            assert_eq!(config.app_name, "nuwax-agent");
            assert!(config.file_output);
            assert!(config.console_output);
            assert_eq!(config.max_files, 7);
        }

        #[test]
        fn test_log_config_custom() {
            let config = LogConfig {
                app_name: "test-app".to_string(),
                level: crate::logger::LogLevel::Debug,
                file_output: false,
                console_output: true,
                log_dir: Some(std::path::PathBuf::from("/tmp/logs")),
                max_files: 3,
            };

            assert_eq!(config.app_name, "test-app");
            assert!(!config.file_output);
            assert!(config.console_output);
            assert_eq!(config.max_files, 3);
        }
    }

    // ========================================================================
    // Logger Tests
    // ========================================================================

    mod logger_tests {
        use crate::logger::Logger;

        #[test]
        fn test_default_log_dir() {
            let dir = Logger::default_log_dir();
            assert!(dir.to_string_lossy().contains("nuwax-agent"));
        }

        #[test]
        fn test_get_log_dir() {
            let dir = Logger::get_log_dir();
            assert!(dir.to_string_lossy().contains("nuwax-agent"));
        }

        #[test]
        fn test_list_log_files() {
            // 即使没有日志文件也不应该报错
            let result = Logger::list_log_files();
            assert!(result.is_ok());
        }
    }

    // ========================================================================
    // Password Manager Tests
    // ========================================================================

    mod password_tests {
        use crate::password::PasswordManager;
        use crate::password::PasswordStrength;

        #[test]
        fn test_password_strength_very_weak() {
            let manager = PasswordManager::new();
            let strength = manager.check_strength("123");
            assert_eq!(strength, PasswordStrength::VeryWeak);
        }

        #[test]
        fn test_password_strength_weak() {
            let manager = PasswordManager::new();
            let strength = manager.check_strength("password");
            assert_eq!(strength, PasswordStrength::VeryWeak);

            let strength = manager.check_strength("Password1");
            assert_eq!(strength, PasswordStrength::Weak);
        }

        #[test]
        fn test_password_strength_medium() {
            let manager = PasswordManager::new();
            let strength = manager.check_strength("Password1!");
            assert_eq!(strength, PasswordStrength::Medium);
        }

        #[test]
        fn test_password_strength_strong() {
            let manager = PasswordManager::new();
            let strength = manager.check_strength("MySecure!@#Password123");
            assert_eq!(strength, PasswordStrength::Strong);
        }

        #[test]
        fn test_password_strength_description() {
            assert_eq!(PasswordStrength::VeryWeak.description(), "非常弱");
            assert_eq!(PasswordStrength::Weak.description(), "弱");
            assert_eq!(PasswordStrength::Medium.description(), "中等");
            assert_eq!(PasswordStrength::Strong.description(), "强");
            assert_eq!(PasswordStrength::VeryStrong.description(), "非常强");
        }

        #[test]
        fn test_password_strength_is_acceptable() {
            assert!(!PasswordStrength::VeryWeak.is_acceptable());
            assert!(!PasswordStrength::Weak.is_acceptable());
            assert!(PasswordStrength::Medium.is_acceptable());
            assert!(PasswordStrength::Strong.is_acceptable());
            assert!(PasswordStrength::VeryStrong.is_acceptable());
        }

        #[test]
        fn test_generate_password() {
            let password = PasswordManager::generate_password(16);
            assert_eq!(password.len(), 16);

            let manager = PasswordManager::new();
            let strength = manager.check_strength(&password);
            assert!(strength.is_acceptable());
        }
    }

    // ========================================================================
    // Protocol Manager Tests
    // ========================================================================

    mod protocol_tests {
        use crate::protocol::ProtocolManager;
        use semver::Version;

        #[test]
        fn test_protocol_manager_new() {
            let manager = ProtocolManager::new();
            let version = manager.version();
            assert!(!version.to_string().is_empty());
        }

        #[test]
        fn test_protocol_version_format() {
            let manager = ProtocolManager::new();
            let version = manager.version_string();

            // Version should be in format x.y.z
            let parsed = Version::parse(&version).unwrap();
            assert!(parsed.major >= 1);
        }

        #[test]
        fn test_client_info() {
            let info = crate::ClientInfo::new();
            assert!(!info.os.is_empty());
            assert!(!info.os_version.is_empty());
            assert!(!info.arch.is_empty());
            assert!(!info.client_version.is_empty());
        }

        #[test]
        fn test_compatibility_check_same_version() {
            let manager = ProtocolManager::new();

            // Same version should be compatible
            let result = manager.check_compatibility("1.0.0").unwrap();
            assert!(!result.upgrade_recommended);
        }

        #[test]
        fn test_compatibility_check_newer_server() {
            let manager = ProtocolManager::new();

            // Newer server version should suggest upgrade
            let result = manager.check_compatibility("1.1.0").unwrap();
            assert!(result.upgrade_recommended);
        }

        #[test]
        fn test_incompatible_version() {
            let manager = ProtocolManager::new();

            // Very old version should be incompatible
            let result = manager.check_compatibility("0.1.0");
            assert!(result.is_err());
        }
    }

    // ========================================================================
    // AppConfig Tests
    // ========================================================================

    mod app_config_tests {
        use crate::AppConfig;

        #[test]
        fn test_app_config_default() {
            let config = AppConfig::default();
            assert!(config.server.hbbs_addr.contains("localhost"));
            assert!(config.server.hbbr_addr.contains("localhost"));
            assert!(!config.general.language.is_empty());
            assert_eq!(config.general.theme, "system");
        }

        #[test]
        fn test_server_config_default() {
            let server = crate::config::ServerConfig::default();
            assert_eq!(server.hbbs_addr, "localhost:21116");
            assert_eq!(server.hbbr_addr, "localhost:21117");
            assert!(server.api_addr.is_none());
        }

        #[test]
        fn test_security_config_default() {
            let security = crate::config::SecurityConfig::default();
            assert!(security.password_hash.is_none());
            assert!(!security.enable_tls);
        }

        #[test]
        fn test_general_config_default() {
            let general = crate::config::GeneralConfig::default();
            assert!(!general.auto_launch);
            assert!(general.minimize_to_tray);
            assert_eq!(general.language, "zh");
            assert_eq!(general.theme, "system");
        }

        #[test]
        fn test_logging_config_default() {
            let logging = crate::config::LoggingConfig::default();
            assert_eq!(logging.level, "info");
            assert!(logging.save_to_file);
            assert_eq!(logging.max_files, 7);
        }

        #[test]
        fn test_logging_config_custom() {
            let logging = crate::config::LoggingConfig {
                level: "debug".to_string(),
                save_to_file: false,
                max_files: 14,
            };
            assert_eq!(logging.level, "debug");
            assert!(!logging.save_to_file);
            assert_eq!(logging.max_files, 14);
        }

        #[test]
        fn test_secure_config_default() {
            let secure = crate::config::SecureConfig::default();
            assert!(secure.password.is_none());
            assert!(secure.client_id.is_none());
            assert!(secure.api_token.is_none());
        }

        #[test]
        fn test_secure_config_with_values() {
            let secure = crate::config::SecureConfig {
                password: Some("test_password".to_string()),
                client_id: Some("test-client-id".to_string()),
                api_token: Some("test-token".to_string()),
            };
            assert_eq!(secure.password.unwrap(), "test_password");
            assert_eq!(secure.client_id.unwrap(), "test-client-id");
            assert_eq!(secure.api_token.unwrap(), "test-token");
        }

        #[test]
        fn test_config_error_variants() {
            use crate::config::ConfigError;
            use std::path::PathBuf;

            // Test NotFound variant
            let not_found = ConfigError::NotFound(PathBuf::from("/nonexistent/config.toml"));
            assert!(not_found.to_string().contains("配置文件不存在"));

            // Test IoError variant
            let io_error = ConfigError::IoError(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "file not found",
            ));
            assert!(io_error.to_string().contains("IO 错误"));

            // Test JsonError variant - construct via from_slice
            let json_bytes = b"{invalid json";
            let json_error = serde_json::from_slice::<serde_json::Value>(json_bytes).unwrap_err();
            let config_error = ConfigError::JsonError(json_error);
            assert!(config_error.to_string().contains("JSON 解析错误"));
        }
    }

    // ========================================================================
    // AdminClient Tests
    // ========================================================================

    mod admin_client_tests {
        use crate::admin_client::{AdminClient, AdminConfig, PendingMessage};
        use crate::http_client::mock::MockHttpClient;

        use chrono::Utc;

        #[test]
        fn test_admin_config_default() {
            // Default derive macro sets fields to their default values
            let config = AdminConfig::default();
            assert!(config.server_addr.is_empty());
            assert!(config.api_key.is_none());
            assert_eq!(config.timeout_secs, 0); // Default u64 is 0
        }

        #[test]
        fn test_admin_config_default_values() {
            // Test that default timeout is 30
            let config = AdminConfig::new("http://localhost");
            assert_eq!(config.timeout_secs, 30);
        }

        #[test]
        fn test_admin_config_new() {
            let config = AdminConfig::new("http://localhost:8080");
            assert_eq!(config.server_addr, "http://localhost:8080");
            assert!(config.api_key.is_none());
            assert_eq!(config.timeout_secs, 30);
        }

        #[test]
        fn test_admin_config_with_api_key() {
            let config = AdminConfig::new("http://localhost:8080").with_api_key("test-api-key");
            assert_eq!(config.server_addr, "http://localhost:8080");
            assert_eq!(config.api_key, Some("test-api-key".to_string()));
        }

        #[test]
        fn test_admin_config_base_url() {
            let config = AdminConfig::new("http://localhost:8080");
            assert_eq!(config.base_url(), "http://localhost:8080/api/v1");
        }

        #[test]
        fn test_admin_config_base_url_with_port() {
            let config = AdminConfig::new("http://localhost:9000");
            assert_eq!(config.base_url(), "http://localhost:9000/api/v1");
        }

        #[test]
        fn test_pending_message_new() {
            let message = PendingMessage {
                message_type: "test_type".to_string(),
                payload: vec![1, 2, 3],
                created_at: Utc::now(),
            };
            assert_eq!(message.message_type, "test_type");
            assert_eq!(message.payload, vec![1, 2, 3]);
        }

        #[test]
        fn test_pending_message_with_empty_payload() {
            let message = PendingMessage {
                message_type: "heartbeat".to_string(),
                payload: vec![],
                created_at: Utc::now(),
            };
            assert!(message.payload.is_empty());
        }

        #[tokio::test]
        async fn test_admin_client_is_registered_initial() {
            let client: AdminClient<MockHttpClient> = AdminClient::new();
            assert!(!client.is_registered());
        }

        #[tokio::test]
        async fn test_admin_client_with_config() {
            let config = AdminConfig::new("http://admin.example.com:8080").with_api_key("my-key");
            let client: AdminClient<MockHttpClient> = AdminClient::with_config(config);
            assert!(!client.is_registered());
        }

        #[tokio::test]
        async fn test_admin_client_config_access() {
            let config = AdminConfig::new("http://admin.example.com:8080").with_api_key("my-key");
            let client: AdminClient<MockHttpClient> = AdminClient::with_config(config);
            let client_config = client.config();
            assert_eq!(client_config.server_addr, "http://admin.example.com:8080");
            assert_eq!(client_config.api_key, Some("my-key".to_string()));
        }
    }

    // ========================================================================
    // Service Tests
    // ========================================================================

    mod service_tests {
        use crate::service::{
            NuwaxFileServerConfig, NuwaxLanproxyConfig, ServiceInfo, ServiceManager, ServiceState,
            ServiceType,
        };

        #[test]
        fn test_service_type_equality() {
            assert_eq!(ServiceType::NuwaxFileServer, ServiceType::NuwaxFileServer);
            assert_eq!(ServiceType::NuwaxLanproxy, ServiceType::NuwaxLanproxy);
            assert_eq!(ServiceType::Rcoder, ServiceType::Rcoder);
            assert_ne!(ServiceType::NuwaxFileServer, ServiceType::NuwaxLanproxy);
        }

        #[test]
        fn test_service_type_ne() {
            assert_ne!(ServiceType::NuwaxFileServer, ServiceType::Rcoder);
            assert_ne!(ServiceType::NuwaxLanproxy, ServiceType::Rcoder);
        }

        #[test]
        fn test_service_state_stopped() {
            let state = ServiceState::Stopped;
            assert_eq!(state, ServiceState::Stopped);
        }

        #[test]
        fn test_service_state_running() {
            let state = ServiceState::Running;
            assert_eq!(state, ServiceState::Running);
        }

        #[test]
        fn test_service_state_starting() {
            let state = ServiceState::Starting;
            assert_eq!(state, ServiceState::Starting);
        }

        #[test]
        fn test_service_state_stopping() {
            let state = ServiceState::Stopping;
            assert_eq!(state, ServiceState::Stopping);
        }

        #[test]
        fn test_service_state_error() {
            let error_msg = "Connection refused".to_string();
            let state = ServiceState::Error(error_msg.clone());
            match state {
                ServiceState::Error(msg) => assert_eq!(msg, error_msg),
                _ => panic!("Expected Error variant"),
            }
        }

        #[test]
        fn test_service_state_error_equality() {
            let state1 = ServiceState::Error("test error".to_string());
            let state2 = ServiceState::Error("test error".to_string());
            assert_eq!(state1, state2);
        }

        #[test]
        fn test_service_info_new() {
            let info = ServiceInfo {
                service_type: ServiceType::NuwaxFileServer,
                state: ServiceState::Stopped,
                pid: None,
            };
            assert_eq!(info.service_type, ServiceType::NuwaxFileServer);
            assert_eq!(info.state, ServiceState::Stopped);
            assert!(info.pid.is_none());
        }

        #[test]
        fn test_service_info_with_pid() {
            let info = ServiceInfo {
                service_type: ServiceType::NuwaxLanproxy,
                state: ServiceState::Running,
                pid: Some(12345),
            };
            assert_eq!(info.service_type, ServiceType::NuwaxLanproxy);
            assert_eq!(info.state, ServiceState::Running);
            assert_eq!(info.pid, Some(12345));
        }

        #[test]
        fn test_nuwax_file_server_config_default() {
            let config = NuwaxFileServerConfig::default();
            assert_eq!(config.port, 60000);
            assert_eq!(config.env, "production");
            assert_eq!(config.init_project_name, "nuwax-template");
            // 默认使用 temp_dir 下的 nuwax-file-server-default，跨平台兼容
            let base = std::env::temp_dir().join("nuwax-file-server-default");
            assert_eq!(
                config.init_project_dir,
                base.join("init").to_string_lossy().to_string()
            );
            assert_eq!(
                config.upload_project_dir,
                base.join("zips").to_string_lossy().to_string()
            );
            assert_eq!(
                config.project_source_dir,
                base.join("workspace").to_string_lossy().to_string()
            );
            assert_eq!(
                config.dist_target_dir,
                base.join("nginx").to_string_lossy().to_string()
            );
            assert_eq!(
                config.log_base_dir,
                base.join("logs").join("project_logs").to_string_lossy().to_string()
            );
            assert_eq!(
                config.computer_workspace_dir,
                base.join("computer").to_string_lossy().to_string()
            );
            assert_eq!(
                config.computer_log_dir,
                base.join("logs").join("computer").to_string_lossy().to_string()
            );
        }

        #[test]
        fn test_nuwax_file_server_config_custom() {
            let config = NuwaxFileServerConfig {
                bin_path: "/custom/bin/server".to_string(),
                port: 50000,
                env: "development".to_string(),
                init_project_name: "my-project".to_string(),
                init_project_dir: "/custom/init".to_string(),
                upload_project_dir: "/custom/uploads".to_string(),
                project_source_dir: "/custom/source".to_string(),
                dist_target_dir: "/custom/dist".to_string(),
                log_base_dir: "/custom/logs".to_string(),
                computer_workspace_dir: "/custom/workspace".to_string(),
                computer_log_dir: "/custom/computer-logs".to_string(),
                capture_output_to_log: true,
            };
            assert_eq!(config.port, 50000);
            assert_eq!(config.env, "development");
            assert_eq!(config.bin_path, "/custom/bin/server");
        }

        #[test]
        fn test_nuwax_lanproxy_config_default() {
            let config = NuwaxLanproxyConfig::default();
            assert_eq!(config.server_ip, "127.0.0.1");
            assert_eq!(config.server_port, 60003);
            assert_eq!(config.client_key, "test_key");
        }

        #[test]
        fn test_nuwax_lanproxy_config_custom() {
            let config = NuwaxLanproxyConfig {
                bin_path: "/custom/bin/lanproxy".to_string(),
                server_ip: "192.168.1.100".to_string(),
                server_port: 8080,
                client_key: "my-secret-key".to_string(),
            };
            assert_eq!(config.server_ip, "192.168.1.100");
            assert_eq!(config.server_port, 8080);
            assert_eq!(config.client_key, "my-secret-key");
            assert_eq!(config.bin_path, "/custom/bin/lanproxy");
        }

        #[tokio::test]
        async fn test_service_manager_get_all_status_empty() {
            let manager = ServiceManager::new(None, None, None);
            let statuses = manager.get_all_status().await;

            // All services should be stopped initially
            assert_eq!(statuses.len(), 4);

            let file_server = &statuses[0];
            assert_eq!(file_server.service_type, ServiceType::NuwaxFileServer);
            assert_eq!(file_server.state, ServiceState::Stopped);

            let lanproxy = &statuses[1];
            assert_eq!(lanproxy.service_type, ServiceType::NuwaxLanproxy);
            assert_eq!(lanproxy.state, ServiceState::Stopped);

            let rcoder = &statuses[2];
            assert_eq!(rcoder.service_type, ServiceType::Rcoder);
            assert_eq!(rcoder.state, ServiceState::Stopped);

            let mcp_proxy = &statuses[3];
            assert_eq!(mcp_proxy.service_type, ServiceType::McpProxy);
            assert_eq!(mcp_proxy.state, ServiceState::Stopped);
        }
    }
}

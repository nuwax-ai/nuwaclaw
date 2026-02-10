//! Phase 1 单元测试 - 基础框架
//!
//! 测试配置、加密、协议、自启动等核心模块

#[cfg(test)]
mod config_tests {
    use nuwax_agent::core::config::{AppConfig, GeneralConfig, LoggingConfig, ServerConfig};

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.server.hbbs_addr, "localhost:21116");
        assert_eq!(config.server.hbbr_addr, "localhost:21117");
        assert!(!config.general.auto_launch);
        assert!(config.general.minimize_to_tray);
    }

    #[test]
    fn test_server_config_defaults() {
        let config = ServerConfig::default();
        assert_eq!(config.hbbs_addr, "localhost:21116");
        assert_eq!(config.hbbr_addr, "localhost:21117");
        assert!(config.api_addr.is_none());
    }

    #[test]
    fn test_general_config_defaults() {
        let config = GeneralConfig::default();
        assert_eq!(config.language, "zh");
        assert_eq!(config.theme, "system");
        assert!(!config.auto_launch);
    }

    #[test]
    fn test_logging_config_defaults() {
        let config = LoggingConfig::default();
        assert_eq!(config.level, "info");
        assert!(config.save_to_file);
        assert_eq!(config.max_files, 7);
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let config = AppConfig::default();
        let toml_str = toml::to_string_pretty(&config).unwrap();
        let parsed: AppConfig = toml::from_str(&toml_str).unwrap();

        assert_eq!(parsed.server.hbbs_addr, config.server.hbbs_addr);
        assert_eq!(parsed.general.language, config.general.language);
    }
}

#[cfg(test)]
mod crypto_tests {
    use nuwax_agent::core::crypto::CryptoManager;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = [0u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let plaintext = b"Hello, World! This is a test.";
        let encrypted = crypto.encrypt(plaintext).unwrap();
        let decrypted = crypto.decrypt(&encrypted).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_encrypt_string_roundtrip() {
        let key = [1u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let text = "测试中文字符串 English test 123";
        let encrypted = crypto.encrypt_string(text).unwrap();
        let decrypted = crypto.decrypt_string(&encrypted).unwrap();

        assert_eq!(text, decrypted);
    }

    #[test]
    fn test_different_nonces_produce_different_ciphertext() {
        let key = [2u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let plaintext = b"Same message";
        let enc1 = crypto.encrypt(plaintext).unwrap();
        let enc2 = crypto.encrypt(plaintext).unwrap();

        assert_ne!(enc1, enc2);
        assert_eq!(
            crypto.decrypt(&enc1).unwrap(),
            crypto.decrypt(&enc2).unwrap()
        );
    }

    #[test]
    fn test_invalid_format() {
        let key = [3u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let result = crypto.decrypt(&[0u8; 10]);
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_ciphertext() {
        let key = [4u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let plaintext = b"Secret data";
        let mut encrypted = crypto.encrypt(plaintext).unwrap();

        // 篡改密文
        if let Some(last) = encrypted.last_mut() {
            *last ^= 0xFF;
        }

        assert!(crypto.decrypt(&encrypted).is_err());
    }
}

#[cfg(test)]
mod protocol_tests {
    use nuwax_agent::core::protocol::{ProtocolManager, PROTOCOL_VERSION};

    #[test]
    fn test_protocol_version_format() {
        assert!(!PROTOCOL_VERSION.is_empty());
        assert!(PROTOCOL_VERSION.contains('.'));
    }

    #[test]
    fn test_protocol_manager_creation() {
        let manager = ProtocolManager::new();
        assert_eq!(manager.version_string(), PROTOCOL_VERSION);
    }

    #[test]
    fn test_version_compatibility_check() {
        let manager = ProtocolManager::new();

        // 相同版本应该兼容
        let result = manager.check_compatibility(PROTOCOL_VERSION);
        assert!(result.is_ok());

        // 完全不同版本不兼容
        let result = manager.check_compatibility("0.0.1");
        assert!(result.is_err());
    }

    #[test]
    fn test_upgrade_recommended() {
        let manager = ProtocolManager::new();

        // 更新的服务器版本应该建议升级
        let result = manager.check_compatibility("1.1.0").unwrap();
        assert!(result.upgrade_recommended);
    }
}

#[cfg(test)]
mod password_tests {
    use nuwax_agent::core::password::{PasswordManager, PasswordStrength};

    #[test]
    fn test_hash_and_verify() {
        let manager = PasswordManager::new();

        let password = "TestPassword123!";
        let hash = manager.hash_password(password).unwrap();

        assert!(manager.verify_password(password, &hash).unwrap());
        assert!(!manager.verify_password("wrong_password", &hash).unwrap());
    }

    #[test]
    fn test_password_strength_check() {
        let manager = PasswordManager::new();

        // 弱密码
        let weak = manager.check_strength("123");
        assert!(matches!(weak, PasswordStrength::VeryWeak));

        // 中等密码
        let medium = manager.check_strength("Password1!");
        assert!(matches!(medium, PasswordStrength::Medium));

        // 强密码
        let strong = manager.check_strength("MyStr0ng!P@ssw0rd");
        assert!(matches!(strong, PasswordStrength::Strong));
    }

    #[test]
    fn test_password_strength_acceptable() {
        assert!(!PasswordStrength::VeryWeak.is_acceptable());
        assert!(!PasswordStrength::Weak.is_acceptable());
        assert!(PasswordStrength::Medium.is_acceptable());
        assert!(PasswordStrength::Strong.is_acceptable());
        assert!(PasswordStrength::VeryStrong.is_acceptable());
    }

    #[test]
    fn test_generate_random_password() {
        let password = PasswordManager::generate_password(16);

        assert_eq!(password.len(), 16);
        // 随机密码不应该相同
        let password2 = PasswordManager::generate_password(16);
        assert_ne!(password, password2);
    }

    #[test]
    fn test_validate_password() {
        let manager = PasswordManager::new();

        assert!(manager.validate_password("MyStr0ng!Pass").is_ok());
        assert!(manager.validate_password("weak").is_err());
    }
}

#[cfg(test)]
mod platform_tests {
    use nuwax_agent::core::platform::{get_machine_id, platform_name};

    #[test]
    fn test_platform_name() {
        let name = platform_name();
        assert!(!name.is_empty());
        assert!(["macOS", "Windows", "Linux", "Unknown"].contains(&name));
    }

    #[test]
    fn test_machine_id() {
        let id = get_machine_id();
        // 在大多数系统上应该能获取到 machine ID
        if let Some(ref id_str) = id {
            assert!(!id_str.is_empty());
        }
    }
}

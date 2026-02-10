//! 密码管理模块
//!
//! 使用 Argon2 进行密码哈希和验证

use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use thiserror::Error;
use tracing::debug;

/// 密码错误
#[derive(Error, Debug)]
pub enum PasswordError {
    #[error("密码哈希失败: {0}")]
    HashFailed(String),
    #[error("密码验证失败")]
    VerificationFailed,
    #[error("无效的哈希格式")]
    InvalidFormat,
    #[error("密码强度不足: {0}")]
    WeakPassword(String),
}

/// 密码强度级别
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordStrength {
    /// 非常弱
    VeryWeak,
    /// 弱
    Weak,
    /// 中等
    Medium,
    /// 强
    Strong,
    /// 非常强
    VeryStrong,
}

impl PasswordStrength {
    /// 获取强度描述
    pub fn description(&self) -> &'static str {
        match self {
            Self::VeryWeak => "非常弱",
            Self::Weak => "弱",
            Self::Medium => "中等",
            Self::Strong => "强",
            Self::VeryStrong => "非常强",
        }
    }

    /// 是否满足最低要求
    pub fn is_acceptable(&self) -> bool {
        matches!(self, Self::Medium | Self::Strong | Self::VeryStrong)
    }
}

/// 密码管理器
pub struct PasswordManager {
    /// 最小密码长度
    min_length: usize,
}

impl Default for PasswordManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PasswordManager {
    /// 创建新的密码管理器
    pub fn new() -> Self {
        Self { min_length: 8 }
    }

    /// 设置最小密码长度
    pub fn with_min_length(mut self, length: usize) -> Self {
        self.min_length = length;
        self
    }

    /// 哈希密码
    ///
    /// 返回 PHC 格式的哈希字符串
    pub fn hash_password(&self, password: &str) -> Result<String, PasswordError> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();

        let password_hash = argon2
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| PasswordError::HashFailed(e.to_string()))?;

        debug!("Password hashed successfully");
        Ok(password_hash.to_string())
    }

    /// 验证密码
    pub fn verify_password(&self, password: &str, hash: &str) -> Result<bool, PasswordError> {
        let parsed_hash = PasswordHash::new(hash).map_err(|_| PasswordError::InvalidFormat)?;

        let result = Argon2::default().verify_password(password.as_bytes(), &parsed_hash);

        match result {
            Ok(()) => {
                debug!("Password verification successful");
                Ok(true)
            }
            Err(_) => {
                debug!("Password verification failed");
                Ok(false)
            }
        }
    }

    /// 检查密码强度
    pub fn check_strength(&self, password: &str) -> PasswordStrength {
        let len = password.len();
        let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
        let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
        let has_digit = password.chars().any(|c| c.is_ascii_digit());
        let has_special = password.chars().any(|c| !c.is_alphanumeric());

        let mut score = 0;

        // 长度评分
        if len >= 8 {
            score += 1;
        }
        if len >= 12 {
            score += 1;
        }
        if len >= 16 {
            score += 1;
        }

        // 字符类型评分
        if has_lower {
            score += 1;
        }
        if has_upper {
            score += 1;
        }
        if has_digit {
            score += 1;
        }
        if has_special {
            score += 2;
        }

        match score {
            0..=2 => PasswordStrength::VeryWeak,
            3..=4 => PasswordStrength::Weak,
            5..=6 => PasswordStrength::Medium,
            7..=8 => PasswordStrength::Strong,
            _ => PasswordStrength::VeryStrong,
        }
    }

    /// 验证密码是否符合要求
    pub fn validate_password(&self, password: &str) -> Result<(), PasswordError> {
        if password.len() < self.min_length {
            return Err(PasswordError::WeakPassword(format!(
                "密码长度至少需要 {} 个字符",
                self.min_length
            )));
        }

        let strength = self.check_strength(password);
        if !strength.is_acceptable() {
            return Err(PasswordError::WeakPassword(
                "密码强度不足，建议使用大小写字母、数字和特殊字符的组合".to_string(),
            ));
        }

        Ok(())
    }

    /// 生成随机密码
    pub fn generate_password(length: usize) -> String {
        use rand::RngExt;

        const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
        let mut rng = rand::rng();

        (0..length)
            .map(|_| {
                let idx = rng.random_range(0..CHARSET.len());
                CHARSET[idx] as char
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let manager = PasswordManager::new();
        let password = "MySecureP@ssw0rd!";

        let hash = manager.hash_password(password).unwrap();
        assert!(manager.verify_password(password, &hash).unwrap());
        assert!(!manager.verify_password("wrong_password", &hash).unwrap());
    }

    #[test]
    fn test_password_strength() {
        let manager = PasswordManager::new();

        assert_eq!(manager.check_strength("123"), PasswordStrength::VeryWeak);
        assert_eq!(
            manager.check_strength("password"),
            PasswordStrength::VeryWeak
        );
        assert_eq!(manager.check_strength("Password1"), PasswordStrength::Weak);
        assert_eq!(
            manager.check_strength("Password1!"),
            PasswordStrength::Medium
        );
        assert_eq!(
            manager.check_strength("MyStr0ng!P@ssw0rd"),
            PasswordStrength::Strong
        );
    }

    #[test]
    fn test_validate_password() {
        let manager = PasswordManager::new();

        assert!(manager.validate_password("MyStr0ng!Pass").is_ok());
        assert!(manager.validate_password("weak").is_err());
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

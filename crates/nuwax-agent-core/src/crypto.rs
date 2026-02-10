//! 加密工具
//!
//! 提供配置文件加密存储功能，使用 AES-GCM 加密

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use rand::RngExt;
use thiserror::Error;

use super::platform::get_machine_id;

/// 加密错误
#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("加密失败: {0}")]
    EncryptionFailed(String),
    #[error("解密失败: {0}")]
    DecryptionFailed(String),
    #[error("无法获取机器 ID")]
    MachineIdNotFound,
    #[error("密钥派生失败: {0}")]
    KeyDerivationFailed(String),
    #[error("无效的加密数据格式")]
    InvalidFormat,
}

/// 加密管理器
pub struct CryptoManager {
    cipher: Aes256Gcm,
}

impl CryptoManager {
    /// 创建新的加密管理器
    ///
    /// 使用机器 ID 派生加密密钥
    pub fn new() -> Result<Self, CryptoError> {
        let key = Self::derive_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| CryptoError::KeyDerivationFailed(e.to_string()))?;

        Ok(Self { cipher })
    }

    /// 使用自定义密钥创建加密管理器
    pub fn with_key(key: &[u8; 32]) -> Result<Self, CryptoError> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| CryptoError::KeyDerivationFailed(e.to_string()))?;

        Ok(Self { cipher })
    }

    /// 加密数据
    ///
    /// 返回格式：nonce (12 bytes) + ciphertext
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        // 生成随机 nonce
        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // 加密
        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

        // 组合 nonce + ciphertext
        let mut result = Vec::with_capacity(12 + ciphertext.len());
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&ciphertext);

        Ok(result)
    }

    /// 解密数据
    ///
    /// 输入格式：nonce (12 bytes) + ciphertext
    pub fn decrypt(&self, encrypted: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if encrypted.len() < 12 {
            return Err(CryptoError::InvalidFormat);
        }

        // 提取 nonce 和 ciphertext
        let (nonce_bytes, ciphertext) = encrypted.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        // 解密
        self.cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
    }

    /// 加密字符串
    pub fn encrypt_string(&self, plaintext: &str) -> Result<String, CryptoError> {
        let encrypted = self.encrypt(plaintext.as_bytes())?;
        Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            encrypted,
        ))
    }

    /// 解密字符串
    pub fn decrypt_string(&self, encrypted: &str) -> Result<String, CryptoError> {
        let encrypted_bytes =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encrypted)
                .map_err(|_| CryptoError::InvalidFormat)?;

        let decrypted = self.decrypt(&encrypted_bytes)?;
        String::from_utf8(decrypted).map_err(|_| CryptoError::InvalidFormat)
    }

    /// 从机器 ID 派生加密密钥
    fn derive_key() -> Result<[u8; 32], CryptoError> {
        let machine_id = get_machine_id().ok_or(CryptoError::MachineIdNotFound)?;

        // 使用固定 salt（与机器绑定的应用场景）
        let salt = b"nuwax-agent-key-salt-v1-secure";

        let mut key = [0u8; 32];
        Argon2::default()
            .hash_password_into(machine_id.as_bytes(), salt, &mut key)
            .map_err(|e| CryptoError::KeyDerivationFailed(e.to_string()))?;

        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        // 使用固定密钥进行测试
        let key = [0u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let plaintext = b"Hello, World! This is a test message.";
        let encrypted = crypto.encrypt(plaintext).unwrap();
        let decrypted = crypto.decrypt(&encrypted).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_encrypt_string_roundtrip() {
        let key = [1u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let plaintext = "测试中文字符串 Test English";
        let encrypted = crypto.encrypt_string(plaintext).unwrap();
        let decrypted = crypto.decrypt_string(&encrypted).unwrap();

        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_different_nonces() {
        let key = [2u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        let plaintext = b"Same message";
        let encrypted1 = crypto.encrypt(plaintext).unwrap();
        let encrypted2 = crypto.encrypt(plaintext).unwrap();

        // 相同明文加密后应该不同（因为 nonce 不同）
        assert_ne!(encrypted1, encrypted2);

        // 但解密后应该相同
        assert_eq!(
            crypto.decrypt(&encrypted1).unwrap(),
            crypto.decrypt(&encrypted2).unwrap()
        );
    }

    #[test]
    fn test_invalid_format() {
        let key = [3u8; 32];
        let crypto = CryptoManager::with_key(&key).unwrap();

        // 数据太短
        let result = crypto.decrypt(&[0u8; 10]);
        assert!(matches!(result, Err(CryptoError::InvalidFormat)));
    }
}

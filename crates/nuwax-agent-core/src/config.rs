//! 配置管理
//!
//! 支持普通配置文件和加密配置文件
//! - config.toml: 普通配置（服务器地址、外观设置等）
//! - secure.enc: 加密配置（密码等敏感信息）

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

use super::crypto::{CryptoError, CryptoManager};

/// 配置错误
#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("配置文件不存在: {0}")]
    NotFound(PathBuf),
    #[error("配置解析错误: {0}")]
    ParseError(#[from] toml::de::Error),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
    #[error("加密错误: {0}")]
    CryptoError(#[from] CryptoError),
    #[error("JSON 解析错误: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// 应用配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// 服务器配置
    #[serde(default)]
    pub server: ServerConfig,
    /// 安全配置
    #[serde(default)]
    pub security: SecurityConfig,
    /// 常规配置
    #[serde(default)]
    pub general: GeneralConfig,
    /// 日志配置
    #[serde(default)]
    pub logging: LoggingConfig,
}

/// 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// 信令服务器地址
    #[serde(default = "default_hbbs_addr")]
    pub hbbs_addr: String,
    /// 中继服务器地址
    #[serde(default = "default_hbbr_addr")]
    pub hbbr_addr: String,
    /// API 服务器地址
    #[serde(default)]
    pub api_addr: Option<String>,
}

fn default_hbbs_addr() -> String {
    "localhost:21116".to_string()
}

fn default_hbbr_addr() -> String {
    "localhost:21117".to_string()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            hbbs_addr: default_hbbs_addr(),
            hbbr_addr: default_hbbr_addr(),
            api_addr: None,
        }
    }
}

/// 安全配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecurityConfig {
    /// 连接密码哈希
    #[serde(default)]
    pub password_hash: Option<String>,
    /// 是否启用 TLS
    #[serde(default)]
    pub enable_tls: bool,
}

/// 常规配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    /// 是否开机自启动
    #[serde(default)]
    pub auto_launch: bool,
    /// 是否最小化到托盘
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    /// 语言
    #[serde(default = "default_language")]
    pub language: String,
    /// 主题
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "zh".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            auto_launch: false,
            minimize_to_tray: true,
            language: default_language(),
            theme: default_theme(),
        }
    }
}

/// 日志配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    /// 日志级别
    #[serde(default = "default_log_level")]
    pub level: String,
    /// 是否保存到文件
    #[serde(default = "default_true")]
    pub save_to_file: bool,
    /// 最大日志文件数
    #[serde(default = "default_max_files")]
    pub max_files: usize,
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_max_files() -> usize {
    7
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
            save_to_file: true,
            max_files: default_max_files(),
        }
    }
}

/// 配置管理器
pub struct ConfigManager {
    /// 配置
    pub config: AppConfig,
    /// 配置文件路径
    pub config_path: PathBuf,
    /// 安全配置管理器
    secure_config: SecureConfigManager,
}

impl ConfigManager {
    /// 加载配置
    pub async fn load() -> Result<Self, ConfigError> {
        let config_path = Self::get_config_path();

        let config = if config_path.exists() {
            let content = tokio::fs::read_to_string(&config_path).await?;
            toml::from_str(&content)?
        } else {
            // 尝试从默认配置文件加载
            let config = if let Some(default_config) = Self::load_default_config().await {
                tracing::info!("Using default config template");
                default_config
            } else {
                AppConfig::default()
            };

            // 保存为用户配置
            let content = toml::to_string_pretty(&config).unwrap();
            if let Some(parent) = config_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&config_path, content).await?;
            config
        };

        // 加载安全配置
        let secure_config = SecureConfigManager::load().await?;

        Ok(Self {
            config,
            config_path,
            secure_config,
        })
    }

    /// 尝试加载默认配置文件（可执行文件同目录下的 default-config.toml）
    async fn load_default_config() -> Option<AppConfig> {
        let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        let default_path = exe_dir.join("default-config.toml");

        if default_path.exists() {
            let content = tokio::fs::read_to_string(&default_path).await.ok()?;
            toml::from_str(&content).ok()
        } else {
            None
        }
    }

    /// 保存配置
    pub async fn save(&self) -> Result<(), ConfigError> {
        let content = toml::to_string_pretty(&self.config).unwrap();
        tokio::fs::write(&self.config_path, content).await?;
        self.secure_config.save().await?;
        Ok(())
    }

    /// 获取连接密码
    pub fn get_password(&self) -> Option<&str> {
        self.secure_config.config.password.as_deref()
    }

    /// 设置连接密码
    pub fn set_password(&mut self, password: Option<String>) {
        self.secure_config.config.password = password;
    }

    /// 获取客户端 ID
    pub fn get_client_id(&self) -> Option<&str> {
        self.secure_config.config.client_id.as_deref()
    }

    /// 设置客户端 ID
    pub fn set_client_id(&mut self, client_id: Option<String>) {
        self.secure_config.config.client_id = client_id;
    }

    /// 获取配置文件路径
    fn get_config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent");

        config_dir.join("config.toml")
    }
}

/// 安全配置（加密存储）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SecureConfig {
    /// 连接密码（明文，加密存储）
    pub password: Option<String>,
    /// 客户端 ID
    pub client_id: Option<String>,
    /// API Token
    pub api_token: Option<String>,
}

/// 安全配置管理器
pub struct SecureConfigManager {
    /// 安全配置
    pub config: SecureConfig,
    /// 配置文件路径
    config_path: PathBuf,
    /// 加密管理器（延迟初始化）
    crypto: Option<CryptoManager>,
}

impl SecureConfigManager {
    /// 加载安全配置
    pub async fn load() -> Result<Self, ConfigError> {
        let config_path = Self::get_config_path();

        // 尝试初始化加密管理器
        let crypto = CryptoManager::new().ok();

        let config = if config_path.exists() {
            let encrypted_content = tokio::fs::read(&config_path).await?;

            if let Some(ref crypto) = crypto {
                // 尝试解密
                match crypto.decrypt(&encrypted_content) {
                    Ok(decrypted) => {
                        let json =
                            String::from_utf8(decrypted).map_err(|_| CryptoError::InvalidFormat)?;
                        serde_json::from_str(&json)?
                    }
                    Err(_) => {
                        // 解密失败，可能是旧格式或损坏，使用默认值
                        tracing::warn!("Failed to decrypt secure config, using defaults");
                        SecureConfig::default()
                    }
                }
            } else {
                // 没有加密管理器，使用默认值
                tracing::warn!("CryptoManager unavailable, using default secure config");
                SecureConfig::default()
            }
        } else {
            SecureConfig::default()
        };

        Ok(Self {
            config,
            config_path,
            crypto,
        })
    }

    /// 保存安全配置
    pub async fn save(&self) -> Result<(), ConfigError> {
        let json = serde_json::to_string(&self.config)?;

        let content = if let Some(ref crypto) = self.crypto {
            crypto.encrypt(json.as_bytes())?
        } else {
            // 没有加密管理器，保存明文（仅开发环境）
            tracing::warn!("Saving secure config without encryption");
            json.into_bytes()
        };

        // 确保目录存在
        if let Some(parent) = self.config_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        tokio::fs::write(&self.config_path, content).await?;
        Ok(())
    }

    /// 获取安全配置文件路径
    fn get_config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent");

        config_dir.join("secure.enc")
    }
}

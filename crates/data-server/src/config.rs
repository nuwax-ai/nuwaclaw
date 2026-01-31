//! data-server 配置模块
//!
//! 管理信令服务器和中继服务器的配置

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

/// 配置错误
#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("配置文件不存在: {0}")]
    NotFound(PathBuf),
    #[error("配置解析错误: {0}")]
    ParseError(#[from] toml::de::Error),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}

/// data-server 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataServerConfig {
    /// 信令服务配置
    #[serde(default)]
    pub hbbs: HbbsConfig,
    /// 中继服务配置
    #[serde(default)]
    pub hbbr: HbbrConfig,
    /// 日志配置
    #[serde(default)]
    pub logging: LogConfig,
}

impl Default for DataServerConfig {
    fn default() -> Self {
        Self {
            hbbs: HbbsConfig::default(),
            hbbr: HbbrConfig::default(),
            logging: LogConfig::default(),
        }
    }
}

/// 信令服务配置 (hbbs)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HbbsConfig {
    /// 监听地址
    #[serde(default = "default_hbbs_host")]
    pub host: String,
    /// 监听端口
    #[serde(default = "default_hbbs_port")]
    pub port: u16,
    /// 中继服务器地址（客户端将连接此地址）
    #[serde(default)]
    pub relay: Option<String>,
    /// 密钥文件路径
    #[serde(default)]
    pub key_file: Option<String>,
    /// 认证密钥 (如果为空或"-"则自动生成)
    #[serde(default = "default_key")]
    pub key: String,
    /// UDP 接收缓冲区大小
    #[serde(default)]
    pub rmem: usize,
}

fn default_hbbs_host() -> String {
    "0.0.0.0".to_string()
}

fn default_hbbs_port() -> u16 {
    21116
}

fn default_key() -> String {
    "-".to_string()
}

impl Default for HbbsConfig {
    fn default() -> Self {
        Self {
            host: default_hbbs_host(),
            port: default_hbbs_port(),
            relay: None,
            key_file: None,
            key: default_key(),
            rmem: 0,
        }
    }
}

/// 中继服务配置 (hbbr)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HbbrConfig {
    /// 监听地址
    #[serde(default = "default_hbbr_host")]
    pub host: String,
    /// 监听端口
    #[serde(default = "default_hbbr_port")]
    pub port: u16,
    /// 最大连接数
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
    /// 认证密钥 (与 hbbs 保持一致)
    #[serde(default = "default_key")]
    pub key: String,
}

fn default_hbbr_host() -> String {
    "0.0.0.0".to_string()
}

fn default_hbbr_port() -> u16 {
    21117
}

fn default_max_connections() -> usize {
    1000
}

impl Default for HbbrConfig {
    fn default() -> Self {
        Self {
            host: default_hbbr_host(),
            port: default_hbbr_port(),
            max_connections: default_max_connections(),
            key: default_key(),
        }
    }
}

/// 日志配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfig {
    /// 日志级别
    #[serde(default = "default_log_level")]
    pub level: String,
    /// 是否输出到文件
    #[serde(default)]
    pub to_file: bool,
    /// 日志文件路径
    #[serde(default)]
    pub file_path: Option<String>,
}

fn default_log_level() -> String {
    "info".to_string()
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
            to_file: false,
            file_path: None,
        }
    }
}

impl DataServerConfig {
    /// 从文件加载配置
    pub fn load(path: &str) -> Result<Self, ConfigError> {
        let path = PathBuf::from(path);
        if !path.exists() {
            return Err(ConfigError::NotFound(path));
        }

        let content = std::fs::read_to_string(&path)?;
        let config: Self = toml::from_str(&content)?;
        Ok(config)
    }

    /// 从文件加载，如果不存在则使用默认配置
    pub fn load_or_default(path: &str) -> Self {
        match Self::load(path) {
            Ok(config) => config,
            Err(e) => {
                tracing::warn!("Failed to load config from {}: {}, using defaults", path, e);
                Self::default()
            }
        }
    }

    /// 获取 hbbs 监听地址
    pub fn hbbs_addr(&self) -> String {
        format!("{}:{}", self.hbbs.host, self.hbbs.port)
    }

    /// 获取 hbbr 监听地址
    pub fn hbbr_addr(&self) -> String {
        format!("{}:{}", self.hbbr.host, self.hbbr.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = DataServerConfig::default();
        assert_eq!(config.hbbs.port, 21116);
        assert_eq!(config.hbbr.port, 21117);
        assert_eq!(config.hbbs.host, "0.0.0.0");
        assert_eq!(config.hbbr.host, "0.0.0.0");
    }

    #[test]
    fn test_config_addr() {
        let config = DataServerConfig::default();
        assert_eq!(config.hbbs_addr(), "0.0.0.0:21116");
        assert_eq!(config.hbbr_addr(), "0.0.0.0:21117");
    }

    #[test]
    fn test_config_load_or_default() {
        let config = DataServerConfig::load_or_default("nonexistent.toml");
        assert_eq!(config.hbbs.port, 21116);
    }

    #[test]
    fn test_config_serialization() {
        let config = DataServerConfig::default();
        let toml_str = toml::to_string_pretty(&config).unwrap();
        let parsed: DataServerConfig = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.hbbs.port, config.hbbs.port);
        assert_eq!(parsed.hbbr.port, config.hbbr.port);
    }
}

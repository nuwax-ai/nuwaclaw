//! JSON 配置文件管理器
//!
//! 提供 JSON 格式的配置管理，支持热重载功能
//! - config.json: 可编辑的配置（非敏感项）

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// 配置错误
#[derive(Error, Debug)]
pub enum JsonConfigError {
    #[error("配置文件不存在: {0}")]
    NotFound(PathBuf),
    #[error("JSON 解析错误: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
    #[error("配置文件版本不兼容: {0}")]
    VersionMismatch(String),
}

/// 可编辑的配置（JSON 格式，非敏感项）
///
/// 只包含可以公开编辑的配置项，敏感信息仍通过加密存储
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EditableConfig {
    /// 配置版本
    #[serde(default = "default_version")]
    pub version: String,
    /// 服务器配置
    #[serde(default)]
    pub server: ServerConfig,
    /// 常规配置
    #[serde(default)]
    pub general: GeneralConfig,
    /// 日志配置
    #[serde(default)]
    pub logging: LoggingConfig,
}

fn default_version() -> String {
    "1.0".to_string()
}

/// 服务器配置（可编辑部分）
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

/// 常规配置（可编辑部分）
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

/// 日志配置（可编辑部分）
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

/// 配置事件
#[derive(Debug, Clone)]
pub enum ConfigEvent {
    /// 配置已重新加载
    Reloaded { path: PathBuf },
    /// 配置加载失败
    LoadFailed { path: PathBuf, error: String },
    /// 配置已保存
    Saved { path: PathBuf },
    /// JSON 语法错误
    JsonError { error: String },
}

/// JSON 配置管理器
pub struct JsonConfigManager {
    /// 可编辑的配置（非敏感项）
    config: EditableConfig,
    /// 配置文件路径
    path: PathBuf,
}

impl JsonConfigManager {
    /// 获取配置文件路径
    pub fn get_config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent");

        config_dir.join("config.json")
    }

    /// 加载配置
    pub async fn load() -> Result<Self, JsonConfigError> {
        let path = Self::get_config_path();

        let config = if path.exists() {
            let content = tokio::fs::read_to_string(&path).await?;
            serde_json::from_str(&content)?
        } else {
            // 使用默认配置
            tracing::info!("JSON config not found, using defaults");
            EditableConfig::default()
        };

        // 确保目录存在
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        Ok(Self { config, path })
    }

    /// 同步加载配置
    pub fn load_sync() -> Result<EditableConfig, JsonConfigError> {
        let path = Self::get_config_path();

        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(EditableConfig::default())
        }
    }

    /// 保存配置
    pub async fn save(&self) -> Result<(), JsonConfigError> {
        let content = serde_json::to_string_pretty(&self.config)?;
        tokio::fs::write(&self.path, content).await?;
        Ok(())
    }

    /// 获取当前配置
    pub fn get_config(&self) -> &EditableConfig {
        &self.config
    }

    /// 获取可变的当前配置
    pub fn get_config_mut(&mut self) -> &mut EditableConfig {
        &mut self.config
    }

    /// 更新配置
    pub fn update_config(&mut self, config: EditableConfig) {
        self.config = config;
    }

    /// 获取配置文件路径
    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

/// JSON 验证工具
impl EditableConfig {
    /// 从 JSON 字符串解析配置
    pub fn from_json(json: &str) -> Result<Self, JsonConfigError> {
        serde_json::from_str(json).map_err(|e| JsonConfigError::JsonError(e))
    }

    /// 转换为 JSON 字符串
    pub fn to_json(&self) -> Result<String, JsonConfigError> {
        serde_json::to_string_pretty(self).map_err(|e| JsonConfigError::JsonError(e))
    }

    /// 验证 JSON 字符串格式是否正确
    pub fn validate_json(json: &str) -> Result<(), JsonConfigError> {
        let _: Self = serde_json::from_str(json)?;
        Ok(())
    }

    /// 检查配置版本
    pub fn check_version(&self) -> Result<(), JsonConfigError> {
        let expected = default_version();
        if self.version != expected {
            return Err(JsonConfigError::VersionMismatch(format!(
                "Expected version {}, got {}",
                expected, self.version
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_editable_config_serialization() {
        let config = EditableConfig::default();
        let json = config.to_json().unwrap();
        let parsed = EditableConfig::from_json(&json).unwrap();

        assert_eq!(parsed.version, "1.0");
        assert_eq!(parsed.server.hbbs_addr, "localhost:21116");
        assert_eq!(parsed.server.hbbr_addr, "localhost:21117");
    }

    #[test]
    fn test_validate_json() {
        let valid_json = r#"{
            "version": "1.0",
            "server": {
                "hbbs_addr": "192.168.1.100:21116",
                "hbbr_addr": "192.168.1.100:21117",
                "api_addr": null
            },
            "general": {
                "auto_launch": true,
                "minimize_to_tray": true,
                "language": "zh",
                "theme": "dark"
            },
            "logging": {
                "level": "debug",
                "save_to_file": true,
                "max_files": 14
            }
        }"#;

        assert!(EditableConfig::validate_json(valid_json).is_ok());

        let invalid_json = r#"{ invalid json }"#;
        assert!(EditableConfig::validate_json(invalid_json).is_err());
    }

    #[tokio::test]
    async fn test_save_and_load() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path().join("config.json");

        // 模拟 JsonConfigManager 的保存/加载
        let config = EditableConfig {
            version: "1.0".to_string(),
            server: ServerConfig {
                hbbs_addr: "test-server:21116".to_string(),
                hbbr_addr: "test-server:21117".to_string(),
                api_addr: Some("http://api.test.com".to_string()),
            },
            general: GeneralConfig {
                auto_launch: true,
                minimize_to_tray: false,
                language: "en".to_string(),
                theme: "light".to_string(),
            },
            logging: LoggingConfig {
                level: "trace".to_string(),
                save_to_file: false,
                max_files: 3,
            },
        };

        // 保存
        let json = config.to_json().unwrap();
        std::fs::write(&temp_path, &json).unwrap();

        // 加载
        let loaded_content = std::fs::read_to_string(&temp_path).unwrap();
        let loaded: EditableConfig = EditableConfig::from_json(&loaded_content).unwrap();

        assert_eq!(loaded.server.hbbs_addr, "test-server:21116");
        assert_eq!(loaded.general.auto_launch, true);
        assert_eq!(loaded.logging.level, "trace");
    }

    #[tokio::test]
    async fn test_default_config() {
        let config = EditableConfig::default();

        assert_eq!(config.version, "1.0");
        assert_eq!(config.server.hbbs_addr, "localhost:21116");
        assert_eq!(config.server.hbbr_addr, "localhost:21117");
        assert!(!config.general.auto_launch);
        assert_eq!(config.general.theme, "system");
        assert_eq!(config.logging.level, "info");
    }
}

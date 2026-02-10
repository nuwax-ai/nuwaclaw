//! JSON 配置管理模块
//!
//! 管理 JSON 格式的配置文件

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;
use tokio::fs;
use tracing::debug;

/// JSON 配置错误
#[derive(Error, Debug)]
pub enum JsonConfigError {
    #[error("配置文件不存在: {0}")]
    NotFound(PathBuf),
    #[error("JSON 解析错误: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
    #[error("无效的配置: {0}")]
    InvalidConfig(String),
}

/// 可编辑配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EditableConfig {
    /// 名称
    pub name: Option<String>,
    /// 描述
    pub description: Option<String>,
    /// 自定义字段
    #[serde(flatten)]
    pub custom: serde_json::Value,
}

/// JSON 配置管理器
pub struct JsonConfigManager {
    /// 配置文件路径
    config_path: PathBuf,
    /// 当前配置
    config: EditableConfig,
    /// 是否已修改
    modified: bool,
}

impl Default for JsonConfigManager {
    fn default() -> Self {
        Self::new()
    }
}

impl JsonConfigManager {
    /// 创建新的配置管理器
    pub fn new() -> Self {
        let config_path = Self::default_config_path();

        Self {
            config_path,
            config: EditableConfig::default(),
            modified: false,
        }
    }

    /// 默认配置文件路径
    fn default_config_path() -> PathBuf {
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent");

        config_dir.join("config.json")
    }

    /// 加载配置
    pub async fn load(&mut self) -> Result<(), JsonConfigError> {
        if !self.config_path.exists() {
            debug!("JSON config not found, using defaults");
            return Ok(());
        }

        let content = fs::read_to_string(&self.config_path).await?;
        self.config = serde_json::from_str(&content)?;
        self.modified = false;

        debug!("Loaded JSON config from {:?}", self.config_path);
        Ok(())
    }

    /// 保存配置
    pub async fn save(&mut self) -> Result<(), JsonConfigError> {
        // 确保目录存在
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let content = serde_json::to_string_pretty(&self.config)?;
        fs::write(&self.config_path, content).await?;
        self.modified = false;

        debug!("Saved JSON config to {:?}", self.config_path);
        Ok(())
    }

    /// 获取配置
    pub fn config(&self) -> &EditableConfig {
        &self.config
    }

    /// 获取配置（可变）
    pub fn config_mut(&mut self) -> &mut EditableConfig {
        self.modified = true;
        &mut self.config
    }

    /// 检查是否已修改
    pub fn is_modified(&self) -> bool {
        self.modified
    }

    /// 获取配置文件路径
    pub fn config_path(&self) -> &PathBuf {
        &self.config_path
    }

    /// 验证配置
    pub fn validate(&self) -> Result<(), JsonConfigError> {
        // 添加自定义验证逻辑
        Ok(())
    }

    /// 重置为默认值
    pub fn reset(&mut self) {
        self.config = EditableConfig::default();
        self.modified = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_json_config_manager_creation() {
        let manager = JsonConfigManager::new();
        assert!(!manager.is_modified());
    }

    #[tokio::test]
    async fn test_json_config_load_save() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.json");
        let mut manager = JsonConfigManager {
            config_path,
            config: EditableConfig {
                name: Some("test".to_string()),
                description: Some("test description".to_string()),
                custom: serde_json::json!({"key": "value"}),
            },
            modified: false,
        };

        // 保存配置
        manager.save().await.unwrap();

        // 创建新管理器并加载
        let mut new_manager = JsonConfigManager::new();
        new_manager.config_path = manager.config_path().clone();
        new_manager.load().await.unwrap();

        assert_eq!(new_manager.config.name, Some("test".to_string()));
        assert_eq!(
            new_manager.config.description,
            Some("test description".to_string())
        );
    }

    #[tokio::test]
    async fn test_json_config_modify() {
        let mut manager = JsonConfigManager::new();

        assert!(!manager.is_modified());

        manager.config_mut().name = Some("modified".to_string());

        assert!(manager.is_modified());
    }
}

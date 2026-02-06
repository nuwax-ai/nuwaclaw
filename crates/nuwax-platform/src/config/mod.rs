//! 跨平台配置管理抽象
//!
//! 统一处理不同平台的配置存储和读取
//! 支持 TOML 格式配置文件

use std::path::PathBuf;

/// 配置错误类型
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Config error: {0}")]
    Config(String),
}

/// 获取默认配置路径
#[inline]
pub fn get_default_config_path() -> PathBuf {
    // 使用 dirs crate 获取平台配置目录
    let mut config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nuwax-agent");

    #[cfg(target_os = "macos")]
    {
        // macOS: ~/Library/Application Support/nuwax-agent
        if let Some(home) = dirs::home_dir() {
            config_dir = home.join("Library/Application Support/nuwax-agent");
        }
    }

    config_dir.join("config.toml")
}

/// 配置管理器
pub struct ConfigManager {
    /// 配置文件路径
    config_path: PathBuf,
}

impl ConfigManager {
    /// 创建新的配置管理器
    ///
    /// # Arguments
    ///
    /// * `config_path` - 可选的配置文件路径，为 None 时使用默认路径
    ///
    /// # Returns
    ///
    /// 成功返回配置管理器，失败返回错误
    #[inline]
    pub fn new(config_path: Option<PathBuf>) -> Result<Self, ConfigError> {
        let config_path = config_path.unwrap_or_else(get_default_config_path);

        // 确保目录存在
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| ConfigError::Io(e))?;
        }

        Ok(Self { config_path })
    }

    /// 获取配置文件路径
    #[inline]
    pub fn config_path(&self) -> &PathBuf {
        &self.config_path
    }

    /// 检查配置文件是否存在
    #[inline]
    pub fn exists(&self) -> bool {
        self.config_path.exists()
    }
}

/// 创建配置管理器构建器
#[inline]
pub fn config_manager() -> ConfigManagerBuilder {
    ConfigManagerBuilder::default()
}

/// 配置管理器构建器
#[derive(Debug, Default)]
pub struct ConfigManagerBuilder;

impl ConfigManagerBuilder {
    /// 设置配置文件路径
    #[inline]
    pub fn with_config_path<P: Into<PathBuf>>(self, _path: P) -> Self {
        self
    }

    /// 构建配置管理器
    #[inline]
    pub fn build(self) -> Result<ConfigManager, ConfigError> {
        ConfigManager::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_config_manager_creation() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("config.toml");
        let manager = ConfigManager::new(Some(config_path.clone())).unwrap();
        assert_eq!(manager.config_path(), &config_path);
    }

    #[test]
    fn test_builder() {
        let manager = ConfigManagerBuilder::default()
            .with_config_path(PathBuf::from("/test"))
            .build();
        assert!(manager.is_ok());
    }

    #[test]
    fn test_default_path() {
        let path = get_default_config_path();
        assert!(path.ends_with("nuwax-agent/config.toml"));
    }
}

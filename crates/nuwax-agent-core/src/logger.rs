//! 日志系统
//!
//! 基于 tracing 的日志系统，支持：
//! - 文件日志（每日轮转）
//! - 控制台日志
//! - 日志级别配置
//! - 日志导出

use std::path::{Path, PathBuf};
use thiserror::Error;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// 日志错误
#[derive(Error, Debug)]
pub enum LogError {
    #[error("日志初始化失败: {0}")]
    InitFailed(String),
    #[error("日志导出失败: {0}")]
    ExportFailed(String),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}

/// 日志级别
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LogLevel {
    Trace,
    Debug,
    #[default]
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Trace => "trace",
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

/// 日志配置
pub struct LogConfig {
    /// 应用名称
    pub app_name: String,
    /// 日志级别
    pub level: LogLevel,
    /// 是否输出到文件
    pub file_output: bool,
    /// 是否输出到控制台
    pub console_output: bool,
    /// 日志目录（None 使用默认路径）
    pub log_dir: Option<PathBuf>,
    /// 最大保留日志文件数
    pub max_files: usize,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            app_name: "nuwax-agent".to_string(),
            level: LogLevel::default(),
            file_output: true,
            console_output: true,
            log_dir: None,
            max_files: 7,
        }
    }
}

/// 日志管理器
pub struct Logger;

impl Logger {
    /// 使用默认配置初始化日志系统
    pub fn init(app_name: &str) -> anyhow::Result<()> {
        let config = LogConfig {
            app_name: app_name.to_string(),
            ..Default::default()
        };
        Self::init_with_config(&config)
    }

    /// 使用自定义配置初始化日志系统
    pub fn init_with_config(config: &LogConfig) -> anyhow::Result<()> {
        let log_dir = config.log_dir.clone().unwrap_or_else(Self::default_log_dir);

        // 确保日志目录存在
        std::fs::create_dir_all(&log_dir)?;

        // 环境变量优先
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new(config.level.as_str()));

        let registry = tracing_subscriber::registry().with(env_filter);

        if config.file_output && config.console_output {
            // 文件 + 控制台
            let file_appender =
                tracing_appender::rolling::daily(&log_dir, format!("{}.log", config.app_name));
            let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

            registry
                .with(
                    fmt::layer()
                        .with_target(true)
                        .with_thread_ids(true)
                        .with_file(true)
                        .with_line_number(true),
                )
                .with(fmt::layer().with_writer(non_blocking).with_ansi(false))
                .init();

            std::mem::forget(_guard);
        } else if config.file_output {
            // 仅文件
            let file_appender =
                tracing_appender::rolling::daily(&log_dir, format!("{}.log", config.app_name));
            let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

            registry
                .with(fmt::layer().with_writer(non_blocking).with_ansi(false))
                .init();

            std::mem::forget(_guard);
        } else {
            // 仅控制台
            registry
                .with(fmt::layer().with_target(true).with_thread_ids(true))
                .init();
        }

        Ok(())
    }

    /// 获取默认日志目录
    pub fn default_log_dir() -> PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent")
            .join("logs")
    }

    /// 获取日志目录
    pub fn get_log_dir() -> PathBuf {
        Self::default_log_dir()
    }

    /// 导出日志到指定目录
    pub fn export_logs(output_path: &Path) -> Result<PathBuf, LogError> {
        let log_dir = Self::default_log_dir();

        if !log_dir.exists() {
            return Err(LogError::ExportFailed("日志目录不存在".to_string()));
        }

        // 创建输出目录
        std::fs::create_dir_all(output_path)?;

        // 收集日志文件
        let log_files: Vec<_> = std::fs::read_dir(&log_dir)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "log"))
            .collect();

        if log_files.is_empty() {
            return Err(LogError::ExportFailed("没有日志文件".to_string()));
        }

        // 创建压缩包
        let archive_name = format!(
            "nuwax-agent-logs-{}.zip",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        );
        let archive_path = output_path.join(&archive_name);

        let file = std::fs::File::create(&archive_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for entry in &log_files {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                zip.start_file(name, options)
                    .map_err(|e| LogError::ExportFailed(e.to_string()))?;
                let content = std::fs::read(&path)?;
                std::io::Write::write_all(&mut zip, &content)?;
            }
        }

        zip.finish()
            .map_err(|e| LogError::ExportFailed(e.to_string()))?;

        Ok(archive_path)
    }

    /// 清理旧日志（保留最近 N 天的）
    pub fn cleanup_old_logs(keep_days: u32) -> Result<usize, LogError> {
        let log_dir = Self::default_log_dir();

        if !log_dir.exists() {
            return Ok(0);
        }

        let cutoff = chrono::Utc::now() - chrono::Duration::days(keep_days as i64);
        let mut removed = 0;

        for entry in std::fs::read_dir(&log_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().is_some_and(|ext| ext == "log") {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        let modified: chrono::DateTime<chrono::Utc> = modified.into();
                        if modified < cutoff {
                            std::fs::remove_file(&path)?;
                            removed += 1;
                        }
                    }
                }
            }
        }

        Ok(removed)
    }

    /// 获取日志文件列表
    pub fn list_log_files() -> Result<Vec<LogFileInfo>, LogError> {
        let log_dir = Self::default_log_dir();

        if !log_dir.exists() {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        for entry in std::fs::read_dir(&log_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().is_some_and(|ext| ext == "log") {
                if let Ok(metadata) = entry.metadata() {
                    files.push(LogFileInfo {
                        name: path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string(),
                        path,
                        size_bytes: metadata.len(),
                        modified: metadata.modified().ok().map(|t| t.into()),
                    });
                }
            }
        }

        // 按修改时间排序（最新在前）
        files.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(files)
    }
}

/// 日志文件信息
#[derive(Debug, Clone)]
pub struct LogFileInfo {
    /// 文件名
    pub name: String,
    /// 完整路径
    pub path: PathBuf,
    /// 大小（字节）
    pub size_bytes: u64,
    /// 修改时间
    pub modified: Option<chrono::DateTime<chrono::Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_level_default() {
        let level = LogLevel::default();
        assert_eq!(level, LogLevel::Info);
        assert_eq!(level.as_str(), "info");
    }

    #[test]
    fn test_log_config_default() {
        let config = LogConfig::default();
        assert_eq!(config.app_name, "nuwax-agent");
        assert!(config.file_output);
        assert!(config.console_output);
        assert_eq!(config.max_files, 7);
    }

    #[test]
    fn test_default_log_dir() {
        let dir = Logger::default_log_dir();
        assert!(dir.to_string_lossy().contains("nuwax-agent"));
    }

    #[test]
    fn test_list_log_files() {
        // 即使没有日志文件也不应该报错
        let result = Logger::list_log_files();
        assert!(result.is_ok());
    }
}

//! 日志系统

use std::path::PathBuf;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// 日志管理器
pub struct Logger;

impl Logger {
    /// 初始化日志系统
    pub fn init(app_name: &str) -> anyhow::Result<()> {
        let log_dir = Self::get_log_dir();

        // 确保日志目录存在
        std::fs::create_dir_all(&log_dir)?;

        // 创建文件日志
        let file_appender = tracing_appender::rolling::daily(&log_dir, format!("{}.log", app_name));
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

        // 配置日志格式
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info"));

        tracing_subscriber::registry()
            .with(env_filter)
            .with(
                fmt::layer()
                    .with_target(true)
                    .with_thread_ids(true)
                    .with_file(true)
                    .with_line_number(true)
            )
            .with(
                fmt::layer()
                    .with_writer(non_blocking)
                    .with_ansi(false)
            )
            .init();

        // 保持 guard 存活（实际使用中需要存储在某处）
        std::mem::forget(_guard);

        Ok(())
    }

    /// 获取日志目录
    fn get_log_dir() -> PathBuf {
        let data_dir = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent");

        data_dir.join("logs")
    }
}

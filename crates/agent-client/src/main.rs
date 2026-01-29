//! 程序入口

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, error, warn};

use nuwax_agent::App;
use nuwax_agent::core::config::ConfigManager;
use nuwax_agent::core::logger::Logger;

const APP_NAME: &str = "nuwax-agent";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> anyhow::Result<()> {
    // 设置 panic 处理
    setup_panic_handler();

    // 1. 初始化日志系统
    Logger::init(APP_NAME)?;

    info!("Starting {} v{}", APP_NAME, VERSION);
    info!("Platform: {}", std::env::consts::OS);
    info!("Architecture: {}", std::env::consts::ARCH);

    // 2. 加载配置
    let config_manager = match ConfigManager::load().await {
        Ok(cm) => {
            info!("Configuration loaded from {:?}", cm.config_path);
            Arc::new(RwLock::new(cm))
        }
        Err(e) => {
            error!("Failed to load configuration: {:?}", e);
            return Err(e.into());
        }
    };

    // 3. 创建应用实例
    let mut app = App::new(config_manager.clone()).await?;

    // 4. 设置关闭信号处理
    let shutdown_handle = setup_shutdown_signal();

    // 5. 运行应用
    tokio::select! {
        result = app.run() => {
            if let Err(e) = result {
                error!("Application error: {:?}", e);
                return Err(e);
            }
        }
        _ = shutdown_handle => {
            warn!("Shutdown signal received, cleaning up...");
        }
    }

    // 6. 优雅关闭 - 保存配置
    {
        let config = config_manager.read().await;
        if let Err(e) = config.save().await {
            warn!("Failed to save config on shutdown: {:?}", e);
        }
    }

    info!("Application shutdown complete");
    Ok(())
}

/// 设置 panic 处理器
fn setup_panic_handler() {
    std::panic::set_hook(Box::new(|panic_info| {
        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());

        let message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };

        // 使用 eprintln 因为 tracing 可能在 panic 时不可用
        eprintln!("PANIC at {}: {}", location, message);

        // 尝试使用 tracing（如果已初始化）
        error!("PANIC at {}: {}", location, message);
    }));
}

/// 设置关闭信号处理
async fn setup_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigterm = signal(SignalKind::terminate())
            .expect("Failed to register SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt())
            .expect("Failed to register SIGINT handler");

        tokio::select! {
            _ = sigterm.recv() => {
                info!("Received SIGTERM");
            }
            _ = sigint.recv() => {
                info!("Received SIGINT");
            }
        }
    }

    #[cfg(windows)]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to register Ctrl+C handler");
        info!("Received Ctrl+C");
    }
}

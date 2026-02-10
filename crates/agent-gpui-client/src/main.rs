//! 程序入口

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use nuwax_agent_core::config::ConfigManager;
use nuwax_agent_core::logger::Logger;
use nuwax_gpui_agent::app::Application;

const APP_NAME: &str = "nuwax-agent";
const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> anyhow::Result<()> {
    // 设置 panic 处理
    setup_panic_handler();

    // 1. 初始化日志系统
    Logger::init(APP_NAME)?;

    info!("Starting {} v{}", APP_NAME, VERSION);
    info!("Platform: {}", std::env::consts::OS);
    info!("Architecture: {}", std::env::consts::ARCH);

    // 2. 加载配置（在启动 gpui 前使用 tokio runtime）
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()?;

    let config_manager = runtime.block_on(async {
        match ConfigManager::load().await {
            Ok(cm) => {
                info!("Configuration loaded from {:?}", cm.config_path);
                Ok(Arc::new(RwLock::new(cm)))
            }
            Err(e) => {
                error!("Failed to load configuration: {:?}", e);
                Err(e)
            }
        }
    })?;

    // 3. 启动 gpui 应用（阻塞调用）
    // gpui 有自己的事件循环，不能在 async main 中运行
    // 传入 tokio runtime handle 以便在 gpui 中启动 async 任务
    info!("Starting UI application...");
    let runtime_handle = runtime.handle().clone();
    if let Err(e) = Application::run(config_manager.clone(), runtime_handle) {
        error!("Application error: {:?}", e);
        return Err(e);
    }

    // 4. 应用退出后保存配置
    runtime.block_on(async {
        let config = config_manager.read().await;
        if let Err(e) = config.save().await {
            warn!("Failed to save config on shutdown: {:?}", e);
        }
    });

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

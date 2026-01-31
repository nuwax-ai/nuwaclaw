//! data-server - 数据中转服务器
//!
//! 基于 rustdesk-server 协议提供信令 (hbbs) 和中继 (hbbr) 服务。
//! 客户端通过信令服务注册 ID，通过中继服务进行数据转发。

mod config;

use config::DataServerConfig;
use tracing::{info, error};

/// 命令行参数
struct Args {
    /// 配置文件路径
    config_path: String,
}

impl Args {
    fn parse() -> Self {
        let args: Vec<String> = std::env::args().collect();

        let config_path = if args.len() > 2 && args[1] == "--config" {
            args[2].clone()
        } else {
            "config/data-server.toml".to_string()
        };

        Self { config_path }
    }
}

fn main() -> anyhow::Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("data_server=info".parse().unwrap()),
        )
        .init();

    let args = Args::parse();

    info!("Starting data-server...");
    info!("Loading config from: {}", args.config_path);

    let config = DataServerConfig::load_or_default(&args.config_path);

    info!("hbbs listening on: {}", config.hbbs_addr());
    info!("hbbr listening on: {}", config.hbbr_addr());

    // 设置 rustdesk-server 需要的环境变量
    if let Some(ref relay) = config.hbbs.relay {
        std::env::set_var("RELAY-SERVERS", relay);
    }

    // RendezvousServer::start() 和 relay_server::start() 都带有
    // #[tokio::main] 属性，会各自创建独立的 tokio runtime。
    // 因此需要在独立的 OS 线程中运行。

    let hbbs_config = config.hbbs.clone();
    let hbbs_thread = std::thread::Builder::new()
        .name("hbbs".to_string())
        .spawn(move || {
            info!("Starting hbbs (signaling server) on port {}", hbbs_config.port);
            if let Err(e) = hbbs::RendezvousServer::start(
                hbbs_config.port as i32,
                0,  // serial number
                &hbbs_config.key,
                hbbs_config.rmem,
            ) {
                error!("hbbs service error: {}", e);
            }
        })?;

    let hbbr_config = config.hbbr.clone();
    let hbbr_thread = std::thread::Builder::new()
        .name("hbbr".to_string())
        .spawn(move || {
            info!("Starting hbbr (relay server) on port {}", hbbr_config.port);
            if let Err(e) = hbbs::relay_server::start(
                &hbbr_config.port.to_string(),
                &hbbr_config.key,
            ) {
                error!("hbbr service error: {}", e);
            }
        })?;

    info!("data-server started successfully");

    // 等待两个服务线程（顺序等待，hbbs 退出后再等待 hbbr）
    if let Err(e) = hbbs_thread.join() {
        error!("hbbs thread panicked: {:?}", e);
    }
    if let Err(e) = hbbr_thread.join() {
        error!("hbbr thread panicked: {:?}", e);
    }

    info!("Shutdown complete");
    Ok(())
}

//! data-server - 数据中转服务器
//!
//! 基于 rustdesk-server 协议提供信令 (hbbs) 和中继 (hbbr) 服务。
//! 客户端通过信令服务注册 ID，通过中继服务进行数据转发。

mod config;

use config::DataServerConfig;
use tracing::{info, warn, error};
use tokio::signal;

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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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

    // 加载配置
    let config = DataServerConfig::load_or_default(&args.config_path);

    info!("hbbs listening on: {}", config.hbbs_addr());
    info!("hbbr listening on: {}", config.hbbr_addr());

    // 启动信令服务
    let hbbs_config = config.hbbs.clone();
    let hbbs_handle = tokio::spawn(async move {
        if let Err(e) = run_hbbs(&hbbs_config).await {
            error!("hbbs service error: {}", e);
        }
    });

    // 启动中继服务
    let hbbr_config = config.hbbr.clone();
    let hbbr_handle = tokio::spawn(async move {
        if let Err(e) = run_hbbr(&hbbr_config).await {
            error!("hbbr service error: {}", e);
        }
    });

    info!("data-server started successfully");

    // 等待关闭信号
    shutdown_signal().await;

    info!("Shutting down data-server...");

    // 取消运行中的服务
    hbbs_handle.abort();
    hbbr_handle.abort();

    info!("Shutdown complete");
    Ok(())
}

/// 运行信令服务 (hbbs)
///
/// 负责客户端 ID 注册、发现和 NAT 穿透协调。
/// TODO: 集成 rustdesk-server hbbs 实现
async fn run_hbbs(config: &config::HbbsConfig) -> anyhow::Result<()> {
    let addr = format!("{}:{}", config.host, config.port);
    info!("Starting hbbs (signaling server) on {}", addr);

    // 绑定 UDP 套接字（信令服务使用 UDP）
    let socket = tokio::net::UdpSocket::bind(&addr).await?;
    info!("hbbs UDP socket bound to {}", addr);

    // 同时监听 TCP（用于 NAT 穿透辅助）
    let tcp_listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("hbbs TCP listener bound to {}", addr);

    let mut buf = vec![0u8; 65536];

    loop {
        tokio::select! {
            // UDP 消息处理
            result = socket.recv_from(&mut buf) => {
                match result {
                    Ok((len, src)) => {
                        tracing::debug!("hbbs: received {} bytes from {}", len, src);
                        // TODO: 实现信令协议解析
                        // 这里需要集成 rustdesk-server 的 hbbs 协议处理
                    }
                    Err(e) => {
                        warn!("hbbs UDP recv error: {}", e);
                    }
                }
            }
            // TCP 连接处理
            result = tcp_listener.accept() => {
                match result {
                    Ok((stream, addr)) => {
                        tracing::debug!("hbbs: new TCP connection from {}", addr);
                        tokio::spawn(async move {
                            // TODO: 实现 TCP 信令协议处理
                            drop(stream);
                        });
                    }
                    Err(e) => {
                        warn!("hbbs TCP accept error: {}", e);
                    }
                }
            }
        }
    }
}

/// 运行中继服务 (hbbr)
///
/// 负责客户端之间的数据中继（当 P2P 无法建立时使用）。
/// TODO: 集成 rustdesk-server hbbr 实现
async fn run_hbbr(config: &config::HbbrConfig) -> anyhow::Result<()> {
    let addr = format!("{}:{}", config.host, config.port);
    info!("Starting hbbr (relay server) on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("hbbr TCP listener bound to {}", addr);

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                tracing::debug!("hbbr: new relay connection from {}", addr);
                tokio::spawn(async move {
                    // TODO: 实现中继协议处理
                    // 将两个客户端的数据互相转发
                    drop(stream);
                });
            }
            Err(e) => {
                warn!("hbbr accept error: {}", e);
            }
        }
    }
}

/// 等待关闭信号
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

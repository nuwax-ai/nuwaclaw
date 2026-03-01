//! MCP Proxy 库模式启动
//!
//! 直接调用 mcp-stdio-proxy 库的 mcp_start_task API 启动 MCP 服务。
//!
//! ## 优势
//!
//! - **调试方便**: 可以直接在 mcp-proxy 代码中添加日志和断点
//! - **统一进程**: MCP 服务和主应用在同一进程内，便于监控
//! - **错误处理**: 可以直接捕获和处理错误，而不是解析子进程输出
//! - **性能**: 避免子进程启动开销
//! - **简化部署**: 不需要单独打包 mcp-proxy 可执行文件

use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::sync::Mutex;

// 从 mcp-stdio-proxy 导入类型（从根模块导出）
use mcp_stdio_proxy::{mcp_start_task, McpConfig, McpProtocol, McpType};

/// MCP 库模式运行时状态
///
/// 保存运行中的 MCP 服务状态，包括用于优雅停止的 CancellationToken
#[derive(Clone)]
pub struct McpLibraryRuntime {
    /// 用于取消服务的 Token
    pub cancellation_token: tokio_util::sync::CancellationToken,
    /// 服务绑定的地址
    pub bind_addr: String,
    /// MCP ID
    pub mcp_id: String,
}

/// MCP 库模式配置
#[derive(Clone, Debug)]
pub struct McpLibraryConfig {
    /// 服务 ID（如 "chrome-devtools"）
    pub mcp_id: String,
    /// MCP 服务器配置 JSON
    /// 格式支持:
    /// - `{"mcpServers":{"name":{"command":"node","args":[...]}}}` (推荐)
    /// - `{"command":"node","args":[...]}` (简化格式)
    pub mcp_json_config: String,
    /// 客户端协议（Sse 或 Stream）
    pub client_protocol: McpProtocol,
    /// MCP 类型（Persistent 或 OneShot）
    pub mcp_type: McpType,
}

impl Default for McpLibraryConfig {
    fn default() -> Self {
        Self {
            mcp_id: "default".to_string(),
            mcp_json_config: r#"{"mcpServers":{"default":{"command":"npx","args":["-y","chrome-devtools-mcp@latest","--no-usage-statistics"]}}}"#
                .to_string(),
            client_protocol: McpProtocol::Stream,
            mcp_type: McpType::Persistent,
        }
    }
}

/// 使用库模式启动 MCP 服务
///
/// 返回 (Router, CancellationToken)，可以与现有的 axum 服务器集成。
///
/// # Example
/// ```ignore
/// let config = McpLibraryConfig {
///     mcp_id: "chrome-devtools".to_string(),
///     mcp_json_config: r#"{"mcpServers":{"chrome":{"command":"node","args":["/path/to/index.js"]}}}"#.to_string(),
///     client_protocol: McpProtocol::Stream,
///     mcp_type: McpType::Persistent,
/// };
///
/// let (router, ct) = start_mcp_service(config).await?;
///
/// // 将 router 合并到主应用
/// let app = Router::new().merge(router);
/// ```
pub async fn start_mcp_service(
    config: McpLibraryConfig,
) -> Result<(axum::Router, tokio_util::sync::CancellationToken)> {
    tracing::info!(
        "[McpLibrary] 启动 MCP 服务: id={}, protocol={:?}, type={:?}",
        config.mcp_id,
        config.client_protocol,
        config.mcp_type
    );
    tracing::info!("[McpLibrary] 配置: {}", config.mcp_json_config);

    // 构建 McpConfig
    let mcp_config = McpConfig {
        mcp_id: config.mcp_id,
        mcp_json_config: Some(config.mcp_json_config),
        mcp_type: config.mcp_type,
        client_protocol: config.client_protocol,
        server_config: None,
    };

    // 调用 mcp-stdio-proxy 库的启动函数
    mcp_start_task(mcp_config)
        .await
        .with_context(|| "MCP 服务启动失败")
}

/// 全局 MCP 库模式运行时状态（用于跟踪和停止服务）
static MCP_LIBRARY_RUNTIME: std::sync::OnceLock<Arc<Mutex<Option<McpLibraryRuntime>>>> =
    std::sync::OnceLock::new();

fn get_runtime() -> &'static Arc<Mutex<Option<McpLibraryRuntime>>> {
    MCP_LIBRARY_RUNTIME.get_or_init(|| Arc::new(Mutex::new(None)))
}

/// 启动 MCP 服务并监听指定端口（独立服务模式）
///
/// 这是一个便捷函数，会创建独立的 HTTP 服务器监听指定端口。
/// CancellationToken 会被保存，可以通过 `stop_mcp_service_standalone()` 停止服务。
pub async fn start_mcp_service_standalone(config: McpLibraryConfig, bind_addr: &str) -> Result<()> {
    use tokio::net::TcpListener as TokioTcpListener;

    let (router, ct) = start_mcp_service(config.clone()).await?;

    // 保存运行时状态
    {
        let runtime = get_runtime();
        let mut guard = runtime.lock().await;
        *guard = Some(McpLibraryRuntime {
            cancellation_token: ct.clone(),
            bind_addr: bind_addr.to_string(),
            mcp_id: config.mcp_id.clone(),
        });
    }

    tracing::info!("[McpLibrary] 启动独立服务器: {}", bind_addr);

    let listener = TokioTcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("绑定地址失败: {}", bind_addr))?;

    // 使用 do_cancel 监听取消信号
    let ct_clone = ct.clone();
    tokio::select! {
        result = axum::serve(listener, router) => {
            result.with_context(|| "HTTP 服务器运行失败")?;
        }
        _ = ct_clone.cancelled() => {
            tracing::info!("[McpLibrary] 收到取消信号，停止服务");
        }
    }

    Ok(())
}

/// 停止独立运行的 MCP 服务
///
/// 通过 CancellationToken 取消服务运行。
pub async fn stop_mcp_service_standalone() -> Result<()> {
    let runtime = get_runtime();
    let mut guard = runtime.lock().await;

    if let Some(rt) = guard.take() {
        tracing::info!(
            "[McpLibrary] 停止服务: mcp_id={}, bind_addr={}",
            rt.mcp_id,
            rt.bind_addr
        );
        rt.cancellation_token.cancel();
    } else {
        tracing::warn!("[McpLibrary] 没有运行中的服务需要停止");
    }

    Ok(())
}

/// 检查 MCP 服务是否正在运行
pub async fn is_mcp_service_running() -> bool {
    let runtime = get_runtime();
    let guard = runtime.lock().await;
    guard.is_some() && guard.as_ref().map(|r| !r.cancellation_token.is_cancelled()).unwrap_or(false)
}

/// 获取当前运行的 MCP 服务信息
pub async fn get_mcp_service_info() -> Option<(String, String)> {
    let runtime = get_runtime();
    let guard = runtime.lock().await;
    guard.as_ref().map(|r| (r.mcp_id.clone(), r.bind_addr.clone()))
}

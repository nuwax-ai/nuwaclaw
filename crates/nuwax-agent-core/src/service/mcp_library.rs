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
use tracing::{debug, info, warn};

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

    // Windows 上预处理 npx 命令，避免 .cmd 文件导致窗口闪烁
    #[cfg(target_os = "windows")]
    let mcp_json_config = preprocess_npx_command(&config.mcp_json_config);
    #[cfg(not(target_os = "windows"))]
    let mcp_json_config = config.mcp_json_config.clone();

    // 构建 McpConfig
    let mcp_config = McpConfig {
        mcp_id: config.mcp_id,
        mcp_json_config: Some(mcp_json_config),
        mcp_type: config.mcp_type,
        client_protocol: config.client_protocol,
        server_config: None,
    };

    // 调用 mcp-stdio-proxy 库的启动函数
    mcp_start_task(mcp_config)
        .await
        .with_context(|| "MCP 服务启动失败")
}

/// Windows 上预处理 npx 命令
///
/// 将 `npx -y package@version` 转换为直接的 `node` 命令，
/// 避免使用 .cmd 批处理文件导致窗口闪烁。
///
/// 转换规则：
/// 1. 检测 npx 命令
/// 2. 查找已安装的包的 JS 入口
/// 3. 如果找到，转换为 `node <js_entry>` 命令
/// 4. 如果找不到，保持原样
#[cfg(target_os = "windows")]
fn preprocess_npx_command(mcp_json_config: &str) -> String {
    // 解析 JSON 配置
    let mut config: serde_json::Value = match serde_json::from_str(mcp_json_config) {
        Ok(v) => v,
        Err(e) => {
            warn!("[McpLibrary] 配置解析失败，保持原样: {}", e);
            return mcp_json_config.to_string();
        }
    };

    // 查找 mcpServers 对象
    let mcp_servers = match config.get_mut("mcpServers") {
        Some(v) if v.is_object() => v.as_object_mut().unwrap(),
        _ => {
            debug!("[McpLibrary] 未找到 mcpServers，保持原样");
            return mcp_json_config.to_string();
        }
    };

    let mut modified = false;
    for (_server_name, server_config) in mcp_servers.iter_mut() {
        if let Some(obj) = server_config.as_object_mut() {
            // 先收集需要的信息，避免借用冲突
            let command = obj.get("command").and_then(|c| c.as_str()).map(str::to_string);
            let args = obj.get("args").and_then(|a| a.as_array()).map(|arr| {
                arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect::<Vec<_>>()
            });

            if let Some(command) = command {
                // 检测 npx 命令
                if command == "npx" || command == "npx.cmd" || command.ends_with("npx") || command.ends_with("npx.cmd") {
                    if let Some(args) = args {
                        // 提取包名（跳过 -y 标志）
                        let package_name = args
                            .iter()
                            .find(|s| !s.starts_with('-') && s.contains('@'));

                        if let Some(pkg) = package_name {
                            // 尝试找到已安装的包
                            if let Some((node_exe, js_entry)) = find_npx_package_entry(pkg) {
                                info!(
                                    "[McpLibrary] Windows npx 转换: npx {} -> node {}",
                                    pkg,
                                    js_entry.display()
                                );

                                // 更新命令和参数
                                obj.insert("command".to_string(), serde_json::json!(node_exe.to_string_lossy().to_string()));

                                // 移除 -y 和包名，添加 JS 入口
                                let mut new_args = vec![js_entry.to_string_lossy().to_string()];
                                // 保留除 -y 和包名之外的参数
                                for arg in &args {
                                    if arg != "-y" && arg != pkg {
                                        new_args.push(arg.clone());
                                    }
                                }
                                obj.insert("args".to_string(), serde_json::json!(new_args));
                                modified = true;
                            } else {
                                debug!(
                                    "[McpLibrary] 未找到已安装的包: {}，保持 npx 命令",
                                    pkg
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    if modified {
        serde_json::to_string(&config).unwrap_or_else(|_| mcp_json_config.to_string())
    } else {
        mcp_json_config.to_string()
    }
}

/// 查找 npx 包的 node 可执行文件和 JS 入口
#[cfg(target_os = "windows")]
fn find_npx_package_entry(package_spec: &str) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    // 解析包名（去掉版本号）
    let package_name = package_spec.split('@').next().unwrap_or(package_spec);

    // 查找 node.exe
    let node_exe = find_node_exe()?;

    // 在多个可能的位置查找已安装的包
    let search_paths = get_npx_cache_paths();

    for node_modules_dir in search_paths {
        let package_dir = node_modules_dir.join(package_name);
        if !package_dir.exists() {
            continue;
        }

        // 读取 package.json 查找入口
        let package_json_path = package_dir.join("package.json");
        if let Ok(content) = std::fs::read_to_string(&package_json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                // 查找 bin 字段
                let bin_entry = json.get("bin").and_then(|b| {
                    if let Some(s) = b.as_str() {
                        Some(s.to_string())
                    } else if let Some(obj) = b.as_object() {
                        obj.get(package_name)
                            .or_else(|| obj.values().next())
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                    } else {
                        None
                    }
                });

                if let Some(bin_entry) = bin_entry {
                    let js_entry = package_dir.join(bin_entry);
                    if js_entry.exists() {
                        debug!(
                            "[McpLibrary] 找到包入口: {} -> {}",
                            package_name,
                            js_entry.display()
                        );
                        return Some((node_exe, js_entry));
                    }
                }
            }
        }
    }

    None
}

/// 查找 node.exe 路径
#[cfg(target_os = "windows")]
fn find_node_exe() -> Option<std::path::PathBuf> {
    // 1. 检查环境变量
    if let Ok(node_from_env) = std::env::var("NUWAX_NODE_EXE") {
        let path = std::path::PathBuf::from(node_from_env);
        if path.exists() {
            return Some(path);
        }
    }

    // 2. 检查应用资源目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let resource_paths = [
                exe_dir.join("resources").join("node").join("bin").join("node.exe"),
                exe_dir.parent()
                    .unwrap_or(exe_dir)
                    .join("resources")
                    .join("node")
                    .join("bin")
                    .join("node.exe"),
            ];

            for path in resource_paths {
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }

    // 3. 使用 which crate 查找
    crate::utils::path_env::find_executable_path("node.exe")
}

/// 获取 npx 缓存搜索路径
#[cfg(target_os = "windows")]
fn get_npx_cache_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();

    // npm 全局 node_modules
    if let Ok(appdata) = std::env::var("APPDATA") {
        let appdata_path = std::path::PathBuf::from(&appdata);

        // npm 全局目录
        paths.push(appdata_path.join("npm").join("node_modules"));

        // 应用私有目录
        paths.push(
            appdata_path
                .join("com.nuwax.agent-tauri-client")
                .join("node_modules"),
        );

        // npx 缓存目录（npm 8.16+）
        paths.push(appdata_path.join("npm-cache").join("_npx"));
    }

    // 应用资源目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let resource_paths = [
                exe_dir.join("resources").join("node").join("node_modules"),
                exe_dir.parent()
                    .unwrap_or(exe_dir)
                    .join("resources")
                    .join("node")
                    .join("node_modules"),
            ];

            for path in resource_paths {
                if path.exists() {
                    paths.push(path);
                }
            }
        }
    }

    paths
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

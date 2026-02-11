//! 服务管理器模块
//!
//! 管理 nuwax-file-server, nuwax-lanproxy 和 HTTP Server 服务的启动、停止、重启

// 子模块声明
pub mod types;
pub mod config;
pub mod process;
pub mod health;
pub mod utils;
pub mod file_server;
pub mod mcp_proxy;

// Re-export 公共类型和配置
pub use config::{McpProxyConfig, NuwaxFileServerConfig};
pub use process::{
    find_processes_by_name, find_processes_by_prefix, is_file_server_running,
    is_process_running, is_process_running_fuzzy, kill_processes_by_name,
    kill_stale_lanproxy_processes,
};
pub use types::{
    ServiceInfo, ServiceState, ServiceType, DEFAULT_MCP_PROXY_BIN, DEFAULT_MCP_PROXY_HOST,
    DEFAULT_MCP_PROXY_PORT,
};

// 内部导入
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

// 内部类型别名
use types::ChildWrapperType;

// 导入 RcoderAgentRunner
use super::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};

/// 服务管理器
#[derive(Clone)]
pub struct ServiceManager {
    /// nuwax-file-server 进程（统一使用 process_wrap）
    pub(crate) nuwax_file_server: Arc<Mutex<Option<ChildWrapperType>>>,
    /// nuwax-file-server 配置
    pub(crate) config: Arc<NuwaxFileServerConfig>,
    /// Rcoder Agent Runner
    pub(crate) rcoder: Arc<Mutex<Option<Arc<RcoderAgentRunner>>>>,
    /// MCP Proxy 进程
    pub(crate) mcp_proxy: Arc<Mutex<Option<ChildWrapperType>>>,
    /// MCP Proxy 配置
    pub(crate) mcp_proxy_config: Arc<McpProxyConfig>,
}

impl ServiceManager {
    /// 创建新的服务管理器
    pub fn new(
        config: Option<NuwaxFileServerConfig>,
        mcp_proxy_config: Option<McpProxyConfig>,
    ) -> Self {
        Self {
            nuwax_file_server: Arc::new(Mutex::new(None)),
            config: Arc::new(config.unwrap_or_default()),
            rcoder: Arc::new(Mutex::new(None)),
            mcp_proxy: Arc::new(Mutex::new(None)),
            mcp_proxy_config: Arc::new(mcp_proxy_config.unwrap_or_default()),
        }
    }

    /// 启动 nuwax-file-server（使用内部配置）
    ///
    /// 使用 ServiceManager 初始化时的配置启动文件服务
    pub async fn file_server_start(&self) -> Result<(), String> {
        file_server::start_with_config(self, (*self.config).clone()).await
    }

    /// 停止 nuwax-file-server
    pub async fn file_server_stop(&self) -> Result<(), String> {
        file_server::stop(self).await
    }

    /// 重启 nuwax-file-server
    pub async fn file_server_restart(&self) -> Result<(), String> {
        self.file_server_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.file_server_start().await
    }

    /// 使用指定端口启动 nuwax-file-server
    ///
    /// 该方法允许从外部传入端口参数，用于支持从 Tauri Store 动态读取端口配置
    ///
    /// # Arguments
    /// * `port` - 文件服务端口号
    pub async fn file_server_start_with_port(&self, port: u16) -> Result<(), String> {
        let config = NuwaxFileServerConfig {
            port,
            ..(*self.config).clone()
        };
        file_server::start_with_config(self, config).await
    }

    /// 使用指定配置启动 nuwax-file-server
    ///
    /// 该方法允许从外部传入完整配置，包括 bin_path 和 port
    ///
    /// # Arguments
    /// * `config` - 文件服务配置（包含 bin_path、port 等）
    pub async fn file_server_start_with_config(
        &self,
        config: NuwaxFileServerConfig,
    ) -> Result<(), String> {
        file_server::start_with_config(self, config).await
    }

    /// 使用指定配置启动 MCP Proxy
    pub async fn mcp_proxy_start_with_config(&self, config: McpProxyConfig) -> Result<(), String> {
        mcp_proxy::start_with_config(self, config).await
    }

    /// 启动 MCP Proxy（使用内部配置）
    pub async fn mcp_proxy_start(&self) -> Result<(), String> {
        mcp_proxy::start_with_config(self, (*self.mcp_proxy_config).clone()).await
    }

    /// 停止 MCP Proxy
    pub async fn mcp_proxy_stop(&self) -> Result<(), String> {
        mcp_proxy::stop(self).await
    }

    /// 重启 MCP Proxy
    pub async fn mcp_proxy_restart(&self) -> Result<(), String> {
        self.mcp_proxy_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.mcp_proxy_start().await
    }

    /// 启动 Rcoder Agent Runner
    ///
    /// 接受外部创建的 RcoderAgentRunner 实例
    /// 如果已有运行中的实例，先停止再替换
    pub async fn rcoder_start(
        &self,
        port: u16,
        agent_runner: Arc<RcoderAgentRunner>,
    ) -> Result<(), String> {
        info!("[Rcoder] Starting Agent Runner (port={})...", port);

        let mut guard = self.rcoder.lock().await;

        // 如果已有 runner，确保停止后再替换
        if let Some(ref old_runner) = *guard {
            info!("[Rcoder] Stopping old Agent Runner...");
            old_runner.shutdown().await;
        }

        *guard = Some(agent_runner);

        info!("[Rcoder] Agent Runner started");
        Ok(())
    }

    /// 停止 Rcoder Agent Runner
    pub async fn rcoder_stop(&self) -> Result<(), String> {
        info!("[Rcoder] Stopping Agent Runner...");

        let mut guard = self.rcoder.lock().await;
        if let Some(ref runner) = *guard {
            runner.shutdown().await;
            info!("[Rcoder] Agent Runner stopped");
        } else {
            info!("[Rcoder] Agent Runner not running");
        }
        *guard = None;

        Ok(())
    }

    /// 重启 Rcoder Agent Runner
    pub async fn rcoder_restart(&self, config: RcoderAgentRunnerConfig) -> Result<(), String> {
        info!("[Rcoder] Restarting Agent Runner...");

        let mut guard = self.rcoder.lock().await;

        // 先停止旧的
        if let Some(ref old_runner) = *guard {
            old_runner.shutdown().await;
        }

        // 创建并启动新的
        let mut runner = RcoderAgentRunner::new(config);
        runner.start().await?;
        *guard = Some(Arc::new(runner));

        info!("[Rcoder] Agent Runner restarted");
        Ok(())
    }

    /// 停止所有服务
    pub async fn services_stop_all(&self) -> Result<(), String> {
        info!("[Services] ========== Stopping All Services ==========");

        info!("[Services] 1/3 Stopping Agent service (rcoder)...");
        if let Err(e) = self.rcoder_stop().await {
            warn!("[Services]   - Agent service stop failed: {}", e);
        } else {
            info!("[Services]   - Agent service stopped");
        }

        info!("[Services] 2/3 Stopping File service (nuwax-file-server)...");
        if let Err(e) = self.file_server_stop().await {
            warn!("[Services]   - File service stop failed: {}", e);
        } else {
            info!("[Services]   - File service stopped");
        }

        info!("[Services] 3/3 Stopping MCP Proxy service...");
        if let Err(e) = self.mcp_proxy_stop().await {
            warn!("[Services]   - MCP Proxy stop failed: {}", e);
        } else {
            info!("[Services]   - MCP Proxy stopped");
        }

        info!("[Services] ========== All Services Stopped ==========");
        Ok(())
    }

    /// 重启所有服务
    pub async fn services_restart_all(
        &self,
        rcoder_config: RcoderAgentRunnerConfig,
    ) -> Result<(), String> {
        info!("Restarting all services...");

        self.services_stop_all().await?;

        let mut runner = RcoderAgentRunner::new(rcoder_config);
        runner.start().await?;
        let agent_runner = Arc::new(runner);
        self.rcoder_start(0, agent_runner).await?;
        self.file_server_start().await?;
        self.mcp_proxy_start().await?;

        info!("All services restarted");
        Ok(())
    }

    /// 获取所有服务状态
    pub async fn services_status_all(&self) -> Vec<ServiceInfo> {
        self.get_all_status().await
    }

    /// 获取所有服务状态（别名方法）
    pub async fn get_all_status(&self) -> Vec<ServiceInfo> {
        let mut statuses = Vec::new();

        // nuwax-file-server 状态
        // 注意：nuwax-file-server 是 daemon 模式，start 命令会 fork 出独立进程后退出
        // 所以这里不返回 PID（实际 daemon 的 PID 需要通过 nuwax-file-server status 获取）
        {
            let guard = self.nuwax_file_server.lock().await;
            if guard.is_some() {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxFileServer,
                    state: ServiceState::Running,
                    pid: None, // daemon 模式不返回启动命令的 PID
                });
                debug!("[Services] File service running");
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::NuwaxFileServer,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] File service stopped");
            }
        }

        // Rcoder Agent Runner 状态
        {
            let guard = self.rcoder.lock().await;
            let state = if let Some(ref runner) = *guard {
                if runner.is_running() {
                    ServiceState::Running
                } else {
                    ServiceState::Stopped
                }
            } else {
                ServiceState::Stopped
            };
            statuses.push(ServiceInfo {
                service_type: ServiceType::Rcoder,
                state,
                pid: None,
            });
            debug!(
                "[Services] Agent 服务状态: {:?}",
                statuses.last().unwrap().state
            );
        }

        // MCP Proxy 状态
        {
            let guard = self.mcp_proxy.lock().await;
            if let Some(child) = &*guard {
                let pid = child.id();
                statuses.push(ServiceInfo {
                    service_type: ServiceType::McpProxy,
                    state: ServiceState::Running,
                    pid,
                });
                debug!("[Services] MCP Proxy running, PID: {:?}", pid);
            } else {
                statuses.push(ServiceInfo {
                    service_type: ServiceType::McpProxy,
                    state: ServiceState::Stopped,
                    pid: None,
                });
                debug!("[Services] MCP Proxy stopped");
            }
        }

        statuses
    }
}

//! 服务管理器模块
//!
//! 管理 nuwax-file-server, nuwax-lanproxy 和 HTTP Server 服务的启动、停止、重启

use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn, error};

use super::http_server::HttpServer;

/// 服务类型
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceType {
    /// nuwax-file-server 服务
    NuwaxFileServer,
    /// nuwax-lanproxy 服务
    NuwaxLanproxy,
    /// HTTP Server (rcoder) 服务
    Rcoder,
}

/// 服务状态
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceState {
    /// 停止
    Stopped,
    /// 运行中
    Running,
    /// 启动中
    Starting,
    /// 停止中
    Stopping,
    /// 错误
    Error(String),
}

/// 服务信息
#[derive(Debug, Clone)]
pub struct ServiceInfo {
    /// 服务类型
    pub service_type: ServiceType,
    /// 服务状态
    pub state: ServiceState,
    /// 进程 PID（如果是运行中）
    pub pid: Option<u32>,
}

/// NuwaxFileServer 配置
#[derive(Debug, Clone)]
pub struct NuwaxFileServerConfig {
    /// 端口
    pub port: u16,
    /// 环境
    pub env: String,
    /// 项目名称
    pub init_project_name: String,
    /// 项目目录
    pub init_project_dir: String,
    /// 上传目录
    pub upload_project_dir: String,
    /// 工作空间目录
    pub project_source_dir: String,
    /// 目标目录
    pub dist_target_dir: String,
    /// 日志基础目录
    pub log_base_dir: String,
    /// 工作空间目录
    pub computer_workspace_dir: String,
    /// 计算机日志目录
    pub computer_log_dir: String,
}

impl Default for NuwaxFileServerConfig {
    fn default() -> Self {
        Self {
            port: 60000,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: "/data/init".to_string(),
            upload_project_dir: "/data/zips".to_string(),
            project_source_dir: "/data/workspace".to_string(),
            dist_target_dir: "/var/www/nginx".to_string(),
            log_base_dir: "/var/logs/project_logs".to_string(),
            computer_workspace_dir: "/data/computer".to_string(),
            computer_log_dir: "/var/logs/computer".to_string(),
        }
    }
}

/// NuwaxLanproxy 配置
#[derive(Debug, Clone)]
pub struct NuwaxLanproxyConfig {
    /// 服务器 IP
    pub server_ip: String,
    /// 服务器端口
    pub server_port: u16,
    /// 客户端密钥
    pub client_key: String,
}

impl Default for NuwaxLanproxyConfig {
    fn default() -> Self {
        Self {
            server_ip: "127.0.0.1".to_string(),
            server_port: 9000,
            client_key: "test_key".to_string(),
        }
    }
}

/// 服务管理器
#[derive(Clone)]
pub struct ServiceManager {
    /// nuwax-file-server 进程（统一使用 process_wrap）
    nuwax_file_server: Arc<Mutex<Option<Box<dyn process_wrap::tokio::ChildWrapper>>>>,
    /// nuwax-file-server 配置
    config: Arc<NuwaxFileServerConfig>,
    /// nuwax-lanproxy 进程（使用 process_wrap 进程组）
    lanproxy: Arc<Mutex<Option<Box<dyn process_wrap::tokio::ChildWrapper>>>>,
    /// nuwax-lanproxy 配置
    lanproxy_config: Arc<NuwaxLanproxyConfig>,
    /// HTTP Server 管理器
    http_server: Arc<tokio::sync::Mutex<Option<crate::http_server::HttpServer>>>,
}

impl ServiceManager {
    /// 创建新的服务管理器
    pub fn new(config: Option<NuwaxFileServerConfig>, lanproxy_config: Option<NuwaxLanproxyConfig>) -> Self {
        Self {
            nuwax_file_server: Arc::new(Mutex::new(None)),
            config: Arc::new(config.unwrap_or_default()),
            lanproxy: Arc::new(Mutex::new(None)),
            lanproxy_config: Arc::new(lanproxy_config.unwrap_or_default()),
            http_server: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// 启动 nuwax-file-server
    pub async fn file_server_start(&self) -> Result<(), String> {
        info!("Starting nuwax-file-server...");

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(
            "nuwax-file-server",
            |cmd| {
                cmd.arg("start")
                    .arg("--env")
                    .arg(&self.config.env)
                    .arg("--port")
                    .arg(self.config.port.to_string())
                    .arg(format!("INIT_PROJECT_NAME={}", &self.config.init_project_name))
                    .arg(format!("INIT_PROJECT_DIR={}", &self.config.init_project_dir))
                    .arg(format!("UPLOAD_PROJECT_DIR={}", &self.config.upload_project_dir))
                    .arg(format!("PROJECT_SOURCE_DIR={}", &self.config.project_source_dir))
                    .arg(format!("DIST_TARGET_DIR={}", &self.config.dist_target_dir))
                    .arg(format!("LOG_BASE_DIR={}", &self.config.log_base_dir))
                    .arg(format!("COMPUTER_WORKSPACE_DIR={}", &self.config.computer_workspace_dir))
                    .arg(format!("COMPUTER_LOG_DIR={}", &self.config.computer_log_dir));
            },
        );

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let cmd = cmd.wrap(process_wrap::tokio::ProcessGroup::leader());
        #[cfg(target_os = "windows")]
        let cmd = cmd.wrap(process_wrap::tokio::JobObject::new());

        // 双重保障：KillOnDrop 确保进程被正确终止
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-file-server: {}", e))?;

        let mut guard = self.nuwax_file_server.lock().await;
        *guard = Some(child);

        info!("nuwax-file-server started successfully");
        Ok(())
    }

    /// 停止 nuwax-file-server
    pub async fn file_server_stop(&self) -> Result<(), String> {
        info!("Stopping nuwax-file-server...");

        let mut guard = self.nuwax_file_server.lock().await;
        if let Some(child) = guard.take() {
            let mut child = child;

            if let Err(e) = child.start_kill() {
                warn!("Failed to send kill signal, process may have exited: {}", e);
            }

            use tokio::time::timeout;
            use std::time::Duration;

            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    if status.success() {
                        info!("nuwax-file-server stopped gracefully");
                    } else {
                        info!("nuwax-file-server stopped with exit code: {:?}", status.code());
                    }
                }
                Ok(Err(e)) => {
                    warn!("Error waiting for nuwax-file-server: {}", e);
                }
                Err(_) => {
                    warn!("nuwax-file-server stop timed out");
                }
            }
        } else {
            warn!("nuwax-file-server is not running");
        }

        Ok(())
    }

    /// 重启 nuwax-file-server
    pub async fn file_server_restart(&self) -> Result<(), String> {
        self.file_server_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.file_server_start().await
    }

    /// 启动 nuwax-lanproxy
    ///
    /// 使用 process_wrap 进程组方式启动，确保子进程不会成为僵尸进程
    /// - Unix/Linux/macOS: 使用 ProcessGroup::leader()
    /// - Windows: 使用 JobObject::new()
    /// - 双重保障: kill_on_drop 确保进程被正确终止
    ///
    /// TODO: 从 Tauri store 读取配置
    /// 需要前端定义 store 中的配置字段名，如:
    /// - nuwax-lanproxy.server_ip: 服务器 IP
    /// - nuwax-lanproxy.server_port: 服务器端口
    /// - nuwax-lanproxy.client_key: 客户端密钥
    pub async fn lanproxy_start(&self) -> Result<(), String> {
        info!("Starting nuwax-lanproxy...");

        // TODO: 从 store 读取配置
        // let server_ip: String = store.get("nuwax-lanproxy.server_ip").unwrap_or_default();
        // let server_port: u16 = store.get("nuwax-lanproxy.server_port").unwrap_or_default();
        // let client_key: String = store.get("nuwax-lanproxy.client_key").unwrap_or_default();

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(
            "nuwax-lanproxy",
            |cmd| {
                cmd.arg("-s").arg(&self.lanproxy_config.server_ip);
                cmd.arg("-p").arg(self.lanproxy_config.server_port.to_string());
                cmd.arg("-k").arg(&self.lanproxy_config.client_key);
            },
        );

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let cmd = cmd.wrap(process_wrap::tokio::ProcessGroup::leader());
        #[cfg(target_os = "windows")]
        let cmd = cmd.wrap(process_wrap::tokio::JobObject::new());

        // 双重保障：KillOnDrop 确保进程被正确终止
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-lanproxy: {}", e))?;

        let mut guard = self.lanproxy.lock().await;
        *guard = Some(child);

        info!("nuwax-lanproxy started successfully");
        Ok(())
    }

    /// 停止 nuwax-lanproxy
    pub async fn lanproxy_stop(&self) -> Result<(), String> {
        info!("Stopping nuwax-lanproxy...");

        let mut guard = self.lanproxy.lock().await;
        if let Some(child) = guard.take() {
            // 使用 process_wrap 的 kill 方法
            // 使用 start_kill() 发送终止信号，然后用 wait() 等待退出
            let mut child = child;

            // 发送 kill 信号，如果进程已退出可能会失败（ESRCH）
            if let Err(e) = child.start_kill() {
                // 进程可能已经退出，尝试等待获取最终状态
                warn!("Failed to send kill signal, process may have exited: {}", e);
            }

            // 等待进程退出，带超时
            use tokio::time::timeout;
            use std::time::Duration;

            match timeout(Duration::from_secs(5), child.wait()).await {
                Ok(Ok(status)) => {
                    if status.success() {
                        info!("nuwax-lanproxy stopped gracefully");
                    } else {
                        info!("nuwax-lanproxy stopped with exit code: {:?}", status.code());
                    }
                }
                Ok(Err(e)) => {
                    warn!("Error waiting for nuwax-lanproxy: {}", e);
                }
                Err(_) => {
                    warn!("nuwax-lanproxy stop timed out, process may still be terminating");
                }
            }
        } else {
            warn!("nuwax-lanproxy is not running");
        }

        Ok(())
    }

    /// 重启 nuwax-lanproxy
    pub async fn lanproxy_restart(&self) -> Result<(), String> {
        self.lanproxy_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.lanproxy_start().await
    }

    /// 使用指定配置启动 nuwax-lanproxy
    pub async fn lanproxy_start_with_config(&self, config: NuwaxLanproxyConfig) -> Result<(), String> {
        info!("Starting nuwax-lanproxy with config...");

        let mut cmd = process_wrap::tokio::CommandWrap::with_new(
            "nuwax-lanproxy",
            |cmd| {
                cmd.arg("-s").arg(&config.server_ip);
                cmd.arg("-p").arg(config.server_port.to_string());
                cmd.arg("-k").arg(&config.client_key);
            },
        );

        // 跨平台条件编译：Unix 使用进程组，Windows 使用 JobObject
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let cmd = cmd.wrap(process_wrap::tokio::ProcessGroup::leader());
        #[cfg(target_os = "windows")]
        let cmd = cmd.wrap(process_wrap::tokio::JobObject::new());

        // 双重保障：KillOnDrop 确保进程被正确终止
        let child: Box<dyn process_wrap::tokio::ChildWrapper> = cmd
            .wrap(process_wrap::tokio::KillOnDrop)
            .spawn()
            .map_err(|e| format!("Failed to start nuwax-lanproxy: {}", e))?;

        let mut guard = self.lanproxy.lock().await;
        *guard = Some(child);

        info!("nuwax-lanproxy started successfully");
        Ok(())
    }

    /// 启动 HTTP Server
    pub async fn rcoder_start(&self, port: u16, agent_runner_api: Arc<dyn super::api::traits::agent_runner::AgentRunnerApi>) -> Result<(), String> {
        info!("Starting HTTP Server (rcoder) on port {}...", port);

        let server = super::http_server::HttpServer::new(port);
        let server_clone = server.clone();

        // 在后台启动服务
        tokio::spawn(async move {
            if let Err(e) = server_clone.start(agent_runner_api).await {
                error!("HTTP Server error: {}", e);
            }
        });

        // 等待一小段时间让服务启动
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let mut guard = self.http_server.lock().await;
        *guard = Some(server);

        info!("HTTP Server (rcoder) started");
        Ok(())
    }

    /// 停止 HTTP Server
    pub async fn rcoder_stop(&self) -> Result<(), String> {
        info!("Stopping HTTP Server (rcoder)...");

        let mut guard: tokio::sync::MutexGuard<'_, Option<HttpServer>> = self.http_server.lock().await;
        if let Some(server) = guard.take() {
            drop(guard);
            server.stop();
            info!("HTTP Server (rcoder) stopped");
        } else {
            warn!("HTTP Server (rcoder) is not running");
        }

        Ok(())
    }

    /// 重启 HTTP Server
    pub async fn rcoder_restart(&self, port: u16, agent_runner_api: Arc<dyn super::api::traits::agent_runner::AgentRunnerApi>) -> Result<(), String> {
        self.rcoder_stop().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        self.rcoder_start(port, agent_runner_api).await
    }

    /// 停止所有服务
    pub async fn services_stop_all(&self) -> Result<(), String> {
        info!("Stopping all services...");

        self.rcoder_stop().await?;
        self.file_server_stop().await?;
        self.lanproxy_stop().await?;

        info!("All services stopped");
        Ok(())
    }

    /// 重启所有服务
    pub async fn services_restart_all(&self, port: u16, agent_runner_api: Arc<dyn super::api::traits::agent_runner::AgentRunnerApi>) -> Result<(), String> {
        info!("Restarting all services...");

        self.services_stop_all().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        self.rcoder_start(port, agent_runner_api.clone()).await?;
        self.file_server_start().await?;
        self.lanproxy_start().await?;

        info!("All services restarted");
        Ok(())
    }

    /// 获取所有服务状态
    pub async fn services_status_all(&self) -> Vec<ServiceInfo> {
        let mut statuses = Vec::new();

        // nuwax-file-server 状态
        let nuwax_running = self.nuwax_file_server.lock().await.is_some();
        statuses.push(ServiceInfo {
            service_type: ServiceType::NuwaxFileServer,
            state: if nuwax_running { ServiceState::Running } else { ServiceState::Stopped },
            pid: None,
        });

        // nuwax-lanproxy 状态
        let lanproxy_running = self.lanproxy.lock().await.is_some();
        statuses.push(ServiceInfo {
            service_type: ServiceType::NuwaxLanproxy,
            state: if lanproxy_running { ServiceState::Running } else { ServiceState::Stopped },
            pid: None,
        });

        // HTTP Server 状态
        let http_running: bool = self.http_server.lock().await.is_some();
        statuses.push(ServiceInfo {
            service_type: ServiceType::Rcoder,
            state: if http_running { ServiceState::Running } else { ServiceState::Stopped },
            pid: None,
        });

        statuses
    }
}
